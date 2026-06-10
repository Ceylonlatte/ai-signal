// Confirmed SCORING_MODEL slug (M2 Task 1): keep in sync with .env SCORING_MODEL.
import { z } from "zod";
import { config } from "../../config.js";
import { RUBRIC } from "./rubric.js";
import { recordModelUsage, type OpenRouterUsage } from "../usage.js";
import type { Candidate } from "./prefilter.js";

// Lenient: real LLMs occasionally over-produce topics or push value out of
// range. Clamp/truncate instead of rejecting the whole batch.
const resultSchema = z.object({
  id: z.number(),
  value: z.number().catch(0).transform((v) => Math.max(0, Math.min(100, v))),
  topics: z.array(z.string()).catch([]).transform((a) => a.slice(0, 3)),
  reason: z.string().catch(""),
});
const responseSchema = z.object({ results: z.array(resultSchema) });

export type ScoreResult = z.infer<typeof resultSchema>;

const BATCH = 25;
// Cap on in-flight scoring requests. Chunks are otherwise independent, so
// running a few concurrently turns ~N serial round-trips into ~N/CONCURRENCY.
// Kept small to stay under OpenRouter rate limits.
const CONCURRENCY = 4;
// Ceiling, not an expected wait: a single chunk is bounded but can be slow.
// Without this an idle/half-open socket would hang the worker loop forever.
const LLM_TIMEOUT_MS = 120_000;

export async function scoreBatch(candidates: Candidate[]): Promise<Map<number, ScoreResult>> {
  const chunks: Candidate[][] = [];
  for (let i = 0; i < candidates.length; i += BATCH) {
    const chunk = candidates.slice(i, i + BATCH);
    if (chunk.length > 0) chunks.push(chunk);
  }

  const out = new Map<number, ScoreResult>();
  // Shared cursor: each worker pulls the next chunk, so at most CONCURRENCY
  // requests are ever in flight. `next++` is atomic in single-threaded JS.
  let next = 0;
  async function worker(): Promise<void> {
    while (next < chunks.length) {
      const chunk = chunks[next++]!;
      const results = await scoreChunk(chunk);
      for (const r of results) out.set(r.id, r);
    }
  }
  await Promise.all(
    Array.from({ length: Math.min(CONCURRENCY, chunks.length) }, () => worker()),
  );
  return out;
}

async function scoreChunk(chunk: Candidate[]): Promise<ScoreResult[]> {
  const itemsBlock = chunk.map((c) =>
    `- id=${c.id} | source=${c.source} | metrics=${JSON.stringify(c.metrics)}\n  title: ${c.title}\n  text: ${c.text.slice(0, 500)}`,
  ).join("\n");

  const res = await fetch("https://openrouter.ai/api/v1/chat/completions", {
    method: "POST",
    headers: {
      authorization: `Bearer ${config.OPENROUTER_API_KEY}`,
      "content-type": "application/json",
    },
    body: JSON.stringify({
      model: config.SCORING_MODEL,
      response_format: { type: "json_object" },
      messages: [
        { role: "system", content: `${RUBRIC}\nReturn JSON: {"results":[{"id","value","topics","reason"}]}` },
        { role: "user", content: itemsBlock },
      ],
    }),
    signal: AbortSignal.timeout(LLM_TIMEOUT_MS),
  });
  if (!res.ok) throw new Error(`OpenRouter ${res.status}: ${await res.text()}`);
  const data = (await res.json()) as { choices: { message: { content: string } }[]; usage?: OpenRouterUsage };
  await recordModelUsage("score", config.SCORING_MODEL, data.usage);
  const parsed = responseSchema.parse(JSON.parse(data.choices[0]!.message.content));
  return parsed.results;
}

// Event-style Chinese label. Generic category words (company names, "AI
// Coding") make every hot topic look the same, so the prompt explicitly
// pushes toward the concrete event the headlines share.
const LABEL_PROMPT =
  "以下是同一话题下的 AI 资讯标题。用中文给这个话题起一个 4~16 字的标题，概括它们共同讨论的具体事件或主题。" +
  "产品名、公司名、模型名保留英文原文。优先描述具体事件（如「Claude Fable 5 发布」），" +
  "避免只用宽泛分类词（如「Anthropic」「AI Coding」）。只回复标题本身，不要引号和其他内容。";

export async function labelTopic(titles: string[]): Promise<string> {
  const res = await fetch("https://openrouter.ai/api/v1/chat/completions", {
    method: "POST",
    headers: { authorization: `Bearer ${config.OPENROUTER_API_KEY}`, "content-type": "application/json" },
    body: JSON.stringify({
      model: config.SCORING_MODEL,
      messages: [
        { role: "system", content: LABEL_PROMPT },
        { role: "user", content: titles.slice(0, 8).join("\n") },
      ],
    }),
    signal: AbortSignal.timeout(LLM_TIMEOUT_MS),
  });
  if (!res.ok) throw new Error(`label ${res.status}`);
  const data = (await res.json()) as { choices: { message: { content: string } }[]; usage?: OpenRouterUsage };
  await recordModelUsage("label", config.SCORING_MODEL, data.usage);
  return data.choices[0]!.message.content.trim().slice(0, 60);
}
