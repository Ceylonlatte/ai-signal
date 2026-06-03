import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdtempSync, writeFileSync, mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { readDigestSince } from "../../src/collectors/mac-cursor.js";

let root: string;
beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "digest-"));
  for (const [job, items] of [
    ["jobA-100", [{ id: "r1", title: "Post 1", subreddit: "ai", author: "u", score: 5, comments: 1, url: "https://r/1", created_utc: 1748599200, selftext: "" }]],
    ["jobB-200", [{ id: "r2", title: "Post 2", subreddit: "ai", author: "u", score: 9, comments: 2, url: "https://r/2", created_utc: 1748602800, selftext: "x" }]],
  ] as const) {
    const dir = join(root, job, "raw", "reddit-ainews");
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, "items.json"), JSON.stringify(items));
  }
});
afterEach(() => rmSync(root, { recursive: true, force: true }));

describe("readDigestSince", () => {
  it("reads only job dirs with ts greater than the cursor and maps reddit items", () => {
    const { payloads, cursor } = readDigestSince({ root, source: "reddit", subdir: "reddit-ainews", sinceTs: 150 });
    expect(payloads.map((p) => p.externalId)).toEqual(["r2"]);
    expect(payloads[0]).toMatchObject({ source: "reddit", title: "Post 2" });
    expect(cursor).toBe(200);
  });
  it("returns everything when cursor is 0", () => {
    const { payloads } = readDigestSince({ root, source: "reddit", subdir: "reddit-ainews", sinceTs: 0 });
    expect(payloads).toHaveLength(2);
  });
});
