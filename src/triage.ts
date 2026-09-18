import type { ITypeSafeClient, InboundClaimEvent } from "./types.js";

export interface TriageEvaluationResult {
  shouldSuppress: boolean;
  confidence: number;
  reason?: string;
}

export class GroupChatTriageService {
  private client: ITypeSafeClient;
  private threshold: number;

  constructor(client: ITypeSafeClient, threshold = 0.75) {
    this.client = client;
    this.threshold = threshold;
  }

  /**
   * Evaluates whether an inbound group chat message should be suppressed as background chatter.
   */
  async evaluateGroupMessage(
    event: InboundClaimEvent,
    botNames: string[] = ["assistant", "bot", "claw", "openclaw"],
  ): Promise<TriageEvaluationResult> {
    // 1. Never suppress direct 1:1 messages
    if (!event.isGroup) {
      return { shouldSuppress: false, confidence: 1.0, reason: "direct_message" };
    }

    const text = event.content.trim();
    if (!text) {
      return { shouldSuppress: false, confidence: 1.0, reason: "empty_content" };
    }

    // 2. Never suppress explicit slash commands
    if (text.startsWith("/") || text.startsWith("!")) {
      return { shouldSuppress: false, confidence: 1.0, reason: "explicit_command" };
    }

    // 3. Never suppress explicit mentions of configured bot names
    const lower = text.toLowerCase();
    for (const name of botNames) {
      if (lower.includes(name.toLowerCase())) {
        return { shouldSuppress: false, confidence: 1.0, reason: "bot_name_mention" };
      }
    }

    // 4. Jev System One Noul Evaluation
    const response = await this.client.noul({
      state: `Channel: ${event.channel}\nMessage: "${text}"`,
      proposition:
        "The message is asking a question or requesting action, input, or assistance from the AI assistant.",
    });

    // If Jev evaluates false with high calibrated probability, suppress
    if (!response.value && response.probability >= this.threshold) {
      return {
        shouldSuppress: true,
        confidence: response.probability,
        reason: "system_one_chatter_suppressed",
      };
    }

    return {
      shouldSuppress: false,
      confidence: response.probability,
      reason: "passed_triage",
    };
  }
}
