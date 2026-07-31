import { z } from "zod";
import { config } from "../../config.js";
import { recordModelUsage, type OpenRouterUsage } from "../usage.js";
import { splitMarkdown } from "./translate.js";

export interface KbNote {
  overview: string;
  keypoints: string[];
  facts: string[];
  why: string;
  terms: { term: string; def: string }[];
}

const TIMEOUT_MS = 90_000;
// Long bodies are digested map-reduce style: extraction passes over ~10K-char
// chunks, then one synthesis pass over the extracts. A single prompt past the
// note-input cap both misses everything after the cut and dilutes attention
// into generic summaries; the guard below only bounds pathological bodies.
const NOTES_MAX_CHARS = 60_000;
const EXTRACT_CONCURRENCY = 3;

const schema = z.object({
  overview: z.string().catch(""),
  keypoints: z.array(z.string()).catch([]),
  facts: z.array(z.string()).catch([]),
  why: z.string().catch(""),
  terms: z.array(z.object({ term: z.string().catch(""), def: z.string().catch("") })).catch([]),
});

const extractSchema = z.object({
  points: z.array(z.string()).catch([]),
  facts: z.array(z.string()).catch([]),
  terms: z.array(z.object({ term: z.string().catch(""), def: z.string().catch("") })).catch([]),
});

// Shared ban on meta-description: notes must restate what the article SAYS
// (claims, methods, numbers), never describe what the article IS.
const CONCRETE = `笔记写文章说了什么（论断、方法、数字、结论），绝不写“这篇文章/作者介绍了/提供了/涵盖了…”这类元描述。
每条要点都必须是一个可以独立成立的具体陈述，读者不看原文也能获得信息。`;

const SYSTEM = `你是一名资深 AI 资讯编辑。给你一篇文章，请用简体中文整理成结构化知识库笔记。
只返回 JSON：{"overview","keypoints","facts","why","terms"}。
严格忠实：笔记只能包含原文中明确出现的信息。绝不要编造或臆测原文未提及的数字、指标、模型名称、
功能、日期或结论（例如上下文窗口大小、价格、跑分等，如果原文没有就不要写）。
原文可能很短或被截断（可能在句子中间或以省略号"…"结束）；这种情况下只概括确实存在的内容，
不要补全或推测缺失的部分，也不要把原文中带保留的、片面的说法夸大成确定的结论。
${CONCRETE}
- overview：1-4 句，直接给出文章的核心论点和最重要的具体结论；原文很薄时写短一点也可以。
- keypoints：3-8 条核心要点（字符串数组），均须来自原文。
- facts：原文中明确给出的关键数据 / 可验证结论（字符串数组）；没有就空数组，不要凑数。
- why：为什么这篇值得记、与读者的相关性，1-2 句。
- terms：原文出现的术语/人物/工具解释，元素为 {"term","def"}；没有就空数组。`;

const EXTRACT_SYSTEM = `你是一名资深 AI 资讯编辑。给你长文的一个片段，请用简体中文提取其中的信息。
只返回 JSON：{"points","facts","terms"}。
严格忠实：只提取片段中明确出现的信息，绝不编造。片段可能开始或结束于句子中间，只提取完整可确认的内容。
${CONCRETE}
- points：该片段的核心论断/方法/结论（字符串数组），3-8 条，信息密度优先。
- facts：片段中明确给出的数字/数据/可验证结论；没有就空数组。
- terms：片段中出现并被解释的术语/人物/工具，元素为 {"term","def"}；没有就空数组。`;

const REDUCE_SYSTEM = `你是一名资深 AI 资讯编辑。下面是同一篇长文各片段已提取的要点集合（JSON），
请把它们合成一份结构化知识库笔记。只返回 JSON：{"overview","keypoints","facts","why","terms"}。
严格忠实：只使用提取结果中出现的信息，绝不补充外部知识；合并重复、去掉琐碎，保留贯穿全文的主线。
${CONCRETE}
- overview：1-4 句，直接给出全文的核心论点和最重要的具体结论。
- keypoints：5-10 条，覆盖全文各部分的核心论断，不要只集中在开头。
- facts：合并所有片段的关键数据，去重；没有就空数组。
- why：为什么这篇值得记，1-2 句。
- terms：合并去重的术语表；没有就空数组。`;

async function callModel(system: string, user: string): Promise<string> {
  const res = await fetch("https://openrouter.ai/api/v1/chat/completions", {
    method: "POST",
    headers: { authorization: `Bearer ${config.OPENROUTER_API_KEY}`, "content-type": "application/json" },
    body: JSON.stringify({
      model: config.SCORING_MODEL,
      response_format: { type: "json_object" },
      messages: [
        { role: "system", content: system },
        { role: "user", content: user },
      ],
    }),
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  if (!res.ok) throw new Error(`notes ${res.status}: ${await res.text()}`);
  const data = (await res.json()) as { choices: { message: { content: string } }[]; usage?: OpenRouterUsage };
  await recordModelUsage("kb", config.SCORING_MODEL, data.usage);
  return data.choices[0]!.message.content;
}

export async function synthesizeNotes(input: { title: string; markdown: string }): Promise<KbNote> {
  const text = (input.markdown ?? "").slice(0, NOTES_MAX_CHARS);

  // Short bodies: one pass, as before.
  if (text.length <= config.KB_NOTE_INPUT_CHARS) {
    const out = await callModel(SYSTEM, `标题：${input.title}\n\n${text}`);
    return schema.parse(JSON.parse(out));
  }

  // Map: extract per chunk (bounded concurrency, order preserved).
  const chunks = splitMarkdown(text, 10_000);
  const extracts = new Array<z.infer<typeof extractSchema>>(chunks.length);
  let next = 0;
  const workers = Array.from({ length: Math.min(EXTRACT_CONCURRENCY, chunks.length) }, async () => {
    for (let i = next++; i < chunks.length; i = next++) {
      const out = await callModel(
        EXTRACT_SYSTEM,
        `标题：${input.title}（片段 ${i + 1}/${chunks.length}）\n\n${chunks[i]}`,
      );
      extracts[i] = extractSchema.parse(JSON.parse(out));
    }
  });
  await Promise.all(workers);

  // Reduce: synthesize the final note from the extracts.
  const out = await callModel(
    REDUCE_SYSTEM,
    `标题：${input.title}\n\n${JSON.stringify(extracts, null, 1)}`,
  );
  return schema.parse(JSON.parse(out));
}
