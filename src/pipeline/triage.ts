import { eq, isNull } from "drizzle-orm";
import { items, rawItems, scores } from "../db/schema.js";
import { normalizeRawItem } from "../lib/normalize.js";
import { computeRelevance } from "../lib/keywords.js";
import { selectCandidates } from "../lib/scoring/prefilter.js";
import { scoreBatch } from "../lib/scoring/llm.js";
import { computeQuality, passesGate } from "../lib/scoring/quality.js";
import { sourceTrust } from "../lib/sources/trust.js";
import { normalizeHeat } from "../lib/scoring/composite.js";
import { RUBRIC_VERSION } from "../lib/scoring/rubric.js";
import type { RawPayload } from "../types.js";

type Db = any;
const BATCH = 500;

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
    const trust = sourceTrust(n.source, n.url);
    const q = computeQuality({ llmValue, relevance, trust });

    await db.transaction(async (tx: any) => {
      if (passesGate(q)) {
        const [inserted] = await tx.insert(items).values({
          rawItemId: rawId, source: n.source, url: n.url, canonicalUrl: n.canonicalUrl,
          author: n.author, title: n.title, text: n.text, createdAt: n.createdAt,
          metrics: n.metrics, contentHash: n.contentHash,
        }).onConflictDoNothing({ target: items.contentHash }).returning({ id: items.id });

        if (inserted) {
          await tx.insert(scores).values({
            itemId: inserted.id,
            heat: normalizeHeat(n.metrics),
            relevance, novelty: 0, llmValue, composite: q,
            summary: "", reason: r?.reason ?? "", topicTags: r?.topics ?? [],
            rubricVersion: RUBRIC_VERSION,
          }).onConflictDoNothing({ target: scores.itemId });
        }
      }
      await tx.update(rawItems).set({ processedAt: new Date() }).where(eq(rawItems.id, rawId));
    });
    processed++;
  }
  return processed;
}
