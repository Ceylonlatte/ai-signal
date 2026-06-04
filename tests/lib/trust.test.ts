import { describe, expect, it } from "vitest";
import { sourceTrust } from "../../src/lib/sources/trust.js";

describe("sourceTrust", () => {
  it("official lab blogs get high trust", () => {
    expect(sourceTrust("rss", "https://openai.com/news/foo")).toBeGreaterThanOrEqual(0.9);
    expect(sourceTrust("rss", "https://www.anthropic.com/news/bar")).toBeGreaterThanOrEqual(0.9);
  });
  it("unknown rss host gets medium trust", () => {
    const t = sourceTrust("rss", "https://some-random-blog.example/post");
    expect(t).toBeGreaterThan(0);
    expect(t).toBeLessThan(0.9);
  });
  it("hn/reddit/twitter default trust", () => {
    expect(sourceTrust("hn", null)).toBeCloseTo(0.5, 5);
  });
  it("null url is safe", () => {
    expect(sourceTrust("rss", null)).toBeGreaterThan(0);
  });
});
