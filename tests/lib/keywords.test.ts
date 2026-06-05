import { describe, expect, it } from "vitest";
import { computeRelevance, exactRelevance, WATCHED_KEYWORDS, type Keyword } from "../../src/lib/keywords.js";

const list: Keyword[] = [
  { term: "AI", caseSensitive: true },
  { term: "Claude Code", caseSensitive: false },
  { term: "agentic", caseSensitive: false },
  { term: "大模型", caseSensitive: false },
];

describe("exactRelevance", () => {
  it("matches case-insensitive multiword phrases on word boundaries", () => {
    expect(exactRelevance("Claude Code ships agentic harness", "", list)).toBeGreaterThan(0);
  });
  it("does NOT match the broad token 'AI' inside other words", () => {
    expect(exactRelevance("maintain the brain", "", list)).toBe(0);
  });
  it("matches 'AI' only as a standalone, case-sensitive token", () => {
    expect(exactRelevance("AI is here", "", list)).toBeGreaterThan(0);
    expect(exactRelevance("ai is here", "", list)).toBe(0);
  });
  it("matches CJK terms by substring", () => {
    expect(exactRelevance("国产大模型很强", "", list)).toBeGreaterThan(0);
  });
  it("caps at 1.0", () => {
    const text = list.map((k) => k.term).join(" ");
    expect(exactRelevance(text, "", list)).toBe(1);
  });
});

describe("computeRelevance (built-in seed)", () => {
  it("matches core seed terms", () => {
    expect(computeRelevance("an agentic harness for coding", "")).toBeGreaterThan(0);
    expect(computeRelevance("hello world", "")).toBe(0);
  });
  it("seeds a small curated set", () => {
    expect(WATCHED_KEYWORDS.length).toBeGreaterThan(0);
    expect(WATCHED_KEYWORDS.length).toBeLessThanOrEqual(12);
    expect(WATCHED_KEYWORDS.some((k) => k.term === "Agentic")).toBe(true);
  });
});
