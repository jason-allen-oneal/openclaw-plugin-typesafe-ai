import type { ITypeSafeClient } from "./types.js";
import { redactSensitiveText } from "./redactor.js";

export interface PruneStats {
  originalMessageCount: number;
  prunedOutputsCount: number;
  estimatedBytesSaved: number;
}

export interface CompactionTimingResult {
  isSafe: boolean;
  confidence: number;
  reason?: string;
}

export interface FidelityAuditResult {
  preserved: boolean;
  confidence: number;
  warning?: string;
}

/**
 * Service providing System One curation and auditing for OpenClaw transcript compaction.
 */
export class CompactionCuratorService {
  private client: ITypeSafeClient;

  constructor(client: ITypeSafeClient) {
    this.client = client;
  }

  /**
   * Prunes ephemeral, high-volume tool execution logs (e.g. passing test suites,
   * directory dumps) in-place before the transcript is fed into the generative summarizer.
   * Processes candidate messages concurrently up to `concurrency` limit (default 5).
   */
  async pruneTranscriptMessages(
    messages: unknown[],
    concurrency = 5,
  ): Promise<PruneStats> {
    const stats: PruneStats = {
      originalMessageCount: messages.length,
      prunedOutputsCount: 0,
      estimatedBytesSaved: 0,
    };

    if (!Array.isArray(messages) || messages.length === 0) {
      return stats;
    }

    // Identify candidate messages
    const candidates: Array<{ record: Record<string, unknown>; content: string }> = [];
    for (const item of messages) {
      if (!item || typeof item !== "object") continue;

      const record = item as Record<string, unknown>;
      const role = record.role;
      const content = record.content;

      // Only inspect tool outputs or assistant function call outputs with substantial content
      const isToolMessage =
        role === "tool" || Boolean(record.toolCallId) || Boolean(record.tool_call_id);
      if (!isToolMessage || typeof content !== "string" || content.length < 400) {
        continue;
      }

      candidates.push({ record, content });
    }

    if (candidates.length === 0) {
      return stats;
    }

    // Process candidates in batches with concurrency limit
    const effectiveConcurrency = Math.max(1, concurrency);
    for (let i = 0; i < candidates.length; i += effectiveConcurrency) {
      const batch = candidates.slice(i, i + effectiveConcurrency);
      await Promise.all(
        batch.map(async ({ record, content }) => {
          try {
            const sanitizedSnippet = redactSensitiveText(content.slice(0, 800));
            const decision = await this.client.choice({
              state: `Tool name: ${record.name ?? record.toolName ?? "tool"}\nOutput snippet:\n${sanitizedSnippet}`,
              instructions: "Determine if this tool output represents ephemeral diagnostic logs or essential state to preserve:",
              criteria: {
                ephemeral_log: "Routine, verbose, or transient logs (passing tests, lint outputs, directory listings, build artifacts) that do not contain critical unresolved errors or state needed for future steps",
                essential_state: "Essential state changes, error diagnostics, configuration data, or unique information required to understand the current task progress",
              },
            });

            if (decision.selected === "ephemeral_log" && decision.confidence >= 0.80) {
              const originalLength = content.length;
              const replacement = `[Omitted by TypeSafe Compaction Curator: ${
                record.name ?? "tool"
              } execution output (${Math.round(originalLength / 1024)}KB) evaluated as ephemeral]`;

              record.content = replacement;
              stats.prunedOutputsCount++;
              stats.estimatedBytesSaved += originalLength - replacement.length;
            }
          } catch {
            // Fail-safe: keep original content if Jev call fails, times out, or trips breaker
          }
        }),
      );
    }

    return stats;
  }

  /**
   * Evaluates if the current agent context is at a clean semantic boundary rather than mid-task.
   */
  async checkCompactionBoundary(recentTurnsSnippet: string): Promise<CompactionTimingResult> {
    if (!recentTurnsSnippet.trim()) {
      return { isSafe: true, confidence: 1.0, reason: "empty_context" };
    }

    const decision = await this.client.noul({
      state: `Recent assistant context:\n${recentTurnsSnippet.slice(-2000)}`,
      proposition:
        "The agent has concluded its current atomic troubleshooting or code modification step and is in a safe state for history compaction.",
    });

    const confidence = decision.confidence ?? (decision.value ? decision.probability : 1 - decision.probability);

    return {
      isSafe: decision.value,
      confidence,
      reason: decision.value
        ? "Safe semantic boundary confirmed"
        : "Agent appears mid-stride in multi-step operation",
    };
  }

  /**
   * Post-compaction audit verifying that the generated summary preserves all unfinished tasks and constraints.
   */
  async auditSummaryFidelity(
    originalGoalsSnippet: string,
    generatedSummary: string,
  ): Promise<FidelityAuditResult> {
    if (!originalGoalsSnippet.trim() || !generatedSummary.trim()) {
      return { preserved: true, confidence: 1.0 };
    }

    const decision = await this.client.noul({
      state: `ORIGINAL GOALS & CONSTRAINTS:\n${originalGoalsSnippet.slice(
        0,
        1500,
      )}\n\nGENERATED COMPACTED SUMMARY:\n${generatedSummary.slice(0, 1500)}`,
      proposition:
        "The generated summary preserves all active open tasks, user constraints, and unfulfilled commitments from the original goals.",
    });

    const confidence = decision.confidence ?? (decision.value ? decision.probability : 1 - decision.probability);

    return {
      preserved: decision.value,
      confidence,
      warning: !decision.value
        ? `Jev warned that compacted summary may have lost critical goals (confidence: ${Math.round(
            confidence * 100,
          )}%)`
        : undefined,
    };
  }
}
