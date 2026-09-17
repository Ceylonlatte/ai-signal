import "dotenv/config";
import { db } from "../db/client.js";
import { runTriageStage } from "./triage.js";
import { runEmbedStage } from "./stages.js";
import { runSummarizeStage } from "./summarize-stage.js";
import { runRssSummarizeStage } from "./rss-summarize-stage.js";
import { runClusterStage, runTopicMergeStage, reabsorbOrphanTopics } from "../lib/cluster.js";
import { runKbStage } from "./kb-stage.js";
import { runRssKbStage } from "./rss-kb-stage.js";
import { createStageRunner, type Stage } from "./stage-runner.js";

const POLL_MS = 5000;
const CLUSTER_THRESHOLD = 0.25;

// Listed in data-flow order (triage feeds the rest), but each one fails on its
// own — see stage-runner for why that matters.
const stages: Stage[] = [
  { name: "triage", run: () => runTriageStage(db) },
  { name: "embed", run: () => runEmbedStage(db) },
  { name: "summarize", run: () => runSummarizeStage(db) },
  { name: "rss-summarize", run: () => runRssSummarizeStage(db) },
  { name: "cluster", run: () => runClusterStage(db, { threshold: CLUSTER_THRESHOLD }) },
  { name: "topic-merge", run: () => runTopicMergeStage(db) },
  { name: "reabsorb-orphans", run: () => reabsorbOrphanTopics(db, { threshold: CLUSTER_THRESHOLD }) },
  { name: "kb", run: () => runKbStage(db) },
  { name: "rss-kb", run: () => runRssKbStage(db) },
];

async function loop() {
  const runner = createStageRunner(stages);
  for (;;) {
    let progress = 0;
    try {
      progress = await runner.runPass();
    } catch (err) {
      // runPass swallows per-stage failures, so reaching here means something
      // outside the stages broke (db client, logging). Sleep and retry.
      console.error("worker loop error", err);
    }
    if (progress === 0) await new Promise((r) => setTimeout(r, POLL_MS));
  }
}
loop();
