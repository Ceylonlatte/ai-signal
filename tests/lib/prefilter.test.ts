import { describe, expect, it } from "vitest";
import { selectCandidates } from "../../src/lib/scoring/prefilter.js";

const mk = (over: Partial<any>) => ({
  id: 1, title: "x", text: "", source: "hn", metrics: { points: 1, comments: 0 }, relevance: 0, ...over,
});

describe("selectCandidates", () => {
  it("keeps relevant items even with low heat", () => {
    const out = selectCandidates([mk({ id: 1, relevance: 0.33, metrics: { points: 1 } })]);
    expect(out.map((i) => i.id)).toContain(1);
  });
  it("keeps high-heat items even without relevance", () => {
    const out = selectCandidates([mk({ id: 2, relevance: 0, metrics: { points: 800, comments: 300 } })]);
    expect(out.map((i) => i.id)).toContain(2);
  });
  it("drops low-heat, irrelevant noise", () => {
    const out = selectCandidates([mk({ id: 3, relevance: 0, metrics: { points: 1, comments: 0 } })]);
    expect(out.map((i) => i.id)).not.toContain(3);
  });
  it("keeps high-engagement tweets via likes/retweets/replies (not points/comments)", () => {
    const out = selectCandidates([mk({ id: 4, source: "twitter", relevance: 0, metrics: { likes: 126, retweets: 29, replies: 2 } })]);
    expect(out.map((i) => i.id)).toContain(4);
  });
  it("drops low-engagement tweets without relevance", () => {
    const out = selectCandidates([mk({ id: 5, source: "twitter", relevance: 0, metrics: { likes: 3, retweets: 0, replies: 1 } })]);
    expect(out.map((i) => i.id)).not.toContain(5);
  });
  it("always keeps twitter following tweets (curated timeline), even cold+irrelevant", () => {
    const out = selectCandidates([mk({ id: 6, source: "twitter", feed: "following", relevance: 0, metrics: { likes: 0, retweets: 0, replies: 0 } })]);
    expect(out.map((i) => i.id)).toContain(6);
  });
  it("for-you tweets still need heat or relevance", () => {
    const out = selectCandidates([mk({ id: 7, source: "twitter", feed: "for-you", relevance: 0, metrics: { likes: 1, retweets: 0, replies: 0 } })]);
    expect(out.map((i) => i.id)).not.toContain(7);
  });
});
