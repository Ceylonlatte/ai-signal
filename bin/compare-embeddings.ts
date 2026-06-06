import "dotenv/config";
import { sql } from "drizzle-orm";
import { db, pool } from "../src/db/client.js";

// Offline embedding-model bake-off (throwaway, read-only).
//
// Pulls real items from the DB, embeds them with several candidate models, then
// for each query prints each model's top-k recall side by side so you can eyeball
// which model returns relevant results. Does NOT write to the DB or model_usage.
//
// Usage:
//   tsx bin/compare-embeddings.ts ["query one" "query two" ...]
// Env knobs:
//   DOCS=150        how many recent items to embed (token-cost control)
//   TOPK=6          rows printed per (query, model)
//   DOC_TEXT=en     document text source: en | zh | both
//                     en   -> title + text            (reproduces current behaviour)
//                     zh   -> title_zh + summary_zh   (matches a Chinese query better)
//                     both -> title + title_zh + summary_zh + text
//
// Cost: the :free nemotron model is $0; OpenAI 3-small/large are a few cents at
// DOCS=150. Each model that errors (404 / not available) is skipped, not fatal.

const ENDPOINT = process.env.EMBEDDINGS_ENDPOINT ?? "https://openrouter.ai/api/v1/embeddings";
const API_KEY = process.env.OPENROUTER_API_KEY ?? "";
const TIMEOUT_MS = 60_000;

interface ModelSpec {
  label: string;        // display name in the report
  model: string;        // OpenRouter model id
  queryPrefix?: string; // prepended to queries (bi-encoder retrieval prefix)
  docPrefix?: string;   // prepended to documents
  dimensions?: number;  // request a shortened embedding (OpenAI matryoshka)
  batch: number;        // inputs per request
}

// Edit this list to add Voyage / Cohere etc. Find exact ids at
// https://openrouter.ai/models?output_modalities=embeddings
const MODELS: ModelSpec[] = [
  // Control group: current model exactly as the app uses it today (no prefix).
  { label: "nemotron (current, no prefix)", model: "nvidia/llama-nemotron-embed-vl-1b-v2:free", batch: 100 },
  // Same model, but with the query:/passage: prefixes the model card requires.
  {
    label: "nemotron (+query/passage prefix)",
    model: "nvidia/llama-nemotron-embed-vl-1b-v2:free",
    queryPrefix: "query: ",
    docPrefix: "passage: ",
    batch: 100,
  },
  // Route B candidate: cheap, 1536-dim, indexable.
  { label: "openai 3-small (1536d)", model: "openai/text-embedding-3-small", batch: 100 },
  // Route A candidate: top-tier, truncated to 2048 to keep the current schema.
  { label: "openai 3-large @2048d", model: "openai/text-embedding-3-large", dimensions: 2048, batch: 100 },
  // Multilingual candidates: strong Chinese, MRL-truncatable to the schema's 2048
  // dims, and ~13x cheaper than openai 3-large. Qwen3 wants an instruct prefix on
  // queries only (docs stay raw), mirroring its model-card retrieval format.
  {
    label: "qwen3-embed-8b @2048d",
    model: "qwen/qwen3-embedding-8b",
    dimensions: 2048,
    queryPrefix: "Instruct: Given a search query, retrieve relevant passages.\nQuery: ",
    batch: 100,
  },
  {
    label: "qwen3-embed-4b @2048d",
    model: "qwen/qwen3-embedding-4b",
    dimensions: 2048,
    queryPrefix: "Instruct: Given a search query, retrieve relevant passages.\nQuery: ",
    batch: 100,
  },
];

const DEFAULT_QUERIES = [
  "上周关于 agent 的讨论",
  "开源大模型",
  "AI 编程助手",
  "GPU 芯片与硬件",
  "agentic coding",
];

interface Doc {
  id: number;
  title: string;
  text: string;
  titleZh: string;
  summaryZh: string;
}

function docText(d: Doc, mode: string): string {
  const en = `${d.title}\n${d.text ?? ""}`;
  const zh = `${d.titleZh ?? ""}\n${d.summaryZh ?? ""}`.trim();
  if (mode === "zh") return (zh || en).slice(0, 2000);
  if (mode === "both") return `${d.title}\n${d.titleZh}\n${d.summaryZh}\n${d.text ?? ""}`.slice(0, 2000);
  return en.slice(0, 2000);
}

function docLabel(d: Doc): string {
  return (d.titleZh && d.titleZh.trim()) || d.title;
}

async function embedBatch(spec: ModelSpec, texts: string[]): Promise<number[][]> {
  const body: Record<string, unknown> = { model: spec.model, input: texts };
  if (spec.dimensions) body.dimensions = spec.dimensions;
  const res = await fetch(ENDPOINT, {
    method: "POST",
    headers: { authorization: `Bearer ${API_KEY}`, "content-type": "application/json" },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  if (!res.ok) throw new Error(`${res.status}: ${(await res.text()).slice(0, 200)}`);
  const data = (await res.json()) as { data: { embedding: number[] }[] };
  return data.data.map((d) => d.embedding);
}

async function embedAll(spec: ModelSpec, texts: string[], prefix: string): Promise<number[][]> {
  const out: number[][] = [];
  for (let i = 0; i < texts.length; i += spec.batch) {
    const slice = texts.slice(i, i + spec.batch).map((t) => prefix + t);
    out.push(...(await embedBatch(spec, slice)));
  }
  return out;
}

function normalize(v: number[]): number[] {
  let s = 0;
  for (const x of v) s += x * x;
  const n = Math.sqrt(s) || 1;
  return v.map((x) => x / n);
}

function dot(a: number[], b: number[]): number {
  let s = 0;
  for (let i = 0; i < a.length; i++) s += (a[i] ?? 0) * (b[i] ?? 0);
  return s;
}

async function main() {
  if (!API_KEY) {
    console.error("compare-embeddings: OPENROUTER_API_KEY is empty — set it in .env first.");
    await pool.end();
    process.exit(1);
  }
  const DOCS = Number(process.env.DOCS ?? 150);
  const TOPK = Number(process.env.TOPK ?? 6);
  const DOC_TEXT = process.env.DOC_TEXT ?? "en";
  const queries = process.argv.slice(2).length ? process.argv.slice(2) : DEFAULT_QUERIES;

  const res = await db.execute(sql`
    SELECT i.id, i.title, i.text, coalesce(s.title_zh,'') AS "titleZh", coalesce(s.summary_zh,'') AS "summaryZh"
    FROM items i LEFT JOIN scores s ON s.item_id = i.id
    WHERE i.is_archived = false
    ORDER BY i.created_at DESC
    LIMIT ${DOCS}
  `);
  const docs = (res.rows ?? res) as unknown as Doc[];
  if (docs.length === 0) {
    console.error("compare-embeddings: no items in DB — collect/ingest some first.");
    await pool.end();
    process.exit(1);
  }

  console.log(
    `Docs: ${docs.length} (DOC_TEXT=${DOC_TEXT}) · Models: ${MODELS.length} · Queries: ${queries.length} · top-${TOPK}\n`,
  );
  const texts = docs.map((d) => docText(d, DOC_TEXT));

  // model label -> { docs: normalized doc vectors, dim }
  const indexed = new Map<string, { docVecs: number[][]; queryVecs: number[][]; dim: number }>();
  for (const spec of MODELS) {
    try {
      process.stdout.write(`embedding with ${spec.label} ...`);
      const docVecs = (await embedAll(spec, texts, spec.docPrefix ?? "")).map(normalize);
      const queryVecs = (await embedAll(spec, queries, spec.queryPrefix ?? "")).map(normalize);
      const dim = docVecs[0]?.length ?? 0;
      indexed.set(spec.label, { docVecs, queryVecs, dim });
      const dimWarn = spec.dimensions && dim !== spec.dimensions ? ` (!! asked ${spec.dimensions}, got ${dim})` : "";
      console.log(` ok, dim=${dim}${dimWarn}`);
    } catch (e) {
      console.log(` SKIPPED — ${(e as Error).message}`);
    }
  }

  for (let qi = 0; qi < queries.length; qi++) {
    console.log(`\n${"=".repeat(72)}\n查询: "${queries[qi]}"\n${"=".repeat(72)}`);
    for (const spec of MODELS) {
      const idx = indexed.get(spec.label);
      if (!idx) continue;
      const qv = idx.queryVecs[qi];
      if (!qv) continue;
      const scored = idx.docVecs
        .map((dv, i) => ({ i, sim: dot(qv, dv) }))
        .sort((a, b) => b.sim - a.sim)
        .slice(0, TOPK);
      console.log(`\n[${spec.label}]`);
      for (const { i, sim } of scored) {
        const d = docs[i];
        if (!d) continue;
        console.log(`  ${sim.toFixed(3)}  ${docLabel(d).slice(0, 70)}`);
      }
    }
  }

  await pool.end();
}

main();
