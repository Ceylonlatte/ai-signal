import { afterEach, beforeEach, expect, it, vi } from "vitest";

// Firecrawl needs a key to be attempted; set it for these tests.
beforeEach(() => { process.env.FIRECRAWL_API_KEY = "fc-test"; });
afterEach(() => { vi.restoreAllMocks(); delete process.env.FIRECRAWL_API_KEY; });

function mockFetchSequence(handlers: Array<(url: string) => Response | Promise<Response>>) {
  let i = 0;
  vi.stubGlobal("fetch", vi.fn(async (input: any) => {
    const url = typeof input === "string" ? input : input.url;
    const h = handlers[Math.min(i, handlers.length - 1)]!;
    i++;
    return h(url);
  }));
}

it("returns firecrawl markdown + images when firecrawl succeeds", async () => {
  mockFetchSequence([
    () => new Response(JSON.stringify({ data: { markdown: "# Hi\n![a](http://x/a.png)", images: ["http://x/a.png"] } }), { status: 200 }),
  ]);
  const { fetchArticle } = await import("../../src/lib/kb/reader.js");
  const a = await fetchArticle("http://example.com/post", "fallback");
  expect(a.source).toBe("firecrawl");
  expect(a.markdown).toContain("# Hi");
  expect(a.images).toEqual(["http://x/a.png"]);
});

it("falls back to markdown.new when firecrawl fails, reading content + images", async () => {
  mockFetchSequence([
    () => new Response("err", { status: 500 }),              // firecrawl
    () => new Response(JSON.stringify({ success: true, content: "# Doc\n![cap](http://y/i.jpg)" }), { status: 200 }), // markdown.new
  ]);
  const { fetchArticle } = await import("../../src/lib/kb/reader.js");
  const a = await fetchArticle("http://example.com/post", "fallback");
  expect(a.source).toBe("markdownnew");
  expect(a.images).toEqual(["http://y/i.jpg"]);
});

it("falls back to provided text when url is null", async () => {
  const { fetchArticle } = await import("../../src/lib/kb/reader.js");
  const a = await fetchArticle(null, "raw text body");
  expect(a.source).toBe("fallback");
  expect(a.markdown).toBe("raw text body");
});
