import { describe, it, expect, vi, beforeEach } from "vitest";
import { TypeSafeClient } from "@typesafe-ai/sdk";
import { JevClientWrapper } from "../src/client.js";

describe("JevClientWrapper Primitives Integration", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("evaluates noul and correctly sets value, probability, and confidence", async () => {
    vi.spyOn(TypeSafeClient.prototype, "systemOne").mockResolvedValue({
      model: "jev-1.13.0",
      answers: {
        q: { type: "noul", noul: 0.12 },
      },
      usage: { input_tokens: 100, output_tokens: 10 },
    } as any);

    const client = new JevClientWrapper("test-key");
    const res = await client.noul({
      state: "anyone want tacos?",
      proposition: "The user is addressing the assistant",
    });

    expect(res.value).toBe(false);
    expect(res.probability).toBe(0.12);
    // Confidence in FALSE decision is 1 - 0.12 = 0.88
    expect(res.confidence).toBeCloseTo(0.88, 2);
  });

  it("evaluates choice with options or rich criteria", async () => {
    const mockSystemOne = vi.spyOn(TypeSafeClient.prototype, "systemOne").mockResolvedValue({
      model: "jev-1.13.0",
      answers: {
        q: {
          type: "choice",
          choice: "ephemeral_log",
          confidence: 0.94,
          probabilities: { ephemeral_log: 0.94, essential_state: 0.06 },
        },
      },
      usage: { input_tokens: 150, output_tokens: 12 },
    } as any);

    const client = new JevClientWrapper("test-key");
    const res = await client.choice({
      state: "PASS src/index.test.ts",
      instructions: "Is this ephemeral log or essential state?",
      criteria: {
        ephemeral_log: "Test output logs",
        essential_state: "Critical state changes",
      },
    });

    expect(res.selected).toBe("ephemeral_log");
    expect(res.confidence).toBe(0.94);
    expect(res.distribution?.ephemeral_log).toBe(0.94);
    expect(mockSystemOne).toHaveBeenCalledWith(
      expect.objectContaining({
        questions: expect.objectContaining({
          q: expect.objectContaining({
            type: "choice",
            instructions: "Is this ephemeral log or essential state?",
            criteria: {
              ephemeral_log: "Test output logs",
              essential_state: "Critical state changes",
            },
          }),
        }),
      }),
    );
  });

  it("evaluates score and maps 0-indexed API score to 1-indexed risk level", async () => {
    const mockSystemOne = vi.spyOn(TypeSafeClient.prototype, "systemOne").mockResolvedValue({
      model: "jev-1.13.0",
      answers: {
        q: {
          type: "score",
          score: 3.1, // Near index 3 ("4: High-impact action")
          confidence: 0.82,
          legend: { "0": "Safe", "1": "Harmless", "2": "Workspace", "3": "High impact", "4": "Critical" },
          probabilities: { "0": 0, "1": 0, "2": 0.1, "3": 0.7, "4": 0.2 },
        },
      },
      usage: { input_tokens: 180, output_tokens: 20 },
    } as any);

    const client = new JevClientWrapper("test-key");
    const res = await client.score({
      state: "TOOL_CALL: exec rm -rf /",
      instructions: "Rate blast radius:",
      rubric: [
        "Safe",
        "Harmless",
        "Workspace",
        "High impact",
        "Critical",
      ],
    });

    // Score 3.1 rounds to index 3 -> Level 4 on 1-5 scale
    expect(res.level).toBe(4);
    expect(res.rawScore).toBe(3.1);
    expect(res.confidence).toBe(0.82);
  });
});
