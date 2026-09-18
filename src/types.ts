/**
 * Plugin configuration schema.
 */
export interface TypeSafePluginConfig {
  apiKey?: string;
  timeoutMs?: number;
  triageThreshold?: number;
  safetyApprovalLevel?: number;
  features?: {
    groupChatTriage?: boolean;
    toolSafetyGate?: boolean;
    modelComplexityRouting?: boolean;
    promptInjectionAudit?: boolean;
  };
}

/**
 * TypeSafe AI SDK Contract Primitives.
 */
export interface NoulRequest {
  state: string;
  proposition: string;
}

export interface NoulResponse {
  value: boolean;
  probability: number;
}

export interface ChoiceRequest<T extends string = string> {
  state: string;
  options: readonly T[];
}

export interface ChoiceResponse<T extends string = string> {
  selected: T;
  confidence: number;
  distribution?: Record<T, number>;
}

export interface ScoreRequest {
  state: string;
  rubric: readonly string[];
}

export interface ScoreResponse {
  level: number;
  confidence: number;
  distribution?: Record<number, number>;
}

export interface ITypeSafeClient {
  noul(params: NoulRequest): Promise<NoulResponse>;
  choice<T extends string>(params: ChoiceRequest<T>): Promise<ChoiceResponse<T>>;
  score(params: ScoreRequest): Promise<ScoreResponse>;
}

/**
 * OpenClaw Hook Payloads and Results.
 */
export interface InboundClaimEvent {
  content: string;
  channel: string;
  accountId?: string;
  conversationId: string;
  isGroup?: boolean;
}

export interface InboundClaimResult {
  handled?: boolean;
  reason?: string;
}

export interface BeforeToolCallEvent {
  toolName: string;
  params: Record<string, unknown>;
  sessionKey?: string;
}

export interface PluginHookBeforeToolCallResult {
  params?: Record<string, unknown>;
  block?: boolean;
  blockReason?: string;
  requireApproval?: {
    title: string;
    description: string;
    severity?: "info" | "warning" | "critical";
    timeoutMs?: number;
    allowedDecisions?: Array<"allow-once" | "allow-always" | "deny">;
  };
}

export interface BeforeModelResolveEvent {
  prompt?: string;
  currentModel?: string;
  availableModels?: string[];
}

export interface BeforeModelResolveResult {
  modelOverride?: string;
  reason?: string;
}

export interface LlmInputEvent {
  messages: Array<{ role: string; content: string }>;
}

export interface LlmInputResult {
  sanitizedMessages?: Array<{ role: string; content: string }>;
  flagged?: boolean;
  warning?: string;
}

/**
 * OpenClaw Plugin API Facade.
 */
export interface OpenClawPluginLogger {
  debug(msg: string, ...args: unknown[]): void;
  info(msg: string, ...args: unknown[]): void;
  warn(msg: string, ...args: unknown[]): void;
  error(msg: string, ...args: unknown[]): void;
}

export interface OpenClawPluginApi {
  config: {
    plugins?: {
      entries?: Record<string, { config?: unknown }>;
    };
    [key: string]: unknown;
  };
  logger: OpenClawPluginLogger;
  on(event: "inbound_claim", handler: (event: InboundClaimEvent) => Promise<InboundClaimResult | void>): void;
  on(event: "before_tool_call", handler: (event: BeforeToolCallEvent) => Promise<PluginHookBeforeToolCallResult | void>): void;
  on(event: "before_model_resolve", handler: (event: BeforeModelResolveEvent) => Promise<BeforeModelResolveResult | void>): void;
  on(event: "llm_input", handler: (event: LlmInputEvent) => Promise<LlmInputResult | void>): void;
  registerTool?(tool: unknown): void;
}
