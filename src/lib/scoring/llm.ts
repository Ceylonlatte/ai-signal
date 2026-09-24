// Confirmed SCORING_MODEL slug (M2 Task 1): keep in sync with .env SCORING_MODEL.
import { z } from "zod";
import { config } from "../../config.js";
import { RUBRIC } from "./rubric.js";
import { recordModelUsage, type OpenRouterUsage } from "../usage.js";
import type { Candidate } from "./prefilter.js";

// The scoring model intermittently returns id as a string ("12345"), so accept
// number-like ids. Deliberately narrower than z.coerce.number(): coercing
// null/true/[] would silently mint a bogus id 0 instead of dropping the entry.
const idSchema = z.union([
  z.number(),
  z.string().trim().regex(/^-?\d+$/).transform(Number),
]).pipe(z.number().int());

// Lenient: real LLMs occasionally over-produce topics or push value out of
// range. Clamp/truncate instead of rejecting the whole batch.
const resultSchema = z.object({
  id: idSchema,
  value: z.number().catch(0).transform((v) => Math.max(0, Math.min(100, v))),
  topics: z.array(z.string()).catch([]).transform((a) => a.slice(0, 3)),
  reason: z.string().catch(""),
});
// Entries stay `unknown` here so one malformed result cannot reject the array:
// each is validated individually in parseChunkResults.
const responseSchema = z.object({ results: z.array(z.unknown()) });

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
  return parseChunkResults(data.choices[0]!.message.content);
}

// A whole chunk of BATCH candidates used to be discarded when a single result
// failed validation, so those raw_items never reached the feed. Parse entries
// one by one and drop only the bad ones. Results whose id is not in the chunk
// are harmless: scoreBatch keys a Map by id and the caller only looks up ids it
// asked about.
export function parseChunkResults(content: string): ScoreResult[] {
  let raw: unknown;
  try {
    raw = JSON.parse(content);
  } catch (err) {
    console.error("scoreChunk: response was not JSON, dropping chunk", err);
    return [];
  }
  const envelope = responseSchema.safeParse(raw);
  if (!envelope.success) {
    console.error("scoreChunk: response had no results array, dropping chunk");
    return [];
  }
  const out: ScoreResult[] = [];
  for (const entry of envelope.data.results) {
    const parsed = resultSchema.safeParse(entry);
    if (parsed.success) out.push(parsed.data);
  }
  const skipped = envelope.data.results.length - out.length;
  if (skipped > 0) {
    console.error(`scoreChunk: skipped ${skipped}/${envelope.data.results.length} malformed results`);
  }
  return out;
}

// Event-style Chinese label. Generic category words (company names, "AI
// Coding") make every hot topic look the same, so the prompt explicitly
// pushes toward the concrete event the headlines share.
//
// The titles are material to summarize, not a question — but the scoring model
// sometimes read them as one and answered in prose ("是的，我很熟悉这个方向。在
// LLM Agent 架构中…"), whose first 60 characters were stored as the topic's
// label on the daily board. So the prompt now asks for the same JSON envelope
// the other calls in this file use: a chat reply is then structurally wrong
// rather than merely undesirable, and isLabelLike() catches what slips past.
const LABEL_PROMPT =
  "以下是同一话题下的 AI 资讯标题，它们是待概括的素材，不是向你提出的问题。" +
  "用中文给这个话题起一个 4~16 字的标题，概括它们共同讨论的具体事件或主题。" +
  "产品名、公司名、模型名保留英文原文。优先描述具体事件（如「Claude Fable 5 发布」），" +
  "避免只用宽泛分类词（如「Anthropic」「AI Coding」）。" +
  "只返回 JSON：{\"label\":\"标题\"}。label 里只放标题本身，不要解释、不要回答问题、不要句号。";

// Sent as a second system message on the retry, so the model sees what was
// wrong with its first answer instead of the identical prompt again.
const LABEL_RETRY_NOTE =
  "上一次回复不是标题，而是一段话。不要寒暄、不要解释、不要回答问题、不要标点句号，" +
  "只返回 JSON：{\"label\":\"4~16 字的标题\"}。";

// Online clustering fragments one event into nearby clusters; the merge stage
// proposes near-centroid pairs and this judge confirms they cover the same
// story before anything is permanently merged.
const JUDGE_PROMPT =
  "下面是两个 AI 资讯话题，各附若干成员标题。判断它们是否在讨论同一个具体事件或同一主题，" +
  "合并成一个话题是否对读者更清晰。只返回 JSON：{\"same\": true 或 false}。";

export type TopicSample = { label: string; titles: string[] };

export async function judgeSameTopic(a: TopicSample, b: TopicSample): Promise<boolean> {
  const block = (name: string, t: TopicSample) =>
    `${name}: ${t.label}\n${t.titles.slice(0, 5).map((s) => `- ${s.slice(0, 120)}`).join("\n")}`;
  const res = await fetch("https://openrouter.ai/api/v1/chat/completions", {
    method: "POST",
    headers: { authorization: `Bearer ${config.OPENROUTER_API_KEY}`, "content-type": "application/json" },
    body: JSON.stringify({
      model: config.SCORING_MODEL,
      response_format: { type: "json_object" },
      messages: [
        { role: "system", content: JUDGE_PROMPT },
        { role: "user", content: `${block("话题A", a)}\n\n${block("话题B", b)}` },
      ],
    }),
    signal: AbortSignal.timeout(LLM_TIMEOUT_MS),
  });
  if (!res.ok) throw new Error(`judge ${res.status}: ${await res.text()}`);
  const data = (await res.json()) as { choices: { message: { content: string } }[]; usage?: OpenRouterUsage };
  await recordModelUsage("merge", config.SCORING_MODEL, data.usage);
  const parsed = z.object({ same: z.boolean() }).parse(JSON.parse(data.choices[0]!.message.content));
  return parsed.same;
}

// The prompt asks for 4~16 characters; the ceiling leaves room for a couple of
// English product names ("LlamaIndex 发布文档解析基准 ParseBench" is 30) while
// still rejecting a truncated paragraph. Nothing longer can reach the db now,
// so a stored label at the old 60-char ceiling is by definition a prose reply.
const LABEL_MAX = 40;
const LABEL_MIN = 2;
// One retry: a second sample of the same model is worth a call, a third is not.
const LABEL_ATTEMPTS = 2;

// A reply that opens by addressing the reader is an answer, not a label.
const PROSE_OPENER =
  /^(是的|不是|没错|好的|当然|抱歉|对不起|收到|明白|很高兴|感谢|作为|根据|首先|其次|以下|下面|这里|我|我们|你|您|sure\b|certainly\b|absolutely\b|of course\b|yes\b|okay\b|here('|’)?s\b|here is\b|i\s+(can|will|would|think|am|have|see|understand)\b|i('|’)(m|ll|d)\b|as an?\b|the following\b)/i;
// Sentence punctuation anywhere — a label is a phrase, not a sentence — or a
// trailing ASCII stop. An interior "." stays legal for "Claude 3.5" / "v1.2".
const SENTENCE_PUNCT = /[。！？；，…]|[.!?;]\s*$/;

// Strip the wrapping a model puts around an otherwise fine label: code fences,
// quotes, markdown bold, a "标题：" prefix. Only the first non-empty line is
// considered — a label never spans lines, and keeping the rest would only turn
// a salvageable first line into an over-long reject.
function normalizeLabel(raw: string): string {
  const line = raw.split("\n").map((l) => l.trim()).find((l) => l.length > 0) ?? "";
  return line
    .replace(/^(标题|label|title)\s*[:：]\s*/i, "")
    .replace(/^[「『“”"'‘’`*\s]+/, "")
    .replace(/[」』“”"'‘’`*\s]+$/, "")
    .replace(/\s+/g, " ");
}

// Tolerant on purpose: response_format is a request, not a guarantee, and a
// plain-text answer that passes isLabelLike is perfectly usable. Only the
// envelope is optional here — the content check below is not.
export function extractLabel(content: string): string {
  const body = content.trim().replace(/^```[a-z]*\n?/i, "").replace(/```$/, "").trim();
  try {
    const raw: unknown = JSON.parse(body);
    // A quoted label parses as a bare JSON string, not an envelope.
    if (typeof raw === "string") return normalizeLabel(raw);
    if (raw && typeof raw === "object" && !Array.isArray(raw)) {
      const rec = raw as Record<string, unknown>;
      const v = rec.label ?? rec.title ?? rec["标题"];
      return typeof v === "string" ? normalizeLabel(v) : "";
    }
    return "";
  } catch {
    return normalizeLabel(body);
  }
}

// Does this read as a topic label rather than a chat reply?
export function isLabelLike(s: string): boolean {
  if (s.length < LABEL_MIN || s.length > LABEL_MAX) return false;
  if (SENTENCE_PUNCT.test(s)) return false;
  if (PROSE_OPENER.test(s)) return false;
  return /[\p{L}\p{N}]/u.test(s);
}

// Deterministic last resort. Callers pass the topic's most representative
// titles first (newest for a relabel, the item's own title at creation), so the
// head of the first one names the same event the label should have named — a
// plain headline is a worse label than the model's, but a usable one.
//
// Its output has to satisfy isLabelLike() itself, or the repair script would
// keep re-flagging every label this produced: hence the clause split (not just
// sentence stops) and a hard cut with no trailing "…", which reads as prose.
export function fallbackLabel(titles: string[]): string {
  const first = titles.find((t) => t?.trim())?.trim();
  if (!first) return "未命名话题";
  const head = first.split(/[。！？；，…\n]|\s+[-–—|｜]\s+/)[0]!.trim() || first;
  const trimmed = head.length <= LABEL_MAX
    ? head
    // Prefer a word boundary, but only if it keeps most of the phrase.
    : (() => {
        const cut = head.slice(0, LABEL_MAX);
        const space = cut.lastIndexOf(" ");
        return space > LABEL_MAX / 2 ? cut.slice(0, space) : cut;
      })();
  return trimmed.replace(/[\s.,:：、·\-–—]+$/, "") || first.slice(0, LABEL_MAX);
}

async function requestLabel(titles: string[], retry: boolean): Promise<string> {
  const res = await fetch("https://openrouter.ai/api/v1/chat/completions", {
    method: "POST",
    headers: { authorization: `Bearer ${config.OPENROUTER_API_KEY}`, "content-type": "application/json" },
    body: JSON.stringify({
      model: config.SCORING_MODEL,
      response_format: { type: "json_object" },
      messages: [
        { role: "system", content: LABEL_PROMPT },
        ...(retry ? [{ role: "system", content: LABEL_RETRY_NOTE }] : []),
        { role: "user", content: titles.join("\n") },
      ],
    }),
    signal: AbortSignal.timeout(LLM_TIMEOUT_MS),
  });
  if (!res.ok) throw new Error(`label ${res.status}`);
  const data = (await res.json()) as { choices: { message: { content: string } }[]; usage?: OpenRouterUsage };
  await recordModelUsage("label", config.SCORING_MODEL, data.usage);
  return data.choices[0]!.message.content;
}

// Never returns prose: a reply that does not look like a label is retried once
// and then replaced by a title-derived label. Both callers in cluster.ts (new
// topic, daily relabel) store the result verbatim, so this is the only place
// the check can live.
export async function labelTopic(titles: string[]): Promise<string> {
  const sample = titles.slice(0, 8);
  for (let attempt = 0; attempt < LABEL_ATTEMPTS; attempt++) {
    const content = await requestLabel(sample, attempt > 0);
    const label = extractLabel(content);
    if (isLabelLike(label)) return label;
    console.error(
      `labelTopic: reply ${attempt + 1}/${LABEL_ATTEMPTS} was not a label: ${content.trim().slice(0, 80)}`,
    );
  }
  return fallbackLabel(sample);
}
