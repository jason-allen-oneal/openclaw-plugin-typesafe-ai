import { TypeSafeClient, noul, choice, score } from "@typesafe-ai/sdk";
import type {
  ITypeSafeClient,
  NoulRequest,
  NoulResponse,
  ChoiceRequest,
  ChoiceResponse,
  ScoreRequest,
  ScoreResponse,
} from "./types.js";

export class TypeSafeTimeoutError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "TypeSafeTimeoutError";
  }
}

export class TypeSafeCircuitBreakerError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "TypeSafeCircuitBreakerError";
  }
}

export type CircuitBreakerState = "CLOSED" | "OPEN" | "HALF_OPEN";

export interface CircuitBreakerConfig {
  failureThreshold?: number;
  resetTimeoutMs?: number;
}

/**
 * Robust Jev client wrapper around official @typesafe-ai/sdk with hard timeouts
 * and circuit-breaker protection against downstream provider outages.
 */
export class JevClientWrapper implements ITypeSafeClient {
  private client: TypeSafeClient;
  private timeoutMs: number;

  // Circuit Breaker State
  private cbState: CircuitBreakerState = "CLOSED";
  private failureThreshold: number;
  private resetTimeoutMs: number;
  private consecutiveFailures = 0;
  private lastFailureTime = 0;

  constructor(
    apiKey: string,
    timeoutMs = 250,
    circuitBreakerConfig: CircuitBreakerConfig = {},
  ) {
    this.timeoutMs = timeoutMs;
    this.failureThreshold = Math.max(1, circuitBreakerConfig.failureThreshold ?? 3);
    this.resetTimeoutMs = Math.max(10, circuitBreakerConfig.resetTimeoutMs ?? 30_000);
    this.client = new TypeSafeClient({
      apiKey,
      timeout: timeoutMs,
    });
  }

  getCircuitBreakerState(): {
    state: CircuitBreakerState;
    consecutiveFailures: number;
    lastFailureTime: number;
  } {
    // Check if OPEN state should automatically evaluate to HALF_OPEN
    if (
      this.cbState === "OPEN" &&
      Date.now() - this.lastFailureTime >= this.resetTimeoutMs
    ) {
      return {
        state: "HALF_OPEN",
        consecutiveFailures: this.consecutiveFailures,
        lastFailureTime: this.lastFailureTime,
      };
    }
    return {
      state: this.cbState,
      consecutiveFailures: this.consecutiveFailures,
      lastFailureTime: this.lastFailureTime,
    };
  }

  resetCircuitBreaker(): void {
    this.cbState = "CLOSED";
    this.consecutiveFailures = 0;
    this.lastFailureTime = 0;
  }

  private checkCircuitBreaker(): void {
    const now = Date.now();
    if (this.cbState === "OPEN") {
      if (now - this.lastFailureTime >= this.resetTimeoutMs) {
        this.cbState = "HALF_OPEN";
      } else {
        const remainingSec = Math.ceil((this.resetTimeoutMs - (now - this.lastFailureTime)) / 1000);
        throw new TypeSafeCircuitBreakerError(
          `TypeSafe Jev circuit breaker is OPEN (${this.consecutiveFailures} consecutive failures). Fast-failing for next ${remainingSec}s.`,
        );
      }
    }
  }

  private recordSuccess(): void {
    this.consecutiveFailures = 0;
    this.cbState = "CLOSED";
  }

  private recordFailure(): void {
    this.consecutiveFailures++;
    this.lastFailureTime = Date.now();
    if (this.consecutiveFailures >= this.failureThreshold) {
      this.cbState = "OPEN";
    }
  }

  private async executeWithProtection<T>(
    operationName: string,
    action: () => Promise<T>,
  ): Promise<T> {
    this.checkCircuitBreaker();

    let timer: NodeJS.Timeout;
    const timeoutPromise = new Promise<never>((_, reject) => {
      timer = setTimeout(() => {
        reject(new TypeSafeTimeoutError(`TypeSafe Jev ${operationName} timed out after ${this.timeoutMs}ms`));
      }, this.timeoutMs);
    });

    try {
      const result = await Promise.race([action(), timeoutPromise]);
      this.recordSuccess();
      return result;
    } catch (err) {
      this.recordFailure();
      throw err;
    } finally {
      // @ts-expect-error timer assigned synchronously before promise settlement
      if (timer) clearTimeout(timer);
    }
  }

  async noul(params: NoulRequest): Promise<NoulResponse> {
    return this.executeWithProtection("noul", async () => {
      const result = await this.client.systemOne({
        state: params.state,
        questions: {
          q: noul(params.proposition),
        },
      });
      const answer = result.answers.q;
      const prob = answer.noul;
      return {
        value: prob >= 0.5,
        probability: prob,
      };
    });
  }

  async choice<T extends string>(params: ChoiceRequest<T>): Promise<ChoiceResponse<T>> {
    return this.executeWithProtection("choice", async () => {
      const criteria: Record<string, string | null> = {};
      for (const opt of params.options) {
        criteria[opt] = null;
      }

      const result = await this.client.systemOne({
        state: params.state,
        questions: {
          q: choice("Select the best matching option:", criteria),
        },
      });
      const answer = result.answers.q;
      return {
        selected: answer.choice as T,
        confidence: answer.confidence,
        distribution: answer.probabilities as Record<T, number>,
      };
    });
  }

  async score(params: ScoreRequest): Promise<ScoreResponse> {
    return this.executeWithProtection("score", async () => {
      const rubric = params.rubric;
      if (rubric.length < 2) {
        throw new Error("Score rubric must contain at least two criteria levels.");
      }

      const scoreCriteria: [string, string, ...string[]] = [
        rubric[0],
        rubric[1],
        ...rubric.slice(2),
      ];

      const result = await this.client.systemOne({
        state: params.state,
        questions: {
          q: score("Evaluate state against the ordered rubric:", scoreCriteria),
        },
      });
      const answer = result.answers.q;
      return {
        level: Math.round(answer.score),
        confidence: answer.confidence,
      };
    });
  }
}
