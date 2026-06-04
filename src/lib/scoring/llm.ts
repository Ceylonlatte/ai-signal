// Confirmed SCORING_MODEL slug (M2 Task 1): keep in sync with .env SCORING_MODEL.
import { z } from "zod";
import { config } from "../../config.js";
import { RUBRIC } from "./rubric.js";
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

export async function scoreBatch(candidates: Candidate[]): Promise<Map<number, ScoreResult>> {
  const out = new Map<number, ScoreResult>();
  for (let i = 0; i < candidates.length; i += BATCH) {
    const chunk = candidates.slice(i, i + BATCH);
    if (chunk.length === 0) continue;
    const results = await scoreChunk(chunk);
    for (const r of results) out.set(r.id, r);
  }
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
  });
  if (!res.ok) throw new Error(`OpenRouter ${res.status}: ${await res.text()}`);
  const data = (await res.json()) as { choices: { message: { content: string } }[] };
  const parsed = responseSchema.parse(JSON.parse(data.choices[0]!.message.content));
  return parsed.results;
}

export async function labelTopic(titles: string[]): Promise<string> {
  const res = await fetch("https://openrouter.ai/api/v1/chat/completions", {
    method: "POST",
    headers: { authorization: `Bearer ${config.OPENROUTER_API_KEY}`, "content-type": "application/json" },
    body: JSON.stringify({
      model: config.SCORING_MODEL,
      messages: [
        { role: "system", content: "Give a 2-4 word human topic label for these AI-news headlines. Reply with the label only." },
        { role: "user", content: titles.slice(0, 8).join("\n") },
      ],
    }),
  });
  if (!res.ok) throw new Error(`label ${res.status}`);
  const data = (await res.json()) as { choices: { message: { content: string } }[] };
  return data.choices[0]!.message.content.trim().slice(0, 60);
}
