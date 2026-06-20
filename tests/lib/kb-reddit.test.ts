import { describe, expect, it } from "vitest";
import { buildRedditKbBody, flattenComments, renderCommentsMarkdown } from "../../src/lib/kb/reddit.js";

const tree = [
  {
    author: "alice", body: "top one", score: 200, is_submitter: false,
    replies: [{ author: "op", body: "op reply", score: 5, is_submitter: true, replies: [] }],
  },
  { author: "bob", body: "top two", score: 50, replies: [] },
  { author: "[deleted]", body: "[removed]", score: 1, replies: [] },
];

describe("flattenComments", () => {
  it("flattens depth-first and records depth", () => {
    const flat = flattenComments(tree);
    expect(flat.map((c) => [c.author, c.depth])).toEqual([
      ["alice", 0], ["op", 1], ["bob", 0], ["[deleted]", 0],
    ]);
  });
});

describe("renderCommentsMarkdown", () => {
  it("renders the full tree with depth indentation and drops removed/deleted", () => {
    const md = renderCommentsMarkdown(tree);
    expect(md).toContain("- **alice** · ▲200");
    expect(md).toContain("  - **op** · OP · ▲5"); // nested reply indented
    expect(md).toContain("- **bob** · ▲50");
    expect(md).not.toContain("[removed]"); // filtered
  });
});

describe("buildRedditKbBody", () => {
  it("builds body + full comments + bounded note input from a v1 doc", () => {
    const doc = { discussion: { fetch: { status: "success" }, comments: tree } };
    const out = buildRedditKbBody(doc, "the post body");
    expect(out.bodyMd).toBe("the post body");
    expect(out.commentsMd).toContain("**alice**");
    expect(out.commentsMd).toContain("**bob**");
    expect(out.noteInput).toContain("the post body");
    expect(out.noteInput).toContain("## 讨论");
    expect(out.noteInput).toContain("alice");
    expect(out.noteInput).toContain("/OP"); // OP reply always folded in
  });

  it("degrades when comments were not fetched (status != success)", () => {
    const doc = { discussion: { fetch: { status: "skipped" }, comments: [] } };
    const out = buildRedditKbBody(doc, "body only");
    expect(out.commentsMd).toBe("");
    expect(out.noteInput).toBe("body only");
  });

  it("handles a legacy flat payload with no discussion", () => {
    const out = buildRedditKbBody({}, "legacy body");
    expect(out.commentsMd).toBe("");
    expect(out.noteInput).toBe("legacy body");
  });
});
