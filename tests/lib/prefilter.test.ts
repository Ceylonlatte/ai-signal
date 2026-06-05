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
});
