import { sources } from "../db/schema.js";

type Db = any;

const STALE_HOURS: Record<string, number> = { twitter: 6, reddit: 12, hn: 3, rss: 2 };

export async function getSourceStatus(db: Db) {
  const rows = await db.select().from(sources);
  const now = Date.now();
  return rows.map((s: { kind: string; lastRunAt: Date | null }) => {
    const threshold = (STALE_HOURS[s.kind] ?? 24) * 3600e3;
    const ageMs = s.lastRunAt ? now - new Date(s.lastRunAt).getTime() : Infinity;
    return { kind: s.kind, lastRunAt: s.lastRunAt, stale: ageMs > threshold };
  });
}
