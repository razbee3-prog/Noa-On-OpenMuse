import type { Config } from "../config.ts";

export type ModelTier = "main" | "deep";
type Models = Pick<Config, "model" | "modelDeep">;

/** Tasks start on the main model and move to the deep model once they struggle. */
export function taskModel(config: Models, tier: unknown): { model: string; tier: ModelTier } {
  const deep = config.modelDeep?.trim();
  return tier === "deep" && deep
    ? { model: deep, tier: "deep" }
    : { model: config.model ?? "", tier: "main" };
}

export function nextTier(config: Models, tier: ModelTier): ModelTier | undefined {
  const deep = config.modelDeep?.trim();
  return tier === "main" && deep && deep !== config.model ? "deep" : undefined;
}
