import { describe, expect, it } from "vitest";
import { computeRelevance, WATCHED_KEYWORDS } from "../../src/lib/keywords.js";

describe("computeRelevance", () => {
  it("matches case-insensitive multiword phrases on word boundaries", () => {
    expect(computeRelevance("Claude Code ships agentic harness", "")).toBeGreaterThan(0);
  });
  it("does NOT match the broad token 'AI' inside other words", () => {
    expect(computeRelevance("maintain the brain", "")).toBe(0);
  });
  it("matches 'AI' only as a standalone, case-sensitive token", () => {
    expect(computeRelevance("AI is here", "")).toBeGreaterThan(0);
    expect(computeRelevance("ai is here", "")).toBe(0);
  });
  it("caps at 1.0", () => {
    const text = WATCHED_KEYWORDS.map((k) => k.term).join(" ");
    expect(computeRelevance(text, "")).toBe(1);
  });
});
