import { describe, expect, it } from "vitest";
import { normalizeRawItem } from "../../src/lib/normalize.js";
import type { RawPayload } from "../../src/types.js";

const raw: RawPayload = {
  source: "hn",
  externalId: "123",
  url: "https://www.example.com/post/?utm_source=hn",
  author: "pg",
  title: "  A Title ",
  text: "Body text",
  createdAt: "2026-05-30T10:00:00Z",
  metrics: { points: 42, comments: 9 },
  raw: {},
};

describe("normalizeRawItem", () => {
  it("trims title, canonicalizes url, hashes content, parses date", () => {
    const n = normalizeRawItem(raw);
    expect(n.title).toBe("A Title");
    expect(n.canonicalUrl).toBe("https://example.com/post");
    expect(n.createdAt.toISOString()).toBe("2026-05-30T10:00:00.000Z");
    expect(n.contentHash).toMatch(/^[a-f0-9]{64}$/);
    expect(n.metrics).toEqual({ points: 42, comments: 9 });
  });
  it("passes through the optional feed provenance", () => {
    const n = normalizeRawItem({ ...raw, feed: "following" });
    expect(n.feed).toBe("following");
  });
  it("leaves feed undefined when absent", () => {
    expect(normalizeRawItem(raw).feed).toBeUndefined();
  });
});
