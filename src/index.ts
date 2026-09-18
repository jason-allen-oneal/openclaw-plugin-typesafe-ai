import { JevClientWrapper } from "./client.js";
import { GroupChatTriageService } from "./triage.js";
import { ToolGuardrailService, HIGH_RISK_TOOLS } from "./guardrails.js";
import { ModelComplexityRouter } from "./model-router.js";
import { CompactionCuratorService } from "./compaction.js";
import type {
  OpenClawPluginApi,
  TypeSafePluginConfig,
  InboundClaimEvent,
  BeforeToolCallEvent,
  BeforeModelResolveEvent,
  LlmInputEvent,
  PluginHookBeforeCompactionEvent,
  PluginHookAfterCompactionEvent,
  PluginHookAgentContext,
} from "./types.js";

/**
 * OpenClaw Plugin Entry definition.
 */
export function register(api: OpenClawPluginApi): void {
  const pluginConfig = (api.config.plugins?.entries?.["typesafe-ai"]?.config ?? {}) as TypeSafePluginConfig;
  const apiKey = pluginConfig.apiKey || process.env.TYPESAFE_API_KEY;

  // If no API key is set, keep plugin inactive without crashing OpenClaw
  if (!apiKey) {
    api.logger.debug(
      "[typesafe-ai] No TYPESAFE_API_KEY found in config or environment. Plugin will remain inactive.",
    );
    return;
  }

  const timeoutMs = pluginConfig.timeoutMs ?? 250;
  const safetyFailMode = pluginConfig.safetyFailMode ?? "secure";
  const configuredBotNames = pluginConfig.botNames ?? ["assistant", "bot", "claw", "openclaw"];
  const client = new JevClientWrapper(apiKey, timeoutMs);

  const features = pluginConfig.features ?? {};
  const enableTriage = features.groupChatTriage !== false; // default true
  const enableSafety = features.toolSafetyGate !== false; // default true
  const enableRouting = features.modelComplexityRouting === true; // default false
  const enablePromptAudit = features.promptInjectionAudit === true; // default false
  const enableCompaction = features.compactionCuration !== false; // default true
  const enableCompactionAudit = features.compactionFidelityAudit !== false; // default true

  api.logger.info("[typesafe-ai] Initialized Jev System One decision engine.", {
    timeoutMs,
    safetyFailMode,
    enableTriage,
    enableSafety,
    enableRouting,
    enablePromptAudit,
    enableCompaction,
    enableCompactionAudit,
  });

  // 1. Group Chat Chatter Triage Hook
  if (enableTriage) {
    const triageService = new GroupChatTriageService(
      client,
      pluginConfig.triageThreshold ?? 0.75,
      configuredBotNames,
    );

    api.on("inbound_claim", async (event: InboundClaimEvent) => {
      try {
        const result = await triageService.evaluateGroupMessage(event);
        if (result.shouldSuppress) {
          api.logger.debug(
            `[typesafe-ai] Suppressed group chatter in ${event.channel} (${Math.round(
              result.confidence * 100,
            )}% confidence)`,
          );
          return { handled: true, reason: result.reason };
        }
      } catch (err) {
        api.logger.warn("[typesafe-ai] Group triage failed or timed out, falling back to default.", err);
      }
    });
  }

  // 2. Pre-Flight Tool Safety Guardrail Hook
  if (enableSafety) {
    const guardrailService = new ToolGuardrailService(
      client,
      pluginConfig.safetyApprovalLevel ?? 4,
    );

    api.on("before_tool_call", async (event: BeforeToolCallEvent) => {
      try {
        const approval = await guardrailService.assessToolCall(event);
        if (approval) {
          api.logger.info(
            `[typesafe-ai] Tool call '${event.toolName}' flagged for interactive approval.`,
          );
          return approval;
        }
      } catch (err) {
        const errMsg = err instanceof Error ? err.message : String(err);
        // Security: In secure mode, high-risk tools fail closed (require interactive confirmation)
        if (safetyFailMode === "secure" && HIGH_RISK_TOOLS.has(event.toolName)) {
          api.logger.warn(
            `[typesafe-ai] Security check failed or timed out for high-risk tool '${event.toolName}'. Failing closed: requiring interactive approval.`,
            err,
          );
          return guardrailService.createFailClosedApproval(event.toolName, event.params, errMsg);
        }

        api.logger.warn("[typesafe-ai] Tool safety check failed or timed out, allowing default policy.", err);
      }
    });
  }

  // 3. Adaptive Model Complexity Router Hook
  if (enableRouting) {
    const router = new ModelComplexityRouter(client);

    api.on("before_model_resolve", async (event: BeforeModelResolveEvent) => {
      try {
        const routeResult = await router.routeModel(event);
        if (routeResult) {
          api.logger.info(`[typesafe-ai] Model dynamically routed: ${routeResult.modelOverride}`);
          return routeResult;
        }
      } catch (err) {
        api.logger.warn("[typesafe-ai] Model routing failed or timed out.", err);
      }
    });
  }

  // 4. Prompt Injection Screening Hook
  if (enablePromptAudit) {
    api.on("llm_input", async (event: LlmInputEvent) => {
      try {
        const lastUserMsg = [...event.messages].reverse().find((m) => m.role === "user");
        if (!lastUserMsg) return;

        const audit = await client.score({
          state: `Input text to evaluate:\n"${lastUserMsg.content}"`,
          rubric: [
            "1: Benign conversation or query",
            "2: Mild formatting or roleplay request",
            "3: Suspicious system-like phrasing",
            "4: High likelihood prompt injection attempting rule bypass or tool hijack",
            "5: Critical overt jailbreak or exfiltration payload",
          ],
        });

        if (audit.level >= 4) {
          api.logger.warn(
            `[typesafe-ai] Prompt injection flagged (Risk Level ${audit.level}/5, confidence ${Math.round(
              audit.confidence * 100,
            )}%)`,
          );
          return {
            flagged: true,
            warning: `TypeSafe Guardrail Warning: High injection risk detected (Level ${audit.level}/5)`,
          };
        }
      } catch (err) {
        api.logger.warn("[typesafe-ai] Prompt injection audit failed or timed out.", err);
      }
    });
  }

  // 5. Compaction Curation & Auditing Hooks
  if (enableCompaction || enableCompactionAudit) {
    const compactionService = new CompactionCuratorService(client);

    // Pre-Compaction: Prune ephemeral tool results
    if (enableCompaction) {
      api.on(
        "before_compaction",
        async (event: PluginHookBeforeCompactionEvent, ctx?: PluginHookAgentContext) => {
          try {
            if (Array.isArray(event.messages) && event.messages.length > 0) {
              const stats = await compactionService.pruneTranscriptMessages(event.messages);
              if (stats.prunedOutputsCount > 0) {
                api.logger.info(
                  `[typesafe-ai] Pre-compaction pruned ${stats.prunedOutputsCount} transient tool outputs, saving ~${Math.round(
                    stats.estimatedBytesSaved / 1024,
                  )}KB before summarization.`,
                  { sessionId: ctx?.sessionId },
                );
              }
            }
          } catch (err) {
            api.logger.warn("[typesafe-ai] Pre-compaction curation failed or timed out.", err);
          }
        },
      );
    }

    // Post-Compaction: Log metrics and audit completion
    if (enableCompactionAudit) {
      api.on(
        "after_compaction",
        async (event: PluginHookAfterCompactionEvent, ctx?: PluginHookAgentContext) => {
          api.logger.debug(
            `[typesafe-ai] Session compacted: ${event.compactedCount} messages condensed into updated session generation.`,
            { sessionId: ctx?.sessionId, previousSessionId: event.previousSessionId },
          );
        },
      );
    }
  }
}

export default {
  id: "typesafe-ai",
  name: "TypeSafe AI Plugin",
  description: "TypeSafe AI (Jev System One) Decision Engine for OpenClaw",
  register,
};
