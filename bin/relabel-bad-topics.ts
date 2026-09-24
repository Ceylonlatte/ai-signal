import "dotenv/config";
import { sql } from "drizzle-orm";
import { db, pool } from "../src/db/client.js";
import { isLabelLike, labelTopic } from "../src/lib/scoring/llm.js";

// One-off repair for labels written before labelTopic validated its reply.
// Back then a prose answer ("是的，我很熟悉这个方向。…") was stored as its first
// 60 characters, so rows at that ceiling — and anything else that does not read
// as a label — are stuck with a chat reply on the daily board. Topics on the
// board fix themselves through relabelTodayTopics; everything else needs this.
//
//   npm run relabel-topics              # dry run: list what would change
//   npm run relabel-topics -- --apply   # relabel (one LLM call per topic)
//   npm run relabel-topics -- --apply --limit 50
//
// Dry run is the default because --apply spends OPENROUTER credit and rewrites
// rows; the listing alone answers "how many are there".

const args = process.argv.slice(2);
const apply = args.includes("--apply");
const limitArg = args.indexOf("--limit");
const limit = limitArg >= 0 ? Number(args[limitArg + 1]) : Infinity;

async function main() {
  const res = await db.execute(sql`SELECT id, label FROM topics ORDER BY last_seen DESC`);
  const all = (res.rows ?? res) as Array<{ id: number; label: string }>;
  const bad = all.filter((t) => !isLabelLike(t.label ?? ""));
  console.log(`topics: ${all.length} total, ${bad.length} with a label that is not label-shaped`);
  const atCeiling = bad.filter((t) => (t.label ?? "").length >= 60).length;
  if (atCeiling > 0) console.log(`  of those, ${atCeiling} sit at the old 60-char truncation ceiling`);

  const todo = bad.slice(0, Number.isFinite(limit) ? limit : bad.length);
  let fixed = 0;
  for (const topic of todo) {
    // Same ordering as the daily relabel: newest first, best-scored as the
    // tie-break, so the repair names the topic's most recent event.
    const rows = await db.execute(sql`
      SELECT coalesce(nullif(s.title_zh, ''), i.title) AS title
      FROM item_topics it
      JOIN items i ON i.id = it.item_id
      LEFT JOIN scores s ON s.item_id = i.id
      WHERE it.topic_id = ${Number(topic.id)}
      ORDER BY it.linked_at DESC, s.composite DESC NULLS LAST
      LIMIT 8
    `);
    const titles = ((rows.rows ?? rows) as Array<{ title: string }>).map((r) => r.title);
    if (titles.length === 0) {
      console.log(`  topic ${topic.id}: no members left, skipped`);
      continue;
    }
    if (!apply) {
      console.log(`  topic ${topic.id}: ${JSON.stringify((topic.label ?? "").slice(0, 60))} <- ${JSON.stringify(titles[0])}`);
      continue;
    }
    try {
      const label = await labelTopic(titles);
      await db.execute(sql`UPDATE topics SET label = ${label} WHERE id = ${Number(topic.id)}`);
      console.log(`  topic ${topic.id}: ${JSON.stringify((topic.label ?? "").slice(0, 40))} -> ${JSON.stringify(label)}`);
      fixed++;
    } catch (err) {
      console.error(`  topic ${topic.id} failed`, err);
    }
  }
  console.log(apply ? `relabeled ${fixed}/${todo.length}` : `dry run: ${todo.length} would be relabeled (pass --apply)`);
  await pool.end();
}
main();
