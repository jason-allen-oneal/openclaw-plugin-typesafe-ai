import { describe, it, expect, vi, beforeEach } from "vitest";
import { register } from "../src/index.js";
import type { OpenClawPluginApi } from "../src/types.js";

describe("TypeSafe AI Plugin Registration", () => {
  let mockApi: OpenClawPluginApi;
  const registeredHooks: Record<string, Function> = {};
  const registeredTools: Array<{ tool: any; opts?: any }> = [];

  beforeEach(() => {
    delete process.env.TYPESAFE_API_KEY;
    for (const key of Object.keys(registeredHooks)) {
      delete registeredHooks[key];
    }
    registeredTools.length = 0;

    mockApi = {
      config: {
        plugins: {
          entries: {},
        },
      },
      logger: {
        debug: vi.fn(),
        info: vi.fn(),
        warn: vi.fn(),
        error: vi.fn(),
      },
      on: vi.fn((event: string, handler: Function) => {
        registeredHooks[event] = handler;
      }),
      registerTool: vi.fn((tool: any, opts?: any) => {
        registeredTools.push({ tool, opts });
      }),
    };
  });

  it("remains dormant if no API key is provided", () => {
    register(mockApi);

    expect(mockApi.logger.debug).toHaveBeenCalledWith(
      expect.stringContaining("No TYPESAFE_API_KEY found"),
    );
    expect(mockApi.on).not.toHaveBeenCalled();
    expect(mockApi.registerTool).not.toHaveBeenCalled();
  });

  it("registers hooks and manual agent tools when API key is present in environment", () => {
    process.env.TYPESAFE_API_KEY = "ts_live_test123";

    register(mockApi);

    expect(mockApi.logger.info).toHaveBeenCalledWith(
      expect.stringContaining("Initialized Jev System One"),
      expect.any(Object),
    );
    expect(mockApi.registerTool).toHaveBeenCalledWith(
      expect.objectContaining({ name: "typesafe_evaluate" }),
      { name: "typesafe_evaluate" },
    );
    expect(mockApi.registerTool).toHaveBeenCalledWith(
      expect.objectContaining({ name: "typesafe_jev" }),
      { name: "typesafe_jev" },
    );
    expect(mockApi.on).toHaveBeenCalledWith("before_dispatch", expect.any(Function));
    expect(mockApi.on).toHaveBeenCalledWith("inbound_claim", expect.any(Function));
    expect(mockApi.on).toHaveBeenCalledWith("before_tool_call", expect.any(Function));
    expect(mockApi.on).toHaveBeenCalledWith("before_compaction", expect.any(Function));
    expect(mockApi.on).toHaveBeenCalledWith("after_compaction", expect.any(Function));
  });

  it("exposes manual Jev tools even when every automatic hook is disabled", () => {
    mockApi.config.plugins = {
      entries: {
        "typesafe-ai": {
          config: {
            apiKey: "ts_live_from_config",
            features: {
              groupChatTriage: false,
              toolSafetyGate: false,
              modelComplexityRouting: false,
              promptInjectionAudit: false,
              compactionCuration: false,
              compactionFidelityAudit: false,
            },
          },
        },
      },
    };

    register(mockApi);

    // No event hooks should be registered
    expect(mockApi.on).not.toHaveBeenCalled();

    // But manual tools MUST be registered so the plugin is not inert
    expect(mockApi.registerTool).toHaveBeenCalledWith(
      expect.objectContaining({ name: "typesafe_evaluate" }),
      { name: "typesafe_evaluate" },
    );
    expect(mockApi.registerTool).toHaveBeenCalledWith(
      expect.objectContaining({ name: "typesafe_jev" }),
      { name: "typesafe_jev" },
    );
    expect(registeredTools.length).toBe(2);
  });

  it("suppresses chatter via before_dispatch hook", async () => {
    const { JevClientWrapper } = await import("../src/client.js");
    vi.spyOn(JevClientWrapper.prototype, "noul").mockResolvedValue({
      value: false,
      probability: 0.05,
      confidence: 0.95,
    });

    mockApi.config.plugins = {
      entries: {
        "typesafe-ai": {
          config: {
            apiKey: "ts_live_from_config",
            features: {
              groupChatTriage: true,
            },
          },
        },
      },
    };

    register(mockApi);

    const beforeDispatchHandler = registeredHooks["before_dispatch"];
    expect(beforeDispatchHandler).toBeDefined();

    // In a group channel, a chatter message should be evaluated and suppressed
    const result = await beforeDispatchHandler({
      channel: "slack-random",
      body: "anyone have a good taco recommendation?",
      isGroup: true,
    });

    expect(result).toEqual({ handled: true });
    expect(mockApi.logger.debug).toHaveBeenCalledWith(
      expect.stringContaining("Suppressed group chatter in slack-random (95% confidence)"),
    );
  });

  it("fails closed on high-risk tool when safety check encounters an error in secure mode", async () => {
    mockApi.config.plugins = {
      entries: {
        "typesafe-ai": {
          config: {
            apiKey: "ts_live_from_config",
            safetyFailMode: "secure",
          },
        },
      },
    };

    register(mockApi);

    const beforeToolCallHandler = registeredHooks["before_tool_call"];
    expect(beforeToolCallHandler).toBeDefined();

    // Invoking with exec which will fail inside unmocked network client
    const result = await beforeToolCallHandler({
      toolName: "exec",
      params: { command: "dangerous script" },
    });

    expect(result).toBeDefined();
    expect(result.requireApproval).toBeDefined();
    expect(result.requireApproval.severity).toBe("critical");
    expect(mockApi.logger.warn).toHaveBeenCalledWith(
      expect.stringContaining("Security check failed or timed out for high-risk tool 'exec'"),
      expect.anything(),
    );
  });

  it("captures goals in before_compaction and audits fidelity in after_compaction", async () => {
    const { JevClientWrapper } = await import("../src/client.js");
    vi.spyOn(JevClientWrapper.prototype, "noul").mockResolvedValue({
      value: false,
      probability: 0.1,
      confidence: 0.9,
    });

    mockApi.config.plugins = {
      entries: {
        "typesafe-ai": {
          config: {
            apiKey: "ts_live_from_config",
            features: {
              compactionCuration: false, // only test fidelity audit
              compactionFidelityAudit: true,
            },
          },
        },
      },
    };

    register(mockApi);

    const beforeCompactionHandler = registeredHooks["before_compaction"];
    const afterCompactionHandler = registeredHooks["after_compaction"];

    expect(beforeCompactionHandler).toBeDefined();
    expect(afterCompactionHandler).toBeDefined();

    // 1. Before compaction: pass original transcript messages with goals
    await beforeCompactionHandler(
      {
        messageCount: 10,
        messages: [
          { role: "user", content: "Implement the OAuth2 login flow and add tests." },
          { role: "assistant", content: "I have started working on the config." },
        ],
      },
      { sessionId: "session_abc" },
    );

    // 2. After compaction: pass summary lacking the goals
    await afterCompactionHandler(
      {
        messageCount: 2,
        compactedCount: 8,
        summary: "The agent started working on config.",
      },
      { sessionId: "session_abc" },
    );

    // Should have actively warned that goals were dropped
    expect(mockApi.logger.warn).toHaveBeenCalledWith(
      expect.stringContaining("Post-compaction fidelity warning: Jev warned that compacted summary may have lost critical goals"),
      expect.objectContaining({ sessionId: "session_abc", confidence: 0.9 }),
    );
  });
});
