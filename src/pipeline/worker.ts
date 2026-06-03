import { db } from "../db/client.js";
import { runPendingJobs, runScoreStage, runEmbedStage } from "./stages.js";
import { runClusterStage } from "../lib/cluster.js";

const POLL_MS = 5000;

async function loop() {
  for (;;) {
    try {
      const n = await runPendingJobs(db, { max: 50 });
      const embedded = await runEmbedStage(db);
      const clustered = await runClusterStage(db, { threshold: 0.25 });
      const scored = await runScoreStage(db);
      if (n + embedded + clustered + scored === 0) await new Promise((r) => setTimeout(r, POLL_MS));
    } catch (err) {
      console.error("worker loop error", err);
      await new Promise((r) => setTimeout(r, POLL_MS));
    }
  }
}

loop();
