import { z } from "zod";
import { config } from "../../config.js";
import { recordModelUsage, type OpenRouterUsage } from "../usage.js";

export interface KbNote {
  overview: string;
  keypoints: string[];
  facts: string[];
  why: string;
  terms: { term: string; def: string }[];
}

const TIMEOUT_MS = 90_000;

const schema = z.object({
  overview: z.string().catch(""),
  keypoints: z.array(z.string()).catch([]),
  facts: z.array(z.string()).catch([]),
  why: z.string().catch(""),
  terms: z.array(z.object({ term: z.string().catch(""), def: z.string().catch("") })).catch([]),
});

const SYSTEM = `你是一名资深 AI 资讯编辑。给你一篇文章，请用简体中文整理成结构化知识库笔记。
只返回 JSON：{"overview","keypoints","facts","why","terms"}。
- overview：2-4 句概述，抓住具体技术实质，不要套话。
- keypoints：3-6 条核心要点（字符串数组）。
- facts：关键数据 / 可验证结论（字符串数组）；没有就空数组。
- why：为什么这篇值得记、与读者的相关性，1-2 句。
- terms：出现的术语/人物/工具解释，元素为 {"term","def"}；没有就空数组。`;

export async function synthesizeNotes(input: { title: string; markdown: string }): Promise<KbNote> {
  const res = await fetch("https://openrouter.ai/api/v1/chat/completions", {
    method: "POST",
    headers: { authorization: `Bearer ${config.OPENROUTER_API_KEY}`, "content-type": "application/json" },
    body: JSON.stringify({
      model: config.SCORING_MODEL,
      response_format: { type: "json_object" },
      messages: [
        { role: "system", content: SYSTEM },
        { role: "user", content: `标题：${input.title}\n\n${input.markdown.slice(0, config.KB_NOTE_INPUT_CHARS)}` },
      ],
    }),
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  if (!res.ok) throw new Error(`notes ${res.status}: ${await res.text()}`);
  const data = (await res.json()) as { choices: { message: { content: string } }[]; usage?: OpenRouterUsage };
  await recordModelUsage("kb", config.SCORING_MODEL, data.usage);
  return schema.parse(JSON.parse(data.choices[0]!.message.content));
}
