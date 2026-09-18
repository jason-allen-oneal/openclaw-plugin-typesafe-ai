import { describe, it, expect, vi } from "vitest";
import { CompactionCuratorService } from "../src/compaction.js";
import type { ITypeSafeClient } from "../src/types.js";

describe("CompactionCuratorService", () => {
  it("prunes large ephemeral tool logs while preserving chat messages", async () => {
    const mockClient: ITypeSafeClient = {
      noul: vi.fn(),
      choice: vi.fn().mockResolvedValue({
        selected: "ephemeral_log",
        confidence: 0.95,
      }),
      score: vi.fn(),
    };

    const service = new CompactionCuratorService(mockClient);

    const largeBuildLog = "PASS src/index.test.ts\n".repeat(40); // > 400 chars
    const messages = [
      { role: "user", content: "run the test suite" },
      { role: "assistant", content: "I will run the tests now." },
      {
        role: "tool",
        toolName: "bash",
        content: largeBuildLog,
      },
    ];

    const stats = await service.pruneTranscriptMessages(messages);

    expect(stats.originalMessageCount).toBe(3);
    expect(stats.prunedOutputsCount).toBe(1);
    expect(stats.estimatedBytesSaved).toBeGreaterThan(500);

    // Chat messages untouched
    expect(messages[0].content).toBe("run the test suite");
    expect(messages[1].content).toBe("I will run the tests now.");

    // Tool output replaced with concise curator tag
    expect(messages[2].content).toContain("[Omitted by TypeSafe Compaction Curator");
    expect(mockClient.choice).toHaveBeenCalledTimes(1);
  });

  it("preserves essential tool outputs (e.g. error traces or important state)", async () => {
    const mockClient: ITypeSafeClient = {
      noul: vi.fn(),
      choice: vi.fn().mockResolvedValue({
        selected: "essential_state",
        confidence: 0.90,
      }),
      score: vi.fn(),
    };

    const service = new CompactionCuratorService(mockClient);

    const fatalError = "FATAL ERROR: Database connection failed at port 5432\n".repeat(20);
    const messages = [
      {
        role: "tool",
        toolName: "database_query",
        content: fatalError,
      },
    ];

    const stats = await service.pruneTranscriptMessages(messages);

    expect(stats.prunedOutputsCount).toBe(0);
    expect(messages[0].content).toBe(fatalError);
    expect(mockClient.choice).toHaveBeenCalledTimes(1);
  });

  it("checks compaction boundary correctly with Jev Noul", async () => {
    const mockClient: ITypeSafeClient = {
      noul: vi.fn().mockResolvedValue({
        value: true,
        probability: 0.89,
      }),
      choice: vi.fn(),
      score: vi.fn(),
    };

    const service = new CompactionCuratorService(mockClient);
    const boundaryCheck = await service.checkCompactionBoundary("Agent completed task 4/4.");

    expect(boundaryCheck.isSafe).toBe(true);
    expect(boundaryCheck.confidence).toBe(0.89);
    expect(mockClient.noul).toHaveBeenCalledTimes(1);
  });

  it("audits summary fidelity and flags omitted tasks", async () => {
    const mockClient: ITypeSafeClient = {
      noul: vi.fn().mockResolvedValue({
        value: false,
        probability: 0.85,
      }),
      choice: vi.fn(),
      score: vi.fn(),
    };

    const service = new CompactionCuratorService(mockClient);
    const audit = await service.auditSummaryFidelity(
      "Goal: Fix login bug and migrate database.",
      "Summary: Fixed login bug.",
    );

    expect(audit.preserved).toBe(false);
    expect(audit.warning).toBeDefined();
    expect(audit.warning).toContain("Jev warned");
    expect(mockClient.noul).toHaveBeenCalledTimes(1);
  });
});
