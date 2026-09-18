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

/**
 * Robust Jev client wrapper around official @typesafe-ai/sdk with hard timeouts.
 */
export class JevClientWrapper implements ITypeSafeClient {
  private client: TypeSafeClient;
  private timeoutMs: number;

  constructor(apiKey: string, timeoutMs = 250) {
    this.timeoutMs = timeoutMs;
    this.client = new TypeSafeClient({
      apiKey,
      timeout: timeoutMs,
    });
  }

  private async withTimeout<T>(operationName: string, promise: Promise<T>): Promise<T> {
    let timer: NodeJS.Timeout;
    const timeoutPromise = new Promise<never>((_, reject) => {
      timer = setTimeout(() => {
        reject(new Error(`TypeSafe Jev ${operationName} timed out after ${this.timeoutMs}ms`));
      }, this.timeoutMs);
    });

    try {
      return await Promise.race([promise, timeoutPromise]);
    } finally {
      // @ts-expect-error timer assigned synchronously before promise settlement
      if (timer) clearTimeout(timer);
    }
  }

  async noul(params: NoulRequest): Promise<NoulResponse> {
    return this.withTimeout("noul", (async () => {
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
    })());
  }

  async choice<T extends string>(params: ChoiceRequest<T>): Promise<ChoiceResponse<T>> {
    return this.withTimeout("choice", (async () => {
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
    })());
  }

  async score(params: ScoreRequest): Promise<ScoreResponse> {
    return this.withTimeout("score", (async () => {
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
    })());
  }
}
