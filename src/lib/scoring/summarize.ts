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

const SYSTEM = `你是一名资深 AI 资讯编辑。给你一篇文章，请产出一份高质量摘要。
只返回 JSON：{"title_zh","summary_en","summary_zh"}。
严格忠实：摘要只能包含原文中明确出现的信息。绝不要编造或臆测原文未陈述的数字、指标、模型名称、
功能、日期或结论。如果某个数值（例如上下文窗口大小、价格、跑分）原文没有，就不要提。
原文可能很短或被截断（可能在句子中间或以省略号"…"结束）；这种情况下只概括确实存在的内容，
不要补全或编造缺失的部分，也不要把原文中带保留的、片面的说法夸大成确定的结论。
- summary_en：1-4 句精炼的英文摘要，抓住原文确有的具体技术实质（不吹捧、不编造）；原文很薄时短一点也可以。
- summary_zh：summary_en 的忠实完整中文翻译。
- title_zh：自然的中文标题，须反映原文真实立场；不要把有保留的说法夸大成超出原文支撑的更强结论。
专有名词、产品名、模型名（如 Claude Code、Codex、GPT-5.5、token、RAG）保留英文原文。`;

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
