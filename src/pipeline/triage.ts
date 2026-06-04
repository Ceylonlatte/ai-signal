import { eq, isNull, sql as dsql } from "drizzle-orm";
import { items, rawItems, scores, itemEmbeddings } from "../db/schema.js";
import { normalizeRawItem } from "../lib/normalize.js";
import { computeRelevance } from "../lib/keywords.js";
import { selectCandidates } from "../lib/scoring/prefilter.js";
import { scoreBatch } from "../lib/scoring/llm.js";
import { computeQuality, passesGate, inRescueBand } from "../lib/scoring/quality.js";
import { sourceTrust } from "../lib/sources/trust.js";
import { normalizeHeat } from "../lib/scoring/composite.js";
import { RUBRIC_VERSION } from "../lib/scoring/rubric.js";
import { likeRescues } from "../lib/feedback/profile.js";
import { embedTexts } from "../lib/embeddings.js";
import { computeNoveltyForVector } from "../lib/novelty.js";
import { config } from "../config.js";
import type { RawPayload } from "../types.js";

type Db = any;
const BATCH = 500;

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

  const candInputs = normalized.map((x: any) => ({
    id: x.rawId, title: x.n.title, text: x.n.text, source: x.n.source, metrics: x.n.metrics,
  }));
  const candidates = selectCandidates(candInputs);
  const llm = await scoreBatch(candidates);

  let processed = 0;
  for (const { rawId, n } of normalized) {
    const r = llm.get(rawId);
    const llmValue = (r?.value ?? 0) / 100;
    const relevance = computeRelevance(n.title, n.text);
    const trust = sourceTrust(n.source, n.url, n.feed);
    const q = computeQuality({ llmValue, relevance, trust });

    // Decide keep/rescue BEFORE opening the transaction: embedTexts (network) and
    // the like-similarity read must not hold the transaction open across IO.
    let keep = passesGate(q);
    let rescueVec: number[] | null = null;
    let rescueNovelty = 0;
    if (!keep && inRescueBand(q)) {
      const [vec] = await embedTexts([`${n.title}\n${n.text}`.slice(0, 2000)]);
      if (vec) {
        const sim = await maxLikeSimForVector(db, vec);
        if (likeRescues(sim)) {
          keep = true;
          rescueVec = vec;
          rescueNovelty = await computeNoveltyForVector(db, vec, { days: 7 });
        }
      }
    }

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
            relevance, novelty: rescueVec ? rescueNovelty : 0, llmValue, composite: q,
            summary: "", reason: r?.reason ?? "", topicTags: r?.topics ?? [],
            rubricVersion: RUBRIC_VERSION,
          }).onConflictDoNothing({ target: scores.itemId });
          if (rescueVec) {
            await tx.insert(itemEmbeddings)
              .values({ itemId: inserted.id, embedding: rescueVec })
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
