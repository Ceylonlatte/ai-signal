import { afterEach, describe, expect, it, vi } from "vitest";
import { articleToMarkdown, fetchXArticle, statusIdFromUrl } from "../../src/lib/kb/x-article.js";

afterEach(() => vi.unstubAllGlobals());

describe("statusIdFromUrl", () => {
  it("extracts the status id from x.com and twitter.com URLs", () => {
    expect(statusIdFromUrl("https://x.com/0xCodez/status/2082482596135485822")).toBe("2082482596135485822");
    expect(statusIdFromUrl("https://twitter.com/a_b/status/123?s=20")).toBe("123");
    expect(statusIdFromUrl("https://www.x.com/a/status/9")).toBe("9");
  });
  it("returns null for non-status URLs", () => {
    expect(statusIdFromUrl("https://x.com/0xCodez")).toBeNull();
    expect(statusIdFromUrl("https://example.com/status/123")).toBeNull();
    expect(statusIdFromUrl(null)).toBeNull();
  });
});

// FxTwitter's article.content is Draft.js: blocks + a list-serialized entityMap
// referenced positionally by block entityRanges.
function fixtureArticle() {
  return {
    title: "T",
    content: {
      blocks: [
        { key: "a", type: "header-one", text: "Heading", inlineStyleRanges: [], entityRanges: [] },
        {
          key: "b", type: "unstyled", text: "bold and a link here",
          inlineStyleRanges: [{ offset: 0, length: 4, style: "Bold" }],
          entityRanges: [{ offset: 11, length: 4, key: 1 }],
        },
        { key: "c", type: "unordered-list-item", text: "point", inlineStyleRanges: [], entityRanges: [] },
        { key: "d", type: "ordered-list-item", text: "first", inlineStyleRanges: [], entityRanges: [] },
        { key: "e", type: "ordered-list-item", text: "second", inlineStyleRanges: [], entityRanges: [] },
        { key: "f", type: "atomic", text: " ", inlineStyleRanges: [], entityRanges: [{ offset: 0, length: 1, key: 0 }] },
        { key: "g", type: "atomic", text: " ", inlineStyleRanges: [], entityRanges: [{ offset: 0, length: 1, key: 2 }] },
        { key: "h", type: "atomic", text: " ", inlineStyleRanges: [], entityRanges: [{ offset: 0, length: 1, key: 3 }] },
        { key: "i", type: "blockquote", text: "quoted", inlineStyleRanges: [], entityRanges: [] },
      ],
      entityMap: [
        { key: "7", value: { type: "MEDIA", data: { mediaItems: [{ mediaId: "m1" }] } } },
        { key: "3", value: { type: "LINK", data: { url: "https://example.com" } } },
        { key: "9", value: { type: "DIVIDER", data: {} } },
        { key: "5", value: { type: "MARKDOWN", data: { markdown: "```py\ncode\n```" } } },
      ],
    },
    media_entities: [{ media_id: "m1", media_info: { original_img_url: "https://pbs.twimg.com/media/x.png" } }],
  };
}

describe("articleToMarkdown", () => {
  it("converts blocks, inline styles, links, media, dividers, and embedded markdown", () => {
    const { markdown, images } = articleToMarkdown(fixtureArticle() as any);
    expect(markdown).toContain("# Heading");
    expect(markdown).toContain("**bold** and a [link](https://example.com) here");
    expect(markdown).toContain("- point");
    expect(markdown).toContain("1. first");
    expect(markdown).toContain("2. second");
    expect(markdown).toContain("![](https://pbs.twimg.com/media/x.png)");
    expect(markdown).toContain("---");
    expect(markdown).toContain("```py\ncode\n```");
    expect(markdown).toContain("> quoted");
    expect(images).toEqual(["https://pbs.twimg.com/media/x.png"]);
  });

  it("accepts content as a JSON string and skips unresolvable media", () => {
    const art = fixtureArticle() as any;
    art.content = JSON.stringify(art.content);
    art.media_entities = [];
    const { markdown, images } = articleToMarkdown(art);
    expect(markdown).toContain("# Heading");
    expect(markdown).not.toContain("![](");
    expect(images).toEqual([]);
  });
});

describe("fetchXArticle", () => {
  it("returns the tweet's own article", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({
      tweet: { article: fixtureArticle() },
    }))));
    const a = await fetchXArticle("1");
    expect(a?.title).toBe("T");
    expect(a?.quoted).toBe(false);
    expect(a?.markdown).toContain("# Heading");
  });

  it("falls back to the quoted tweet's article and flags it", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({
      tweet: { quote: { article: fixtureArticle() } },
    }))));
    const a = await fetchXArticle("1");
    expect(a?.quoted).toBe(true);
  });

  it("returns null when there is no article, on HTTP error, and on network error", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ tweet: {} }))));
    expect(await fetchXArticle("1")).toBeNull();
    vi.stubGlobal("fetch", vi.fn(async () => new Response("nope", { status: 404 })));
    expect(await fetchXArticle("1")).toBeNull();
    vi.stubGlobal("fetch", vi.fn(async () => { throw new Error("boom"); }));
    expect(await fetchXArticle("1")).toBeNull();
  });
});
