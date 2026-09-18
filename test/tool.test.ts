import { describe, it, expect, vi } from "vitest";
import { createTypeSafeEvaluateTool } from "../src/tool.js";
import type { ITypeSafeClient } from "../src/types.js";

describe("TypeSafe Evaluate Agent Tool", () => {
  const createMockClient = (): ITypeSafeClient => ({
    noul: vi.fn().mockResolvedValue({ value: true, probability: 0.95, confidence: 0.95 }),
    choice: vi.fn().mockResolvedValue({ selected: "option_a", confidence: 0.88 }),
    score: vi.fn().mockResolvedValue({ level: 4, confidence: 0.92, rawScore: 3 }),
    systemOne: vi.fn().mockResolvedValue({
      q1: { value: true, probability: 0.9 },
      q2: { selected: "fast", confidence: 0.85 },
    }),
  });

  it("exposes proper tool metadata and schema", () => {
    const client = createMockClient();
    const tool = createTypeSafeEvaluateTool(client, "typesafe_evaluate");

    expect(tool.name).toBe("typesafe_evaluate");
    expect(tool.label).toBe("TypeSafe Evaluate");
    expect(tool.parameters).toBeDefined();
    expect(tool.parameters.type).toBe("object");
    expect(typeof tool.execute).toBe("function");

    const jevTool = createTypeSafeEvaluateTool(client, "typesafe_jev");
    expect(jevTool.name).toBe("typesafe_jev");
    expect(jevTool.label).toBe("TypeSafe Jev System One");
  });

  it("validates required operation and state parameters", async () => {
    const client = createMockClient();
    const tool = createTypeSafeEvaluateTool(client);

    const result = await tool.execute("call_1", {} as any);
    expect(result.content[0].text).toContain("Both 'operation' and 'state' parameters are required");
    expect(result.details).toEqual({ error: "missing_required_parameters" });
  });

  it("executes 'noul' binary proposition evaluation", async () => {
    const client = createMockClient();
    const tool = createTypeSafeEvaluateTool(client);

    const result = await tool.execute("call_2", {
      operation: "noul",
      state: "System memory is 95% utilized.",
      proposition: "The host machine is under critical resource pressure.",
    });

    expect(client.noul).toHaveBeenCalledWith({
      state: "System memory is 95% utilized.",
      proposition: "The host machine is under critical resource pressure.",
    });
    expect(result.details).toEqual({ value: true, probability: 0.95, confidence: 0.95 });
    expect(result.content[0].text).toContain('"value": true');
  });

  it("fails 'noul' when proposition is omitted", async () => {
    const client = createMockClient();
    const tool = createTypeSafeEvaluateTool(client);

    const result = await tool.execute("call_3", {
      operation: "noul",
      state: "Some state",
    });

    expect(result.details).toEqual({ error: "missing_proposition" });
    expect(result.content[0].text).toContain("'proposition' is required");
  });

  it("executes 'choice' categorical selection with criteria", async () => {
    const client = createMockClient();
    const tool = createTypeSafeEvaluateTool(client);

    const result = await tool.execute("call_4", {
      operation: "choice",
      state: "High latency in database query.",
      instructions: "Pick the best diagnostic next step:",
      criteria: {
        inspect_indexes: "Check database index fragmentation and query explain plans",
        scale_hardware: "Increase provisioned CPU and memory on the database cluster",
      },
    });

    expect(client.choice).toHaveBeenCalledWith({
      state: "High latency in database query.",
      instructions: "Pick the best diagnostic next step:",
      options: undefined,
      criteria: {
        inspect_indexes: "Check database index fragmentation and query explain plans",
        scale_hardware: "Increase provisioned CPU and memory on the database cluster",
      },
    });
    expect(result.details).toEqual({ selected: "option_a", confidence: 0.88 });
  });

  it("executes 'score' evaluation with rubric", async () => {
    const client = createMockClient();
    const tool = createTypeSafeEvaluateTool(client);

    const rubric = [
      "Level 1: Minimal impact, pure read operation",
      "Level 2: Minor non-destructive write",
      "Level 3: Moderate system change",
      "Level 4: High risk command with destructive potential",
      "Level 5: Critical irreversible system wipe",
    ];

    const result = await tool.execute("call_5", {
      operation: "score",
      state: "rm -rf /var/log/*",
      instructions: "Assess blast radius severity:",
      rubric,
    });

    expect(client.score).toHaveBeenCalledWith({
      state: "rm -rf /var/log/*",
      instructions: "Assess blast radius severity:",
      rubric,
    });
    expect(result.details).toEqual({ level: 4, confidence: 0.92, rawScore: 3 });
  });

  it("fails 'score' when rubric is omitted or empty", async () => {
    const client = createMockClient();
    const tool = createTypeSafeEvaluateTool(client);

    const result = await tool.execute("call_6", {
      operation: "score",
      state: "Some command",
    });

    expect(result.details).toEqual({ error: "missing_rubric" });
  });

  it("executes 'systemOne' batch evaluation", async () => {
    const client = createMockClient();
    const tool = createTypeSafeEvaluateTool(client);

    const questions = {
      is_urgent: { type: "noul", proposition: "This request is urgent." },
      category: {
        type: "choice",
        criteria: { bug: "Software error", billing: "Billing query" },
      },
    };

    const result = await tool.execute("call_7", {
      operation: "systemOne",
      state: "Production server is down!",
      questions,
    });

    expect(client.systemOne).toHaveBeenCalledWith({
      state: "Production server is down!",
      questions,
    });
    expect(result.details).toEqual({
      q1: { value: true, probability: 0.9 },
      q2: { selected: "fast", confidence: 0.85 },
    });
  });

  it("handles client errors gracefully", async () => {
    const client: ITypeSafeClient = {
      noul: vi.fn().mockRejectedValue(new Error("TypeSafe API rate limit exceeded")),
      choice: vi.fn(),
      score: vi.fn(),
    };
    const tool = createTypeSafeEvaluateTool(client);

    const result = await tool.execute("call_8", {
      operation: "noul",
      state: "Some state",
      proposition: "Some proposition",
    });

    expect(result.details).toEqual({ error: "TypeSafe API rate limit exceeded" });
    expect(result.content[0].text).toContain("TypeSafe Jev evaluation failed: TypeSafe API rate limit exceeded");
  });
});
