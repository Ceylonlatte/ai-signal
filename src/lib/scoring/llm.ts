// Confirmed SCORING_MODEL slug (M2 Task 1): keep in sync with .env SCORING_MODEL.
import { z } from "zod";
import { config } from "../../config.js";
import { RUBRIC } from "./rubric.js";
import type { Candidate } from "./prefilter.js";

const resultSchema = z.object({
  id: z.number(),
  value: z.number().min(0).max(100),
  topics: z.array(z.string()).max(3).default([]),
  reason: z.string().default(""),
  summary: z.string().default(""),
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
        { role: "system", content: `${RUBRIC}\nReturn JSON: {"results":[{"id","value","topics","reason","summary"}]}` },
        { role: "user", content: itemsBlock },
      ],
    }),
  });
  if (!res.ok) throw new Error(`OpenRouter ${res.status}: ${await res.text()}`);
  const data = (await res.json()) as { choices: { message: { content: string } }[] };
  const parsed = responseSchema.parse(JSON.parse(data.choices[0]!.message.content));
  return parsed.results;
}
