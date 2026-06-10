import { modelUsage } from "../db/schema.js";

// OpenRouter returns this `usage` object automatically on every chat/embeddings
// response. `cost` is in credits (USD); free models report 0 or omit it.
export interface OpenRouterUsage {
  prompt_tokens?: number;
  completion_tokens?: number;
  total_tokens?: number;
  cost?: number;
}

export type UsageKind = "score" | "summarize" | "label" | "embed" | "merge";

const num = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : 0);

// Persist one model API call's token/cost accounting. Best-effort by design:
// a logging failure must never break the pipeline, and calls without a usage
// payload (e.g. mocked fetch responses in unit tests) are silently skipped so
// model libs stay db-free in isolation. The db client is imported lazily so it
// is only touched on the worker write path, never in pure unit tests.
export async function recordModelUsage(
  kind: UsageKind,
  model: string,
  usage: OpenRouterUsage | undefined | null,
): Promise<void> {
  if (!usage) return;
  const prompt = num(usage.prompt_tokens);
  const completion = num(usage.completion_tokens);
  try {
    const { db } = await import("../db/client.js");
    await db.insert(modelUsage).values({
      kind,
      model,
      promptTokens: prompt,
      completionTokens: completion,
      totalTokens: num(usage.total_tokens) || prompt + completion,
      cost: num(usage.cost),
    });
  } catch (err) {
    console.error("recordModelUsage failed", err);
  }
}
