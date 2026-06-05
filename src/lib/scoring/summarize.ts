import { z } from "zod";
import { config } from "../../config.js";
import { recordModelUsage, type OpenRouterUsage } from "../usage.js";

export interface BilingualSummary { titleZh: string; summaryEn: string; summaryZh: string; }

// Ceiling so a half-open socket can't hang the worker loop indefinitely.
const SUMMARIZE_TIMEOUT_MS = 90_000;

const schema = z.object({
  title_zh: z.string().catch(""),
  summary_en: z.string().catch(""),
  summary_zh: z.string().catch(""),
});

const SYSTEM = `You are a senior AI-news editor. Given an article, produce a high-quality summary.
Return JSON: {"title_zh","summary_en","summary_zh"}.
- summary_en: 2-4 crisp sentences capturing the concrete technical substance (no hype).
- summary_zh: a faithful full Chinese translation of summary_en.
- title_zh: a natural Chinese title.`;

export async function summarizeBilingual(input: { title: string; text: string }): Promise<BilingualSummary> {
  const res = await fetch("https://openrouter.ai/api/v1/chat/completions", {
    method: "POST",
    headers: { authorization: `Bearer ${config.OPENROUTER_API_KEY}`, "content-type": "application/json" },
    body: JSON.stringify({
      model: config.SCORING_MODEL,
      response_format: { type: "json_object" },
      messages: [
        { role: "system", content: SYSTEM },
        { role: "user", content: `Title: ${input.title}\n\n${input.text.slice(0, 6000)}` },
      ],
    }),
    signal: AbortSignal.timeout(SUMMARIZE_TIMEOUT_MS),
  });
  if (!res.ok) throw new Error(`summarize ${res.status}: ${await res.text()}`);
  const data = (await res.json()) as { choices: { message: { content: string } }[]; usage?: OpenRouterUsage };
  await recordModelUsage("summarize", config.SCORING_MODEL, data.usage);
  const parsed = schema.parse(JSON.parse(data.choices[0]!.message.content));
  return { titleZh: parsed.title_zh, summaryEn: parsed.summary_en, summaryZh: parsed.summary_zh };
}
