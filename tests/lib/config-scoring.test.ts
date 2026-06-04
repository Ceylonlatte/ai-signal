import { describe, expect, it } from "vitest";
import { config, qualityWeights, rankingWeights } from "../../src/config.js";

describe("scoring config defaults", () => {
  it("has a quality gate threshold", () => {
    expect(config.Q_THRESHOLD).toBeGreaterThan(0);
    expect(config.Q_THRESHOLD).toBeLessThanOrEqual(1);
  });
  it("exposes quality weights (llm-dominant)", () => {
    expect(qualityWeights.wRel).toBeGreaterThanOrEqual(0);
    expect(qualityWeights.wTrust).toBeGreaterThanOrEqual(0);
  });
  it("ranking weights sum near 1", () => {
    const sum = rankingWeights.wQ + rankingWeights.wHeat + rankingWeights.wNov + rankingWeights.wAff;
    expect(sum).toBeCloseTo(1, 5);
  });
  it("has feedback profile knobs", () => {
    expect(config.SUPPRESS_THRESHOLD).toBeGreaterThan(0);
    expect(config.RESCUE_SIM_THRESHOLD).toBeGreaterThan(0);
    expect(config.RESCUE_MARGIN).toBeGreaterThan(0);
    expect(config.COLDSTART_N0).toBeGreaterThan(0);
    expect(config.PROFILE_WINDOW_DAYS).toBeGreaterThan(0);
  });
});
