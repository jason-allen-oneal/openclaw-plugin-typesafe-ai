import { describe, it, expect, vi } from "vitest";
import { GroupChatTriageService } from "../src/triage.js";
import type { ITypeSafeClient, InboundClaimEvent } from "../src/types.js";

describe("GroupChatTriageService", () => {
  it("never suppresses 1:1 direct messages", async () => {
    const mockClient: ITypeSafeClient = {
      noul: vi.fn(),
      choice: vi.fn(),
      score: vi.fn(),
    };

    const service = new GroupChatTriageService(mockClient);
    const event: InboundClaimEvent = {
      content: "hey what's up",
      channel: "telegram",
      conversationId: "dm_123",
      isGroup: false,
    };

    const result = await service.evaluateGroupMessage(event);
    expect(result.shouldSuppress).toBe(false);
    expect(mockClient.noul).not.toHaveBeenCalled();
  });

  it("never suppresses explicit slash commands", async () => {
    const mockClient: ITypeSafeClient = {
      noul: vi.fn(),
      choice: vi.fn(),
      score: vi.fn(),
    };

    const service = new GroupChatTriageService(mockClient);
    const event: InboundClaimEvent = {
      content: "/status",
      channel: "discord",
      conversationId: "channel_456",
      isGroup: true,
    };

    const result = await service.evaluateGroupMessage(event);
    expect(result.shouldSuppress).toBe(false);
    expect(mockClient.noul).not.toHaveBeenCalled();
  });

  it("never suppresses messages explicitly mentioning the bot", async () => {
    const mockClient: ITypeSafeClient = {
      noul: vi.fn(),
      choice: vi.fn(),
      score: vi.fn(),
    };

    const service = new GroupChatTriageService(mockClient);
    const event: InboundClaimEvent = {
      content: "can openclaw check my git status?",
      channel: "discord",
      conversationId: "channel_456",
      isGroup: true,
    };

    const result = await service.evaluateGroupMessage(event, ["openclaw"]);
    expect(result.shouldSuppress).toBe(false);
    expect(mockClient.noul).not.toHaveBeenCalled();
  });

  it("suppresses casual chatter when Jev evaluates false with high confidence", async () => {
    const mockClient: ITypeSafeClient = {
      noul: vi.fn().mockResolvedValue({ value: false, probability: 0.92 }),
      choice: vi.fn(),
      score: vi.fn(),
    };

    const service = new GroupChatTriageService(mockClient, 0.75);
    const event: InboundClaimEvent = {
      content: "anyone want pizza for lunch?",
      channel: "slack",
      conversationId: "channel_general",
      isGroup: true,
    };

    const result = await service.evaluateGroupMessage(event);
    expect(result.shouldSuppress).toBe(true);
    expect(result.confidence).toBe(0.92);
    expect(mockClient.noul).toHaveBeenCalledTimes(1);
  });

  it("does NOT suppress when Jev evaluates that the assistant is being addressed", async () => {
    const mockClient: ITypeSafeClient = {
      noul: vi.fn().mockResolvedValue({ value: true, probability: 0.88 }),
      choice: vi.fn(),
      score: vi.fn(),
    };

    const service = new GroupChatTriageService(mockClient, 0.75);
    const event: InboundClaimEvent = {
      content: "could someone summarize what happened in the last release?",
      channel: "slack",
      conversationId: "channel_general",
      isGroup: true,
    };

    const result = await service.evaluateGroupMessage(event);
    expect(result.shouldSuppress).toBe(false);
    expect(mockClient.noul).toHaveBeenCalledTimes(1);
  });
});
