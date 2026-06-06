import { eq, isNull, sql as dsql } from "drizzle-orm";
import { items, rawItems, scores, itemEmbeddings } from "../db/schema.js";
import { normalizeRawItem } from "../lib/normalize.js";
import { selectCandidates } from "../lib/scoring/prefilter.js";
import { scoreBatch } from "../lib/scoring/llm.js";
import { computeQuality, passesGate, inRescueBand } from "../lib/scoring/quality.js";
import { sourceTrust } from "../lib/sources/trust.js";
import { normalizeHeat } from "../lib/scoring/composite.js";
import { RUBRIC_VERSION } from "../lib/scoring/rubric.js";
import { likeRescues } from "../lib/feedback/profile.js";
import { embedTexts } from "../lib/embeddings.js";
import { computeNoveltyForVector } from "../lib/novelty.js";
import { hybridRelevance } from "../lib/scoring/relevance.js";
import { loadKeywords } from "../lib/scoring/keyword-store.js";
import { config } from "../config.js";
import type { NormalizedItem, RawPayload } from "../types.js";

type Db = any;
const BATCH = 500;
const EMBED_CHUNK = 100;
const EMBED_TEXT_MAX = 2000;

function embedText(n: NormalizedItem): string {
  return `${n.title}\n${n.text ?? ""}`.slice(0, EMBED_TEXT_MAX);
}

// Embed all candidate texts up front (chunked, best-effort). A failing chunk
// just leaves those items without a vector → exact-only relevance + the embed
// stage embeds them later. Uses the free EMBEDDING_MODEL.
async function embedCandidates(texts: string[]): Promise<Map<number, number[]>> {
  const out = new Map<number, number[]>();
  for (let i = 0; i < texts.length; i += EMBED_CHUNK) {
    const slice = texts.slice(i, i + EMBED_CHUNK);
    try {
      const vecs = await embedTexts(slice);
      vecs.forEach((v, j) => { if (v) out.set(i + j, v); });
    } catch { /* exact-only fallback for this chunk */ }
  }
  return out;
}

// Highest cosine similarity between `vec` and any recently up-voted item's
// embedding (null when there are no liked embeddings in the window).
async function maxLikeSimForVector(db: Db, vec: number[]): Promise<number | null> {
  const res = await db.execute(dsql`
    SELECT 1 - MIN(le.embedding <=> ${JSON.stringify(vec)}::vector) AS sim
    FROM item_embeddings le JOIN feedback f ON f.item_id = le.item_id
    WHERE f.signal = 'up' AND f.created_at > now() - (${config.PROFILE_WINDOW_DAYS} || ' days')::interval
  `);
  const row = (res.rows ?? res)[0] as { sim: number | null } | undefined;
  return row?.sim ?? null;
}

export async function runTriageStage(db: Db): Promise<number> {
  const pending = await db.select().from(rawItems)
    .where(isNull(rawItems.processedAt))
    .limit(BATCH);
  if (pending.length === 0) return 0;

  const normalized = pending.map((r: any) => ({
    rawId: Number(r.id),
    n: normalizeRawItem(r.payload as RawPayload),
  }));

  // Embed every candidate once: the vector powers semantic relevance now and is
  // reused as the item embedding on insert, so the embed stage skips it.
  const vecByIdx = await embedCandidates(normalized.map((x: any) => embedText(x.n)));
  const vecByRaw = new Map<number, number[]>();
  normalized.forEach((x: any, i: number) => { const v = vecByIdx.get(i); if (v) vecByRaw.set(x.rawId, v); });

  const keywords = await loadKeywords(db);
  const relByRaw = new Map<number, number>();
  for (const { rawId, n } of normalized) {
    relByRaw.set(rawId, hybridRelevance(
      { title: n.title, text: n.text, embedding: vecByRaw.get(rawId) ?? null }, keywords,
    ));
  }

  const candidates = selectCandidates(normalized.map((x: any) => ({
    id: x.rawId, title: x.n.title, text: x.n.text, source: x.n.source,
    metrics: x.n.metrics, relevance: relByRaw.get(x.rawId) ?? 0, feed: x.n.feed,
  })));
  const llm = await scoreBatch(candidates);

  let processed = 0;
  for (const { rawId, n } of normalized) {
    const r = llm.get(rawId);
    const llmValue = (r?.value ?? 0) / 100;
    const relevance = relByRaw.get(rawId) ?? 0;
    const qualityRelevance = n.source === "hn" ? 0 : relevance;
    const trust = sourceTrust(n.source, n.url, n.feed);
    const q = computeQuality({ llmValue, relevance: qualityRelevance, trust });
    const vec = vecByRaw.get(rawId) ?? null;

    // Decide keep/rescue BEFORE opening the transaction: the like-similarity
    // read and novelty query must not hold the transaction open across IO.
    // Twitter "following" is a trusted curated timeline → lower gate.
    const gate = n.source === "twitter" && n.feed === "following"
      ? config.Q_THRESHOLD_TWITTER_FOLLOWING
      : config.Q_THRESHOLD;
    let keep = passesGate(q, gate);
    if (!keep && inRescueBand(q) && vec) {
      const sim = await maxLikeSimForVector(db, vec);
      if (likeRescues(sim)) keep = true;
    }
    const novelty = keep && vec ? await computeNoveltyForVector(db, vec, { days: 7 }) : 0;

    await db.transaction(async (tx: any) => {
      if (keep) {
        const [inserted] = await tx.insert(items).values({
          rawItemId: rawId, source: n.source, url: n.url, canonicalUrl: n.canonicalUrl,
          author: n.author, title: n.title, text: n.text, createdAt: n.createdAt,
          metrics: n.metrics, contentHash: n.contentHash,
        }).onConflictDoNothing({ target: items.contentHash }).returning({ id: items.id });

        if (inserted) {
          await tx.insert(scores).values({
            itemId: inserted.id,
            heat: normalizeHeat(n.metrics),
            relevance, novelty, llmValue, composite: q,
            summary: "", reason: r?.reason ?? "", topicTags: r?.topics ?? [],
            rubricVersion: RUBRIC_VERSION,
          }).onConflictDoNothing({ target: scores.itemId });
          if (vec) {
            await tx.insert(itemEmbeddings)
              .values({ itemId: inserted.id, embedding: vec })
              .onConflictDoNothing({ target: itemEmbeddings.itemId });
          }
        }
      }
      await tx.update(rawItems).set({ processedAt: new Date() }).where(eq(rawItems.id, rawId));
    });
    processed++;
  }
  return processed;
}
