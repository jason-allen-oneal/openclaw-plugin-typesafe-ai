import type { ITypeSafeClient } from "./types.js";

export interface TypeSafeEvaluateToolParams {
  operation: "noul" | "choice" | "score" | "systemOne";
  state: string;
  proposition?: string;
  instructions?: string;
  options?: string[];
  criteria?: Record<string, string>;
  rubric?: string[];
  questions?: Record<string, any>;
}

export interface AgentToolTextContent {
  type: "text";
  text: string;
}

export interface AgentToolResult<TDetails = unknown> {
  content: AgentToolTextContent[];
  details?: TDetails;
}

export interface AnyAgentTool {
  name: string;
  label: string;
  description: string;
  parameters: Record<string, unknown>;
  execute: (
    toolCallId: string,
    params: Record<string, unknown>,
    signal?: AbortSignal,
  ) => Promise<AgentToolResult>;
}

export const EVALUATE_TOOL_SCHEMA = {
  type: "object",
  properties: {
    operation: {
      type: "string",
      enum: ["noul", "choice", "score", "systemOne"],
      description:
        "The Jev System One primitive to execute: 'noul' (binary truth/proposition), 'choice' (categorical selection), 'score' (rubric 1-5 level), or 'systemOne' (batch questions).",
    },
    state: {
      type: "string",
      description: "The context, text, prompt, or content state to evaluate.",
    },
    proposition: {
      type: "string",
      description: "Required for 'noul': The statement/proposition to evaluate as true or false.",
    },
    instructions: {
      type: "string",
      description: "Optional for 'choice' and 'score': Instructions guiding the evaluation.",
    },
    options: {
      type: "array",
      items: { type: "string" },
      description: "For 'choice': List of candidate options (required if criteria is not provided).",
    },
    criteria: {
      type: "object",
      additionalProperties: { type: "string" },
      description:
        "For 'choice': Rich criteria mapping each option key to a descriptive condition.",
    },
    rubric: {
      type: "array",
      items: { type: "string" },
      description:
        "Required for 'score': Ordered rubric descriptions (3 to 5 levels) defining score severity/quality.",
    },
    questions: {
      type: "object",
      description:
        "Required for 'systemOne': Batch dictionary of questions mapping question keys to evaluation specifications.",
    },
  },
  required: ["operation", "state"],
  additionalProperties: false,
};

/**
 * Creates an OpenClaw agent tool exposing on-demand TypeSafe Jev System One primitives.
 */
export function createTypeSafeEvaluateTool(
  client: ITypeSafeClient,
  toolName = "typesafe_evaluate",
): AnyAgentTool {
  return {
    name: toolName,
    label: toolName === "typesafe_jev" ? "TypeSafe Jev System One" : "TypeSafe Evaluate",
    description:
      "Direct manual access to TypeSafe AI's Jev System One decision engine. Perform typed, sub-100ms evaluations including binary propositions (noul), categorical selection (choice), rubric scoring (score), and batched evaluations (systemOne).",
    parameters: EVALUATE_TOOL_SCHEMA,
    execute: async (_toolCallId: string, rawParams: Record<string, unknown>, signal?: AbortSignal) => {
      signal?.throwIfAborted();
      const params = rawParams as unknown as TypeSafeEvaluateToolParams;
      const { operation, state } = params;

      if (!operation || !state) {
        return {
          content: [{ type: "text", text: "Error: Both 'operation' and 'state' parameters are required." }],
          details: { error: "missing_required_parameters" },
        };
      }

      try {
        switch (operation) {
          case "noul": {
            if (!params.proposition) {
              return {
                content: [{ type: "text", text: "Error: 'proposition' is required for 'noul' operation." }],
                details: { error: "missing_proposition" },
              };
            }
            const result = await client.noul({
              state: String(state),
              proposition: String(params.proposition),
            });
            return {
              content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
              details: result,
            };
          }

          case "choice": {
            const result = await client.choice({
              state: String(state),
              instructions: params.instructions ? String(params.instructions) : undefined,
              options: Array.isArray(params.options) ? params.options : undefined,
              criteria: params.criteria && typeof params.criteria === "object" ? params.criteria : undefined,
            });
            return {
              content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
              details: result,
            };
          }

          case "score": {
            if (!Array.isArray(params.rubric) || params.rubric.length === 0) {
              return {
                content: [{ type: "text", text: "Error: 'rubric' array is required for 'score' operation." }],
                details: { error: "missing_rubric" },
              };
            }
            const result = await client.score({
              state: String(state),
              instructions: params.instructions ? String(params.instructions) : undefined,
              rubric: params.rubric,
            });
            return {
              content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
              details: result,
            };
          }

          case "systemOne": {
            if (!params.questions || typeof params.questions !== "object") {
              return {
                content: [{ type: "text", text: "Error: 'questions' object is required for 'systemOne' operation." }],
                details: { error: "missing_questions" },
              };
            }
            let result: any;
            if (typeof client.systemOne === "function") {
              result = await client.systemOne({
                state,
                questions: params.questions,
              });
            } else {
              const answers: Record<string, any> = {};
              for (const [qKey, qVal] of Object.entries(params.questions as Record<string, any>)) {
                if (qVal.type === "noul") {
                  answers[qKey] = await client.noul({ state: String(state), proposition: qVal.proposition });
                } else if (qVal.type === "choice") {
                  answers[qKey] = await client.choice({
                    state: String(state),
                    instructions: qVal.instructions,
                    options: qVal.options,
                    criteria: qVal.criteria,
                  });
                } else if (qVal.type === "score") {
                  answers[qKey] = await client.score({
                    state: String(state),
                    instructions: qVal.instructions,
                    rubric: qVal.rubric,
                  });
                }
              }
              result = answers;
            }
            return {
              content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
              details: result,
            };
          }

          default:
            return {
              content: [
                {
                  type: "text",
                  text: `Error: Unsupported operation '${operation}'. Supported operations: 'noul', 'choice', 'score', 'systemOne'.`,
                },
              ],
              details: { error: "unsupported_operation" },
            };
        }
      } catch (err: unknown) {
        const errorMsg = err instanceof Error ? err.message : String(err);
        return {
          content: [{ type: "text", text: `TypeSafe Jev evaluation failed: ${errorMsg}` }],
          details: { error: errorMsg },
        };
      }
    },
  };
}
