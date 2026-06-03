import { db } from "../db/client.js";
import { runPendingJobs } from "./stages.js";

const POLL_MS = 5000;

async function loop() {
  for (;;) {
    try {
      const n = await runPendingJobs(db, { max: 50 });
      if (n === 0) await new Promise((r) => setTimeout(r, POLL_MS));
    } catch (err) {
      console.error("worker loop error", err);
      await new Promise((r) => setTimeout(r, POLL_MS));
    }
  }
}

loop();
