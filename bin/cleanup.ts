import "dotenv/config";
import { db, pool } from "../src/db/client.js";
import { cleanupOldItems } from "../src/lib/cleanup.js";

async function main() {
  const deleted = await cleanupOldItems(db, { days: 30 });
  console.log(`cleanup: deleted ${deleted} items (favorites preserved)`);
  await pool.end();
}
main();
