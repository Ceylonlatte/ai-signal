import { describe, expect, it } from "vitest";
import { computeRanking } from "../../src/lib/scoring/ranking.js";

describe("computeRanking", () => {
  it("combines all factors with config weights", () => {
    const r = computeRanking({ q: 1, platformHeat: 1, novelty: 1, likeAffinity: 1, dislikeAffinity: 0 });
    expect(r).toBeCloseTo(1, 5);
  });
  it("higher platformHeat ranks higher, all else equal", () => {
    const hot = computeRanking({ q: 0.6, platformHeat: 0.9, novelty: 0.2, likeAffinity: 0, dislikeAffinity: 0 });
    const cold = computeRanking({ q: 0.6, platformHeat: 0.1, novelty: 0.2, likeAffinity: 0, dislikeAffinity: 0 });
    expect(hot).toBeGreaterThan(cold);
  });
  it("like affinity boosts ranking", () => {
    const liked = computeRanking({ q: 0.6, platformHeat: 0.3, novelty: 0.2, likeAffinity: 1, dislikeAffinity: 0 });
    const neutral = computeRanking({ q: 0.6, platformHeat: 0.3, novelty: 0.2, likeAffinity: 0, dislikeAffinity: 0 });
    expect(liked).toBeGreaterThan(neutral);
  });
  it("dislike affinity demotes ranking", () => {
    const disliked = computeRanking({ q: 0.6, platformHeat: 0.3, novelty: 0.2, likeAffinity: 0, dislikeAffinity: 1 });
    const neutral = computeRanking({ q: 0.6, platformHeat: 0.3, novelty: 0.2, likeAffinity: 0, dislikeAffinity: 0 });
    expect(disliked).toBeLessThan(neutral);
  });
});
