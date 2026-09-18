import type { ITypeSafeClient, BeforeModelResolveEvent, BeforeModelResolveResult } from "./types.js";

export type ComplexityTier = "trivial" | "standard" | "complex";

export class ModelComplexityRouter {
  private client: ITypeSafeClient;
  private utilityModel: string;
  private frontierModel: string;

  constructor(client: ITypeSafeClient, utilityModel = "anthropic/claude-3-5-haiku", frontierModel = "anthropic/claude-3-5-sonnet") {
    this.client = client;
    this.utilityModel = utilityModel;
    this.frontierModel = frontierModel;
  }

  /**
   * Evaluates prompt complexity and overrides the target model dynamically.
   */
  async routeModel(event: BeforeModelResolveEvent): Promise<BeforeModelResolveResult | null> {
    if (!event.prompt) {
      return null;
    }

    const decision = await this.client.choice<ComplexityTier>({
      state: `User prompt: "${event.prompt}"`,
      options: ["trivial", "standard", "complex"],
    });

    if (decision.selected === "trivial" && decision.confidence >= 0.80) {
      return {
        modelOverride: this.utilityModel,
        reason: `TypeSafe Jev routed trivial prompt to fast utility model (${Math.round(decision.confidence * 100)}% confidence)`,
      };
    }

    if (decision.selected === "complex" && decision.confidence >= 0.75) {
      return {
        modelOverride: this.frontierModel,
        reason: `TypeSafe Jev routed complex prompt to frontier model (${Math.round(decision.confidence * 100)}% confidence)`,
      };
    }

    return null;
  }
}
