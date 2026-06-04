import { describe, expect, it, vi, beforeEach } from "vitest";
import { fetchFullText } from "../../src/lib/fulltext.js";
import { extract } from "@extractus/article-extractor";

vi.mock("@extractus/article-extractor", () => ({ extract: vi.fn() }));

describe("fetchFullText", () => {
  beforeEach(() => vi.resetAllMocks());

  it("returns extracted content when available", async () => {
    (extract as any).mockResolvedValue({ content: "<p>Hello world body</p>" });
    const out = await fetchFullText("https://x.com/a", "fallback");
    expect(out.fetched).toBe(true);
    expect(out.text).toBe("Hello world body");
  });

  it("falls back when extraction fails", async () => {
    (extract as any).mockRejectedValue(new Error("paywall"));
    const out = await fetchFullText("https://x.com/a", "fallback text");
    expect(out.fetched).toBe(false);
    expect(out.text).toBe("fallback text");
  });

  it("falls back when url is null", async () => {
    const out = await fetchFullText(null, "fallback text");
    expect(out.fetched).toBe(false);
    expect(out.text).toBe("fallback text");
    expect(extract).not.toHaveBeenCalled();
  });

  it("falls back when extraction returns empty", async () => {
    (extract as any).mockResolvedValue({ content: "   " });
    const out = await fetchFullText("https://x.com/a", "fb");
    expect(out.fetched).toBe(false);
    expect(out.text).toBe("fb");
  });
});
