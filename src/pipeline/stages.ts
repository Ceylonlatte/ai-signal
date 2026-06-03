import { and, asc, eq } from "drizzle-orm";
import { items, jobs, rawItems } from "../db/schema.js";
import { normalizeRawItem } from "../lib/normalize.js";
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
