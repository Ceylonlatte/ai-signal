import { asc, eq, sql as dsql } from "drizzle-orm";
import { items, itemEmbeddings, jobs, rawItems, scores } from "../db/schema.js";
import { embedTexts } from "../lib/embeddings.js";
import { normalizeRawItem } from "../lib/normalize.js";
import { computeRelevance } from "../lib/keywords.js";
import { normalizeHeat, computeComposite } from "../lib/scoring/composite.js";
import { selectCandidates } from "../lib/scoring/prefilter.js";
import { scoreBatch } from "../lib/scoring/llm.js";
import { computeNovelty } from "../lib/novelty.js";
import { RUBRIC_VERSION } from "../lib/scoring/rubric.js";
import { weights } from "../config.js";
import type { RawPayload } from "../types.js";

type Db = any;

async function handleNormalize(db: Db, rawItemId: number): Promise<void> {
  const [raw] = await db.select().from(rawItems).where(eq(rawItems.id, rawItemId));
  if (!raw) return;
  const n = normalizeRawItem(raw.payload as RawPayload);
  await db.insert(items).values({
    rawItemId,
    source: n.source,
    url: n.url,
    canonicalUrl: n.canonicalUrl,
    author: n.author,
    title: n.title,
    text: n.text,
    createdAt: n.createdAt,
    metrics: n.metrics,
    contentHash: n.contentHash,
  }).onConflictDoNothing({ target: items.contentHash });
}

const HANDLERS: Record<string, (db: Db, ref: number) => Promise<void>> = {
  normalize: (db, ref) => handleNormalize(db, ref),
};

export async function runPendingJobs(db: Db, opts: { max: number }): Promise<number> {
  const pending = await db.select().from(jobs)
    .where(eq(jobs.status, "pending"))
    .orderBy(asc(jobs.id))
    .limit(opts.max);

  let processed = 0;
  for (const job of pending) {
    const handler = HANDLERS[job.stage];
    if (!handler) continue;
    try {
      await handler(db, Number(job.ref));
      await db.update(jobs).set({ status: "done" }).where(eq(jobs.id, job.id));
      processed++;
    } catch (err) {
      await db.update(jobs)
        .set({ status: "error", attempts: job.attempts + 1, error: String(err) })
        .where(eq(jobs.id, job.id));
    }
  }
  return processed;
}

export async function runScoreStage(db: Db): Promise<number> {
  const unscored = await db.execute(dsql`
    SELECT i.id, i.title, i.text, i.source, i.metrics
    FROM items i
    LEFT JOIN scores s ON s.item_id = i.id AND s.rubric_version = ${RUBRIC_VERSION}
    WHERE s.item_id IS NULL
    LIMIT 500
  `);
  const rows = (unscored.rows ?? unscored) as Array<{
    id: number; title: string; text: string; source: string; metrics: Record<string, number>;
  }>;
  if (rows.length === 0) return 0;

  const candidates = selectCandidates(rows.map((r) => ({
    id: Number(r.id), title: r.title, text: r.text ?? "", source: r.source, metrics: r.metrics ?? {},
  })));
  const llm = await scoreBatch(candidates);

  let written = 0;
  for (const c of candidates) {
    const r = llm.get(c.id);
    const heat = normalizeHeat(c.metrics);
    const relevance = computeRelevance(c.title, c.text);
    const llmValue = (r?.value ?? 0) / 100;
    const novelty = await computeNovelty(db, c.id, { days: 7 });
    const composite = computeComposite({ heat, relevance, novelty, llmValue }, weights);
    await db.insert(scores).values({
      itemId: c.id, heat, relevance, novelty, llmValue, composite,
      summary: r?.summary ?? "", reason: r?.reason ?? "", topicTags: r?.topics ?? [],
      rubricVersion: RUBRIC_VERSION,
    }).onConflictDoUpdate({
      target: scores.itemId,
      set: { heat, relevance, novelty, llmValue, composite,
        summary: r?.summary ?? "", reason: r?.reason ?? "", topicTags: r?.topics ?? [],
        rubricVersion: RUBRIC_VERSION, scoredAt: new Date() },
    });
    written++;
  }
  return written;
}

export async function runEmbedStage(db: Db): Promise<number> {
  const rows = await db.execute(dsql`
    SELECT i.id, i.title, i.text FROM items i
    LEFT JOIN item_embeddings e ON e.item_id = i.id
    WHERE e.item_id IS NULL
    LIMIT 100
  `);
  const items_ = (rows.rows ?? rows) as Array<{ id: number; title: string; text: string }>;
  if (items_.length === 0) return 0;

  const vectors = await embedTexts(items_.map((r) => `${r.title}\n${r.text ?? ""}`.slice(0, 2000)));
  for (let i = 0; i < items_.length; i++) {
    await db.insert(itemEmbeddings)
      .values({ itemId: Number(items_[i]!.id), embedding: vectors[i]! })
      .onConflictDoNothing({ target: itemEmbeddings.itemId });
  }
  return items_.length;
}
