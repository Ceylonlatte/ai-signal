import { config } from "../../config.js";
import { recordModelUsage, type OpenRouterUsage } from "../usage.js";

// Long documents are translated in markdown-block chunks: single-shot prompts
// past a few thousand chars make the model silently leave whole paragraphs in
// English, and the old 16K input cap dropped everything after it. Chunks keep
// each call short (high fidelity) and remove the practical length limit; the
// guard below only exists so a pathological body can't run away on tokens.
const TRANSLATE_MAX_CHARS = 60_000;
const CHUNK_TARGET_CHARS = 4_000;
const CONCURRENCY = 3;
const TIMEOUT_MS = 90_000;

const CJK = /[一-鿿]/g;
const LATIN = /[a-zA-Z]/g;
// Kana (hiragana / katakana / halfwidth katakana) and hangul: the scripts that
// tell Japanese and Korean apart from Chinese. Han characters alone can't —
// Japanese prose is mostly kanji by character count, so a CJK-vs-Latin ratio
// reads it as "already Chinese" and silently leaves whole articles untranslated.
const KANA = /[぀-ゟ゠-ヿｦ-ﾝ]/g;
const HANGUL = /[가-힯]/g;
// Kana/hangul share of the ideographic characters. Japanese prose sits far above
// this; a Chinese article quoting a Japanese product name or a ツ kaomoji sits
// far below, so it isn't dragged through a pointless translation pass.
const KANA_RATIO = 0.1;

// True when the text is predominantly NOT Chinese, so we should translate it.
// Mixed/Chinese content (CJK at least ~30% of letter-ish chars) is left as-is to
// avoid wasting tokens re-translating what's already readable.
export function needsTranslation(text: string): boolean {
  const s = (text ?? "").trim();
  if (s.length === 0) return false;
  const cjk = (s.match(CJK) ?? []).length;
  // Japanese/Korean first: they carry Han characters too, so the ratio below
  // would otherwise pass them off as Chinese (and, for kana-only text, the
  // letterless early return would drop them before any ratio ran at all).
  const jk = (s.match(KANA) ?? []).length + (s.match(HANGUL) ?? []).length;
  if (jk > 0 && jk / (cjk + jk) >= KANA_RATIO) return true;
  const latin = (s.match(LATIN) ?? []).length;
  if (cjk + latin === 0) return false; // no letters (urls/numbers/emoji) → nothing to translate
  return cjk / (cjk + latin) < 0.3;
}

/**
 * Split Markdown into translation chunks of roughly `target` chars. Blocks are
 * blank-line-separated groups of lines; a code fence is always kept whole (its
 * interior blank lines don't split), so an oversized fence becomes its own
 * chunk rather than being cut mid-code.
 */
export function splitMarkdown(md: string, target = CHUNK_TARGET_CHARS): string[] {
  const lines = (md ?? "").split("\n");
  const blocks: string[] = [];
  let cur: string[] = [];
  let inFence = false;
  for (const line of lines) {
    if (/^(```|~~~)/.test(line.trim())) inFence = !inFence;
    if (!inFence && line.trim() === "") {
      if (cur.length) { blocks.push(cur.join("\n")); cur = []; }
      continue;
    }
    cur.push(line);
  }
  if (cur.length) blocks.push(cur.join("\n"));

  const chunks: string[] = [];
  let acc = "";
  for (const b of blocks) {
    if (acc && acc.length + b.length + 2 > target) { chunks.push(acc); acc = ""; }
    acc = acc ? `${acc}\n\n${b}` : b;
  }
  if (acc) chunks.push(acc);
  return chunks;
}

const SYSTEM = `你是专业的技术翻译。把用户给的 Markdown 文本完整翻译成简体中文。
原文可能是英文、日文、韩文或其它任何语言；无论原文是什么语言，输出一律是简体中文。
要求：
- 保留原有 Markdown 结构（标题、列表缩进、引用、代码块、链接、图片）。
- 代码块、行内代码、URL、@用户名、专有名词缩写保持原样不译。
- 忠实翻译，不增删内容、不加解释。
- 只输出翻译后的 Markdown 正文，不要任何前后缀说明。`;

async function callModel(input: string): Promise<string> {
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

// Translate one chunk with output QC: a result that is still predominantly
// English means the model skipped translating — retry once, then fall back to
// the original chunk (readable English beats silently dropped content).
async function translateChunk(chunk: string): Promise<string> {
  if (!needsTranslation(chunk)) return chunk; // code-only / already-Chinese chunk: don't let the model touch it
  for (let attempt = 0; attempt < 2; attempt++) {
    const out = await callModel(chunk);
    if (out && !needsTranslation(out)) return out;
  }
  return chunk;
}

// Translate a Markdown document to Simplified Chinese via the scoring model.
// Returns "" for empty input. Caller decides whether to call (via needsTranslation).
export async function translateToZh(markdown: string): Promise<string> {
  const input = (markdown ?? "").slice(0, TRANSLATE_MAX_CHARS);
  if (input.trim().length === 0) return "";
  const chunks = splitMarkdown(input);
  const out = new Array<string>(chunks.length);
  let next = 0;
  const workers = Array.from({ length: Math.min(CONCURRENCY, chunks.length) }, async () => {
    for (let i = next++; i < chunks.length; i = next++) {
      out[i] = await translateChunk(chunks[i]!);
    }
  });
  await Promise.all(workers);
  return out.join("\n\n").trim();
}
