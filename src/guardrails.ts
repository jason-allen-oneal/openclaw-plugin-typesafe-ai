import type {
  ITypeSafeClient,
  BeforeToolCallEvent,
  PluginHookBeforeToolCallResult,
} from "./types.js";

export const DEFAULT_TOOL_SAFETY_RUBRIC = [
  "1: Read-only safe inspection (reading files, directory listing, searching, status checks)",
  "2: Harmless local scratch modification (writing to temp/scratch dirs, creating scratch files)",
  "3: Reversible workspace file modification (editing project files, git branch, formatting)",
  "4: High-impact file deletion, network mutation, package installation, or gateway configuration",
  "5: Critical command execution or unconstrained destructive operation (rm -rf, sudo, process termination, arbitrary shell execution)",
] as const;

export const SAFE_INSPECTION_TOOLS = new Set([
  "read_file",
  "list_dir",
  "search",
  "grep_search",
  "find_by_name",
  "web_search",
  "read_url_content",
  "status",
  "memory_search",
]);

export class ToolGuardrailService {
  private client: ITypeSafeClient;
  private approvalLevel: number;
  private rubric: readonly string[];

  constructor(
    client: ITypeSafeClient,
    approvalLevel = 4,
    rubric: readonly string[] = DEFAULT_TOOL_SAFETY_RUBRIC,
  ) {
    this.client = client;
    this.approvalLevel = approvalLevel;
    this.rubric = rubric;
  }

  /**
   * Assesses tool invocation safety and returns an OpenClaw approval hook result if necessary.
   */
  async assessToolCall(
    event: BeforeToolCallEvent,
  ): Promise<PluginHookBeforeToolCallResult | null> {
    // 1. Skip known safe read-only tools
    if (SAFE_INSPECTION_TOOLS.has(event.toolName)) {
      return null;
    }

    // 2. Evaluate with Jev Score
    const scored = await this.client.score({
      state: `Tool: ${event.toolName}\nArguments: ${JSON.stringify(event.params, null, 2)}`,
      rubric: this.rubric,
    });

    // 3. If risk level is below approval threshold, permit direct execution
    if (scored.level < this.approvalLevel) {
      return null;
    }

    // 4. Require interactive approval from user
    const isCritical = scored.level >= 5;
    return {
      requireApproval: {
        title: `TypeSafe Security Guardrail: ${event.toolName}`,
        description: `Jev rated this action Risk Level ${scored.level}/5 (Confidence: ${Math.round(
          scored.confidence * 100,
        )}%).\nCommand/Params: ${JSON.stringify(event.params)}`,
        severity: isCritical ? "critical" : "warning",
        allowedDecisions: isCritical ? ["allow-once", "deny"] : ["allow-once", "allow-always", "deny"],
      },
    };
  }
}
