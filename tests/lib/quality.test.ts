import { describe, expect, it } from "vitest";
import { computeQuality, passesGate, inRescueBand } from "../../src/lib/scoring/quality.js";

describe("computeQuality", () => {
  it("is dominated by llmValue", () => {
    const q = computeQuality({ llmValue: 0.8, relevance: 0.5, trust: 0.5 });
    expect(q).toBeCloseTo(0.8, 5); // neutral rel/trust => no adjustment
  });
  it("relevance/trust nudge around the 0.5 midpoint", () => {
    const up = computeQuality({ llmValue: 0.5, relevance: 1, trust: 1 });
    const down = computeQuality({ llmValue: 0.5, relevance: 0, trust: 0 });
    expect(up).toBeGreaterThan(0.5);
    expect(down).toBeLessThan(0.5);
  });
  it("clamps to [0,1]", () => {
    expect(computeQuality({ llmValue: 1, relevance: 1, trust: 1 })).toBeLessThanOrEqual(1);
    expect(computeQuality({ llmValue: 0, relevance: 0, trust: 0 })).toBeGreaterThanOrEqual(0);
  });
});

describe("gate", () => {
  it("passesGate at/above threshold (default 0.55)", () => {
    expect(passesGate(0.55)).toBe(true);
    expect(passesGate(0.54)).toBe(false);
  });
  it("inRescueBand for borderline below threshold (default margin 0.10)", () => {
    expect(inRescueBand(0.50)).toBe(true);   // 0.45..0.55
    expect(inRescueBand(0.44)).toBe(false);  // too low
    expect(inRescueBand(0.60)).toBe(false);  // already passes
  });
});
