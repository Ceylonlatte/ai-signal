import { describe, expect, it } from "vitest";
import { likeAffinity, isSuppressed, likeRescues, clamp01 } from "../../src/lib/feedback/profile.js";

describe("likeAffinity", () => {
  it("is 0 with no upvotes (cold start)", () => {
    expect(likeAffinity(0.9, 0)).toBe(0);
  });
  it("scales with upvote count up to N0 (default 5)", () => {
    expect(likeAffinity(1, 5)).toBeCloseTo(1, 5);
    expect(likeAffinity(1, 1)).toBeCloseTo(0.2, 5);
  });
  it("clamps negative similarity to 0", () => {
    expect(likeAffinity(-0.5, 10)).toBe(0);
  });
  it("null similarity => 0", () => {
    expect(likeAffinity(null, 10)).toBe(0);
  });
});

describe("isSuppressed", () => {
  it("true at/above SUPPRESS_THRESHOLD (default 0.92)", () => {
    expect(isSuppressed(0.95)).toBe(true);
    expect(isSuppressed(0.90)).toBe(false);
    expect(isSuppressed(null)).toBe(false);
  });
});

describe("likeRescues", () => {
  it("true at/above RESCUE_SIM_THRESHOLD (default 0.85)", () => {
    expect(likeRescues(0.86)).toBe(true);
    expect(likeRescues(0.80)).toBe(false);
    expect(likeRescues(null)).toBe(false);
  });
});

describe("clamp01", () => {
  it("clamps", () => { expect(clamp01(2)).toBe(1); expect(clamp01(-1)).toBe(0); });
});
