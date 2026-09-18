import { describe, it, expect, vi } from "vitest";
import { ToolGuardrailService } from "../src/guardrails.js";
import type { ITypeSafeClient, BeforeToolCallEvent } from "../src/types.js";

describe("ToolGuardrailService", () => {
  it("skips safe read-only inspection tools immediately", async () => {
    const mockClient: ITypeSafeClient = {
      noul: vi.fn(),
      choice: vi.fn(),
      score: vi.fn(),
    };

    const service = new ToolGuardrailService(mockClient);
    const event: BeforeToolCallEvent = {
      toolName: "read_file",
      params: { path: "/etc/hosts" },
    };

    const result = await service.assessToolCall(event);
    expect(result).toBeNull();
    expect(mockClient.score).not.toHaveBeenCalled();
  });

  it("permits low risk operations directly (level < 4)", async () => {
    const mockClient: ITypeSafeClient = {
      noul: vi.fn(),
      choice: vi.fn(),
      score: vi.fn().mockResolvedValue({ level: 2, confidence: 0.95 }),
    };

    const service = new ToolGuardrailService(mockClient, 4);
    const event: BeforeToolCallEvent = {
      toolName: "write_file",
      params: { path: "scratch/notes.txt", content: "meeting notes" },
    };

    const result = await service.assessToolCall(event);
    expect(result).toBeNull();
    expect(mockClient.score).toHaveBeenCalledTimes(1);
  });

  it("intercepts high risk operations (level >= 4) with approval requirement", async () => {
    const mockClient: ITypeSafeClient = {
      noul: vi.fn(),
      choice: vi.fn(),
      score: vi.fn().mockResolvedValue({ level: 5, confidence: 0.99 }),
    };

    const service = new ToolGuardrailService(mockClient, 4);
    const event: BeforeToolCallEvent = {
      toolName: "exec",
      params: { command: "rm -rf /" },
    };

    const result = await service.assessToolCall(event);
    expect(result).not.toBeNull();
    expect(result?.requireApproval).toBeDefined();
    expect(result?.requireApproval?.severity).toBe("critical");
    expect(result?.requireApproval?.allowedDecisions).toEqual(["allow-once", "deny"]);
    expect(mockClient.score).toHaveBeenCalledTimes(1);
  });
});
