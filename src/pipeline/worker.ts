import "dotenv/config";
import { db } from "../db/client.js";
import { runTriageStage } from "./triage.js";
import { runEmbedStage } from "./stages.js";
import { runSummarizeStage } from "./summarize-stage.js";
import { runRssSummarizeStage } from "./rss-summarize-stage.js";
import { runClusterStage, runTopicMergeStage } from "../lib/cluster.js";
import { runKbStage } from "./kb-stage.js";

const POLL_MS = 5000;

async function loop() {
  for (;;) {
    try {
      const triaged = await runTriageStage(db);
      const embedded = await runEmbedStage(db);
      const summarized = await runSummarizeStage(db);
      const rssSummarized = await runRssSummarizeStage(db);
      const clustered = await runClusterStage(db, { threshold: 0.25 });
      const mergedTopics = await runTopicMergeStage(db);
      const kb = await runKbStage(db);
      if (triaged + embedded + summarized + rssSummarized + clustered + mergedTopics + kb === 0) {
        await new Promise((r) => setTimeout(r, POLL_MS));
      }
    } catch (err) {
      console.error("worker loop error", err);
      await new Promise((r) => setTimeout(r, POLL_MS));
    }
  }
}
loop();
