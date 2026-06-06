import { config } from "../config.js";
import { recordModelUsage, type OpenRouterUsage } from "./usage.js";

// Endpoint confirmed by the M4 spike: OpenRouter /embeddings, dim 2048.
const ENDPOINT = process.env.EMBEDDINGS_ENDPOINT ?? "https://openrouter.ai/api/v1/embeddings";
// Ceiling so a half-open socket can't hang the worker loop indefinitely.
const EMBED_TIMEOUT_MS = 60_000;

// Qwen3-Embedding is asymmetric: the query side gets an instruct prefix while
// documents/passages stay raw. Search queries and watched keywords are the
// query side; items are passages and pass `query` falsey.
const QUERY_PREFIX = "Instruct: Given a search query, retrieve relevant passages.\nQuery: ";

export async function embedTexts(texts: string[], opts: { query?: boolean } = {}): Promise<number[][]> {
  if (texts.length === 0) return [];
  const input = opts.query ? texts.map((t) => QUERY_PREFIX + t) : texts;
  const res = await fetch(ENDPOINT, {
    method: "POST",
    headers: { authorization: `Bearer ${config.OPENROUTER_API_KEY}`, "content-type": "application/json" },
    body: JSON.stringify({ model: config.EMBEDDING_MODEL, input, dimensions: config.EMBEDDING_DIM }),
    signal: AbortSignal.timeout(EMBED_TIMEOUT_MS),
  });
  if (!res.ok) throw new Error(`embeddings ${res.status}: ${await res.text()}`);
  const data = (await res.json()) as { data: { embedding: number[] }[]; usage?: OpenRouterUsage };
  await recordModelUsage("embed", config.EMBEDDING_MODEL, data.usage);
  return data.data.map((d) => d.embedding);
}
