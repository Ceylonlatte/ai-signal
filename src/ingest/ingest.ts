import { jobs, rawItems } from "../db/schema.js";
import type { RawPayload } from "../types.js";

interface IngestArgs {
  db: any; // drizzle instance (typed via schema in callers)
  sourceId: number;
  payloads: RawPayload[];
}

export async function ingest({ db, sourceId, payloads }: IngestArgs): Promise<number> {
  if (payloads.length === 0) return 0;
  const inserted = await db
    .insert(rawItems)
    .values(payloads.map((p) => ({ sourceId, externalId: p.externalId, payload: p })))
    .onConflictDoNothing({ target: [rawItems.sourceId, rawItems.externalId] })
    .returning({ id: rawItems.id });

  if (inserted.length > 0) {
    await db
      .insert(jobs)
      .values(inserted.map((r: { id: number }) => ({
        stage: "normalize", ref: String(r.id),
      })))
      .onConflictDoNothing({ target: [jobs.stage, jobs.ref] });
  }
  return inserted.length;
}
