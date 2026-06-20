import { config } from "../../config.js";
import { recordModelUsage, type OpenRouterUsage } from "../usage.js";

// Cap the translate input so a very long body can't blow up tokens/latency. The
// detail page's Chinese rendering is truncated past this; the original (bodyMd)
// is always kept in full and shown via the "原文" toggle.
const TRANSLATE_MAX_CHARS = 16_000;
const TIMEOUT_MS = 90_000;

const CJK = /[\u4e00-\u9fff]/g;
const LATIN = /[a-zA-Z]/g;

// True when the text is predominantly NOT Chinese, so we should translate it.
// Mixed/Chinese content (CJK at least ~30% of letter-ish chars) is left as-is to
// avoid wasting tokens re-translating what's already readable.
export function needsTranslation(text: string): boolean {
  const s = (text ?? "").trim();
  if (s.length === 0) return false;
  const cjk = (s.match(CJK) ?? []).length;
  const latin = (s.match(LATIN) ?? []).length;
  if (cjk + latin === 0) return false; // no letters (urls/numbers/emoji) → nothing to translate
  return cjk / (cjk + latin) < 0.3;
}

const SYSTEM = `你是专业的中英技术翻译。把用户给的 Markdown 文本完整翻译成简体中文。
要求：
- 保留原有 Markdown 结构（标题、列表缩进、引用、代码块、链接、图片）。
- 代码块、行内代码、URL、@用户名、专有名词缩写保持原样不译。
- 忠实翻译，不增删内容、不加解释。
- 只输出翻译后的 Markdown 正文，不要任何前后缀说明。`;

// Translate a Markdown document to Simplified Chinese via the scoring model.
// Returns "" for empty input. Caller decides whether to call (via needsTranslation).
export async function translateToZh(markdown: string): Promise<string> {
  const input = (markdown ?? "").slice(0, TRANSLATE_MAX_CHARS);
  if (input.trim().length === 0) return "";
  const res = await fetch("https://openrouter.ai/api/v1/chat/completions", {
    method: "POST",
    headers: { authorization: `Bearer ${config.OPENROUTER_API_KEY}`, "content-type": "application/json" },
    body: JSON.stringify({
      model: config.SCORING_MODEL,
      messages: [
        { role: "system", content: SYSTEM },
        { role: "user", content: input },
      ],
    }),
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  if (!res.ok) throw new Error(`translate ${res.status}: ${await res.text()}`);
  const data = (await res.json()) as { choices: { message: { content: string } }[]; usage?: OpenRouterUsage };
  await recordModelUsage("kb", config.SCORING_MODEL, data.usage);
  return (data.choices[0]?.message.content ?? "").trim();
}
