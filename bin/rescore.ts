import { db, pool } from "../src/db/client.js";
import { enqueueRescore } from "../src/lib/rescore.js";
import { RUBRIC_VERSION } from "../src/lib/scoring/rubric.js";

async function main() {
  const cleared = await enqueueRescore(db, { currentRubric: RUBRIC_VERSION });
  console.log(`rescore: cleared ${cleared} stale scores; worker will re-score to ${RUBRIC_VERSION}`);
  await pool.end();
}
main();
