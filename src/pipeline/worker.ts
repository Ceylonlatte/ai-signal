import { db } from "../db/client.js";
import { runPendingJobs, runScoreStage } from "./stages.js";

const POLL_MS = 5000;

async function loop() {
  for (;;) {
    try {
      const n = await runPendingJobs(db, { max: 50 });
      const scored = await runScoreStage(db);
      if (n === 0 && scored === 0) await new Promise((r) => setTimeout(r, POLL_MS));
    } catch (err) {
      console.error("worker loop error", err);
      await new Promise((r) => setTimeout(r, POLL_MS));
    }
  }
}

loop();
