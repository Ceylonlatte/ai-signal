import { config } from "../config.js";
import { recordModelUsage, type OpenRouterUsage } from "./usage.js";

// Endpoint confirmed by the M4 spike: OpenRouter /embeddings, dim 2048.
const ENDPOINT = process.env.EMBEDDINGS_ENDPOINT ?? "https://openrouter.ai/api/v1/embeddings";
// Ceiling so a half-open socket can't hang the worker loop indefinitely.
const EMBED_TIMEOUT_MS = 60_000;

export async function embedTexts(texts: string[]): Promise<number[][]> {
  if (texts.length === 0) return [];
  const res = await fetch(ENDPOINT, {
    method: "POST",
    headers: { authorization: `Bearer ${config.OPENROUTER_API_KEY}`, "content-type": "application/json" },
    body: JSON.stringify({ model: config.EMBEDDING_MODEL, input: texts }),
    signal: AbortSignal.timeout(EMBED_TIMEOUT_MS),
  });
  if (!res.ok) throw new Error(`embeddings ${res.status}: ${await res.text()}`);
  const data = (await res.json()) as { data: { embedding: number[] }[]; usage?: OpenRouterUsage };
  await recordModelUsage("embed", config.EMBEDDING_MODEL, data.usage);
  return data.data.map((d) => d.embedding);
}
