import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { readDigestSince } from "../src/collectors/mac-cursor.js";
import type { SourceKind } from "../src/types.js";

const VPS_URL = process.env.VPS_INGEST_URL!;
const TOKEN = process.env.INGEST_TOKEN!;
const STATE_FILE = process.env.STATE_FILE ?? "./.state.json";

const SOURCES: { source: SourceKind; root: string; subdir: string }[] = [
  { source: "reddit", root: "/Applications/Agent Coding/digest/reddit-digest", subdir: "reddit-ainews" },
  { source: "twitter", root: "/Applications/Agent Coding/digest/twitter-digest", subdir: "following" },
  { source: "twitter", root: "/Applications/Agent Coding/digest/twitter-digest", subdir: "for-you" },
];

function loadState(): Record<string, number> {
  return existsSync(STATE_FILE) ? JSON.parse(readFileSync(STATE_FILE, "utf8")) : {};
}

async function main() {
  const state = loadState();
  for (const s of SOURCES) {
    const key = `${s.source}:${s.subdir}`;
    const { payloads, cursor } = readDigestSince({ ...s, sinceTs: state[key] ?? 0 });
    if (payloads.length === 0) { console.log(`${key}: nothing new`); continue; }
    const res = await fetch(VPS_URL, {
      method: "POST",
      headers: { authorization: `Bearer ${TOKEN}`, "content-type": "application/json" },
      body: JSON.stringify({ source: s.source, items: payloads }),
    });
    if (!res.ok) { console.error(`${key}: POST failed ${res.status}`); continue; }
    state[key] = cursor;
    console.log(`${key}: posted ${payloads.length}, cursor -> ${cursor}`);
  }
  writeFileSync(STATE_FILE, JSON.stringify(state, null, 2));
}

main();
