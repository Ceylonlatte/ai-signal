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
  it("falls back to ~now (not 1970) when created_utc is missing", () => {
    const [p] = mapDigestItems("reddit", "hot", [{ id: "z", title: "T", selftext: "" }]);
    expect(new Date(p!.createdAt).getUTCFullYear()).toBeGreaterThanOrEqual(2026);
  });
});

describe("mapDigestItems reddit_discussion.v1", () => {
  const doc = {
    schema_version: "reddit_discussion.v1",
    source: { feed: "hot" },
    post: {
      id: "abc123", title: "Example", subreddit: "r/OpenAI", author: "op_user",
      score: 420, num_comments: 87, created_utc: 1781930000,
      url: "https://www.reddit.com/r/OpenAI/comments/abc123/example/",
      external_url: "https://example.com/article", selftext: "Post body",
    },
    discussion: {
      fetch: { status: "success" },
      comments: [{ id: "c1", body: "Top comment", score: 210, depth: 0, replies: [] }],
    },
  };

  it("maps the post and keeps the whole document (incl. comment tree) under raw", () => {
    const [p] = mapDigestItems("reddit", undefined, [doc]);
    expect(p).toMatchObject({
      source: "reddit", externalId: "abc123", title: "Example", text: "Post body",
      url: "https://www.reddit.com/r/OpenAI/comments/abc123/example/", author: "op_user",
      metrics: { score: 420, comments: 87 }, feed: "hot",
    });
    expect(p!.createdAt).toBe(new Date(1781930000 * 1000).toISOString());
    expect((p!.raw as typeof doc).discussion.comments[0]!.body).toBe("Top comment");
  });

  it("maps a link post with empty selftext (comments still carried in raw)", () => {
    const linkDoc = { ...doc, post: { ...doc.post, selftext: "", external_url: "https://x.com/a" } };
    const [p] = mapDigestItems("reddit", undefined, [linkDoc]);
    expect(p!.text).toBe("");
    expect(p!.externalId).toBe("abc123");
  });

  it("skips a v1 doc missing post id or title", () => {
    const bad = { schema_version: "reddit_discussion.v1", post: { title: "no id" }, discussion: {} };
    expect(mapDigestItems("reddit", undefined, [bad])).toHaveLength(0);
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
