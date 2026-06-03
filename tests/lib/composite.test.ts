import { describe, expect, it } from "vitest";
import { normalizeHeat, computeComposite } from "../../src/lib/scoring/composite.js";

describe("normalizeHeat", () => {
  it("is 0 for no engagement and approaches 1 for high engagement", () => {
    expect(normalizeHeat({})).toBe(0);
    expect(normalizeHeat({ points: 0, comments: 0 })).toBe(0);
    const hot = normalizeHeat({ points: 1000, comments: 500 });
    expect(hot).toBeGreaterThan(0.8);
    expect(hot).toBeLessThanOrEqual(1);
  });
});

describe("computeComposite", () => {
  it("weights each component", () => {
    const c = computeComposite(
      { heat: 1, relevance: 1, novelty: 1, llmValue: 1 },
      { heat: 0.2, relevance: 0.2, novelty: 0.15, llm: 0.45 },
    );
    expect(c).toBeCloseTo(1, 5);
  });
  it("ignores novelty when its weight is 0", () => {
    const c = computeComposite(
      { heat: 0, relevance: 0, novelty: 0, llmValue: 0.5 },
      { heat: 0.2, relevance: 0.2, novelty: 0, llm: 0.45 },
    );
    expect(c).toBeCloseTo(0.5 * 0.45, 5);
  });
});
