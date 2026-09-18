import { describe, it, expect, vi, beforeEach } from "vitest";
import { TypeSafeClient } from "@typesafe-ai/sdk";
import { JevClientWrapper, TypeSafeCircuitBreakerError, TypeSafeTimeoutError } from "../src/client.js";

describe("JevClientWrapper Circuit Breaker", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("normal operations stay in CLOSED state when successful", async () => {
    vi.spyOn(TypeSafeClient.prototype, "systemOne").mockResolvedValue({
      model: "jev-1",
      latency_ms: 12,
      answers: {
        q: { type: "noul", noul: 0.9 },
      },
    } as any);

    const client = new JevClientWrapper("test-key", 200, {
      failureThreshold: 3,
      resetTimeoutMs: 1000,
    });

    const res = await client.noul({ state: "hello", proposition: "test" });
    expect(res.value).toBe(true);
    expect(client.getCircuitBreakerState().state).toBe("CLOSED");
    expect(client.getCircuitBreakerState().consecutiveFailures).toBe(0);
  });

  it("trips to OPEN after consecutive failures threshold is reached", async () => {
    vi.spyOn(TypeSafeClient.prototype, "systemOne").mockRejectedValue(
      new Error("Network connection reset by peer"),
    );

    const client = new JevClientWrapper("test-key", 200, {
      failureThreshold: 3,
      resetTimeoutMs: 1000,
    });

    // 1st failure
    await expect(client.noul({ state: "1", proposition: "test" })).rejects.toThrow("Network connection reset");
    expect(client.getCircuitBreakerState().state).toBe("CLOSED");
    expect(client.getCircuitBreakerState().consecutiveFailures).toBe(1);

    // 2nd failure
    await expect(client.noul({ state: "2", proposition: "test" })).rejects.toThrow("Network connection reset");
    expect(client.getCircuitBreakerState().state).toBe("CLOSED");
    expect(client.getCircuitBreakerState().consecutiveFailures).toBe(2);

    // 3rd failure: trips to OPEN
    await expect(client.noul({ state: "3", proposition: "test" })).rejects.toThrow("Network connection reset");
    expect(client.getCircuitBreakerState().state).toBe("OPEN");
    expect(client.getCircuitBreakerState().consecutiveFailures).toBe(3);

    // 4th call fails fast immediately with TypeSafeCircuitBreakerError without hitting backend
    const startTime = Date.now();
    await expect(client.noul({ state: "4", proposition: "test" })).rejects.toThrow(TypeSafeCircuitBreakerError);
    const duration = Date.now() - startTime;
    // Fast-fail must be instant (< 10ms), not waiting for timeout
    expect(duration).toBeLessThan(50);
  });

  it("recovers from OPEN to HALF_OPEN after cooldown and returns to CLOSED on success", async () => {
    const mockSystemOne = vi.spyOn(TypeSafeClient.prototype, "systemOne");
    mockSystemOne.mockRejectedValue(new Error("Downstream outage"));

    const client = new JevClientWrapper("test-key", 200, {
      failureThreshold: 2,
      resetTimeoutMs: 100, // 100ms short cooldown for testing
    });

    // Trigger 2 failures to trip breaker
    await expect(client.noul({ state: "1", proposition: "test" })).rejects.toThrow();
    await expect(client.noul({ state: "2", proposition: "test" })).rejects.toThrow();
    expect(client.getCircuitBreakerState().state).toBe("OPEN");

    // Immediately calling still fast-fails
    await expect(client.noul({ state: "3", proposition: "test" })).rejects.toThrow(TypeSafeCircuitBreakerError);

    // Wait for resetTimeoutMs cooldown
    await new Promise((resolve) => setTimeout(resolve, 120));

    // Backend has recovered
    mockSystemOne.mockResolvedValue({
      model: "jev-1",
      latency_ms: 10,
      answers: {
        q: { type: "noul", noul: 0.85 },
      },
    } as any);

    // Probing call should succeed and close the circuit breaker
    const probeRes = await client.noul({ state: "probe", proposition: "test" });
    expect(probeRes.value).toBe(true);
    expect(client.getCircuitBreakerState().state).toBe("CLOSED");
    expect(client.getCircuitBreakerState().consecutiveFailures).toBe(0);
  });

  it("enforces timeout with TypeSafeTimeoutError", async () => {
    vi.spyOn(TypeSafeClient.prototype, "systemOne").mockImplementation(
      () => new Promise((resolve) => setTimeout(resolve, 500)),
    );

    const client = new JevClientWrapper("test-key", 50, {
      failureThreshold: 5,
    });

    await expect(client.noul({ state: "slow", proposition: "test" })).rejects.toThrow(TypeSafeTimeoutError);
  });
});
