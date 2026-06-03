import { describe, expect, it } from "vitest";
import { selectCandidates } from "../../src/lib/scoring/prefilter.js";

const mk = (over: Partial<any>) => ({
  id: 1, title: "x", text: "", source: "hn", metrics: { points: 1, comments: 0 }, ...over,
});

describe("selectCandidates", () => {
  it("keeps items hitting a watched keyword even with low heat", () => {
    const out = selectCandidates([mk({ id: 1, title: "New Claude Code release", metrics: { points: 1 } })]);
    expect(out.map((i) => i.id)).toContain(1);
  });
  it("keeps high-heat items even without keywords", () => {
    const out = selectCandidates([mk({ id: 2, title: "unrelated", metrics: { points: 800, comments: 300 } })]);
    expect(out.map((i) => i.id)).toContain(2);
  });
  it("drops low-heat, no-keyword noise", () => {
    const out = selectCandidates([mk({ id: 3, title: "random startup blog", metrics: { points: 1, comments: 0 } })]);
    expect(out.map((i) => i.id)).not.toContain(3);
  });
});
