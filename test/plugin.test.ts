import { describe, it, expect, vi, beforeEach } from "vitest";
import { register } from "../src/index.js";
import type { OpenClawPluginApi } from "../src/types.js";

describe("TypeSafe AI Plugin Registration", () => {
  let mockApi: OpenClawPluginApi;
  const registeredHooks: Record<string, Function> = {};

  beforeEach(() => {
    delete process.env.TYPESAFE_API_KEY;
    registeredHooks["inbound_claim"] = vi.fn();
    registeredHooks["before_tool_call"] = vi.fn();

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
    };
  });

  it("remains dormant if no API key is provided", () => {
    register(mockApi);

    expect(mockApi.logger.debug).toHaveBeenCalledWith(
      expect.stringContaining("No TYPESAFE_API_KEY found"),
    );
    expect(mockApi.on).not.toHaveBeenCalled();
  });

  it("registers hooks when API key is present in environment", () => {
    process.env.TYPESAFE_API_KEY = "ts_live_test123";

    register(mockApi);

    expect(mockApi.logger.info).toHaveBeenCalledWith(
      expect.stringContaining("Initialized Jev System One"),
      expect.any(Object),
    );
    expect(mockApi.on).toHaveBeenCalledWith("inbound_claim", expect.any(Function));
    expect(mockApi.on).toHaveBeenCalledWith("before_tool_call", expect.any(Function));
    expect(mockApi.on).toHaveBeenCalledWith("before_compaction", expect.any(Function));
    expect(mockApi.on).toHaveBeenCalledWith("after_compaction", expect.any(Function));
  });

  it("registers hooks when API key is present in plugin config", () => {
    mockApi.config.plugins = {
      entries: {
        "typesafe-ai": {
          config: {
            apiKey: "ts_live_from_config",
            features: {
              groupChatTriage: true,
              toolSafetyGate: true,
              modelComplexityRouting: true,
            },
          },
        },
      },
    };

    register(mockApi);

    expect(mockApi.on).toHaveBeenCalledWith("inbound_claim", expect.any(Function));
    expect(mockApi.on).toHaveBeenCalledWith("before_tool_call", expect.any(Function));
    expect(mockApi.on).toHaveBeenCalledWith("before_model_resolve", expect.any(Function));
  });
});
