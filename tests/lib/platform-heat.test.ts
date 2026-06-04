import { describe, expect, it } from "vitest";
import { hoursSince, engagementOf, platformHeat } from "../../src/lib/scoring/platform-heat.js";

describe("hoursSince", () => {
  it("computes fractional hours", () => {
    const now = new Date("2026-06-04T12:00:00Z");
    expect(hoursSince(new Date("2026-06-04T10:00:00Z"), now)).toBeCloseTo(2, 5);
  });
  it("never negative", () => {
    const now = new Date("2026-06-04T12:00:00Z");
    expect(hoursSince(new Date("2026-06-04T13:00:00Z"), now)).toBe(0);
  });
});

describe("engagementOf", () => {
  it("HN uses points only", () => {
    expect(engagementOf("hn", { points: 120, comments: 999 })).toBe(120);
  });
  it("reddit uses ups", () => {
    expect(engagementOf("reddit", { ups: 50 })).toBe(50);
  });
  it("twitter weights retweets", () => {
    expect(engagementOf("twitter", { likes: 10, retweets: 5, replies: 3 })).toBe(10 + 2 * 5 + 3);
  });
  it("rss has no engagement", () => {
    expect(engagementOf("rss", {})).toBe(0);
  });
  it("reddit falls back to score when ups is absent", () => {
    expect(engagementOf("reddit", { score: 50, comments: 3 })).toBe(50);
  });
});

describe("platformHeat", () => {
  it("decays with age for HN", () => {
    const fresh = platformHeat({ source: "hn", metrics: { points: 300 }, hours: 1, trust: 0.5 });
    const old = platformHeat({ source: "hn", metrics: { points: 300 }, hours: 48, trust: 0.5 });
    expect(fresh).toBeGreaterThan(old);
    expect(fresh).toBeLessThanOrEqual(1);
    expect(old).toBeGreaterThanOrEqual(0);
  });
  it("RSS fresh official post ~ trust, decays over time", () => {
    const fresh = platformHeat({ source: "rss", metrics: {}, hours: 0, trust: 0.9 });
    expect(fresh).toBeCloseTo(0.9, 5);
    const old = platformHeat({ source: "rss", metrics: {}, hours: 24, trust: 0.9 });
    expect(old).toBeLessThan(fresh);
  });
  it("zero/low engagement gives ~0 heat for HN", () => {
    expect(platformHeat({ source: "hn", metrics: { points: 1 }, hours: 1, trust: 0.5 })).toBe(0);
  });
});
