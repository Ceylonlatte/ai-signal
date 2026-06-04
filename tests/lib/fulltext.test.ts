import { describe, expect, it, vi, beforeEach } from "vitest";
import { fetchFullText, isFetchableUrl } from "../../src/lib/fulltext.js";
import { extract } from "@extractus/article-extractor";

vi.mock("@extractus/article-extractor", () => ({ extract: vi.fn() }));

describe("isFetchableUrl", () => {
  it("allows public http(s) hosts", () => {
    expect(isFetchableUrl("https://openai.com/news")).toBe(true);
    expect(isFetchableUrl("http://example.com/a")).toBe(true);
    expect(isFetchableUrl("https://8.8.8.8/x")).toBe(true);
  });
  it("blocks loopback / private / link-local / metadata targets", () => {
    expect(isFetchableUrl("http://localhost/x")).toBe(false);
    expect(isFetchableUrl("http://127.0.0.1/x")).toBe(false);
    expect(isFetchableUrl("http://169.254.169.254/latest/meta-data")).toBe(false);
    expect(isFetchableUrl("http://10.1.2.3/x")).toBe(false);
    expect(isFetchableUrl("http://192.168.0.5/x")).toBe(false);
    expect(isFetchableUrl("http://172.16.5.5/x")).toBe(false);
    expect(isFetchableUrl("http://[::1]/x")).toBe(false);
  });
  it("rejects non-http schemes and garbage", () => {
    expect(isFetchableUrl("ftp://example.com/a")).toBe(false);
    expect(isFetchableUrl("file:///etc/passwd")).toBe(false);
    expect(isFetchableUrl("not a url")).toBe(false);
  });
});

describe("fetchFullText", () => {
  beforeEach(() => vi.resetAllMocks());

  it("falls back without fetching when the host is blocked", async () => {
    const out = await fetchFullText("http://169.254.169.254/latest", "fallback");
    expect(out.fetched).toBe(false);
    expect(out.text).toBe("fallback");
    expect(extract).not.toHaveBeenCalled();
  });

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
