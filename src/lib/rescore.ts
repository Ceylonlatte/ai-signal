import { sql } from "drizzle-orm";

type Db = any;

// Clearing stale-rubric score rows makes runScoreStage pick the items up again
// (it selects items lacking a score row for the current rubric_version).
export async function enqueueRescore(db: Db, opts: { currentRubric: string }): Promise<number> {
  const res = await db.execute(sql`DELETE FROM scores WHERE rubric_version <> ${opts.currentRubric}`);
  return res.rowCount ?? 0;
}
