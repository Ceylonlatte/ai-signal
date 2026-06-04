import { describe, expect, it } from "vitest";
import { mapDigestItems, tweetTitle } from "../../src/lib/sources/digest-map.js";

describe("mapDigestItems reddit", () => {
  it("maps a reddit post (score/comments) + feed + epoch createdAt", () => {
    const [p] = mapDigestItems("reddit", "hot", [{
      id: "abc", title: "Hello", author: "u", score: 12, comments: 3,
      url: "https://reddit.com/x", created_utc: 1780000000, selftext: "body",
    }]);
    expect(p).toMatchObject({
      source: "reddit", externalId: "abc", title: "Hello", text: "body",
      url: "https://reddit.com/x", author: "u",
      metrics: { score: 12, comments: 3 }, feed: "hot",
    });
    expect(p!.createdAt).toBe(new Date(1780000000 * 1000).toISOString());
  });
  it("skips items missing id or title", () => {
    expect(mapDigestItems("reddit", "new", [{ title: "no id" }, { id: "x" }])).toHaveLength(0);
  });
});

describe("mapDigestItems twitter", () => {
  it("maps a tweet (replies in metrics) + feed + parses twitter date", () => {
    const [p] = mapDigestItems("twitter", "following", [{
      id: "1", author: "alice", text: "hi there",
      likes: 4, retweets: 2, replies: 1,
      created_at: "Thu Jun 04 12:54:33 +0000 2026",
      url: "https://x.com/alice/status/1",
    }]);
    expect(p).toMatchObject({
      source: "twitter", externalId: "1", author: "alice",
      text: "hi there", title: "hi there",
      metrics: { likes: 4, retweets: 2, replies: 1 }, feed: "following",
    });
    expect(p!.createdAt).toBe("2026-06-04T12:54:33.000Z");
  });
  it("skips tweets missing id or text", () => {
    expect(mapDigestItems("twitter", "for-you", [{ text: "no id" }, { id: "x" }])).toHaveLength(0);
  });
});

describe("tweetTitle", () => {
  it("returns short text unchanged", () => {
    expect(tweetTitle("short tweet")).toBe("short tweet");
  });
  it("collapses newlines / repeated whitespace", () => {
    expect(tweetTitle("line1\n\nline2   tabs\there")).toBe("line1 line2 tabs here");
  });
  it("truncates long text on a word boundary with an ellipsis", () => {
    const t = tweetTitle("word ".repeat(40).trim()); // 199 chars
    expect(t.endsWith("word…")).toBe(true);
    expect(Array.from(t).length).toBeLessThanOrEqual(121);
  });
  it("never splits an emoji at the boundary", () => {
    const t = tweetTitle("😀".repeat(200)).replace("…", "");
    expect(Array.from(t).every((c) => c === "😀")).toBe(true);
  });
});
