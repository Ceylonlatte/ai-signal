import { describe, expect, it } from "vitest";
import { joinThreshold, TOPIC_SOFT_CAP, MIN_JOIN_THRESHOLD } from "../../src/lib/cluster.js";

describe("joinThreshold", () => {
  it("keeps the base threshold up to the soft cap", () => {
    expect(joinThreshold(0.25, 1)).toBe(0.25);
    expect(joinThreshold(0.25, TOPIC_SOFT_CAP)).toBe(0.25);
  });

  it("shrinks the radius as a topic outgrows the cap", () => {
    const at60 = joinThreshold(0.25, 60);
    const at120 = joinThreshold(0.25, 120);
    expect(at60).toBeLessThan(0.25);
    expect(at120).toBeLessThan(at60);
    // sqrt falloff: doubling members shrinks by ~1/sqrt(2)
    expect(at60).toBeCloseTo(0.25 * Math.sqrt(TOPIC_SOFT_CAP / 60), 10);
  });

  it("never shrinks below the near-duplicate floor", () => {
    expect(joinThreshold(0.25, 423)).toBe(MIN_JOIN_THRESHOLD);
    expect(joinThreshold(0.25, 100000)).toBe(MIN_JOIN_THRESHOLD);
  });
});
