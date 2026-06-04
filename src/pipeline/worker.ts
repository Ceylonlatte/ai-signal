import "dotenv/config";
import { db } from "../db/client.js";
import { runTriageStage } from "./triage.js";
import { runEmbedStage } from "./stages.js";
import { runSummarizeStage } from "./summarize-stage.js";
import { runClusterStage } from "../lib/cluster.js";

const POLL_MS = 5000;

async function loop() {
  for (;;) {
    try {
      const triaged = await runTriageStage(db);
      const embedded = await runEmbedStage(db);
      const summarized = await runSummarizeStage(db);
      const clustered = await runClusterStage(db, { threshold: 0.25 });
      if (triaged + embedded + summarized + clustered === 0) {
        await new Promise((r) => setTimeout(r, POLL_MS));
      }
    } catch (err) {
      console.error("worker loop error", err);
      await new Promise((r) => setTimeout(r, POLL_MS));
    }
  }
}
loop();
