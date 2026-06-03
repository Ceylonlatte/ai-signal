import { afterEach, describe, expect, it, vi } from "vitest";
import { fetchRss } from "../../src/collectors/rss.js";

const FEED_XML = `<?xml version="1.0"?><rss version="2.0"><channel>
<title>OpenAI</title>
<item><title>GPT release</title><link>https://openai.com/p1</link>
<guid>https://openai.com/p1</guid><pubDate>Fri, 30 May 2026 10:00:00 GMT</pubDate>
<description>Body here</description></item>
</channel></rss>`;

afterEach(() => vi.restoreAllMocks());

describe("fetchRss", () => {
  it("maps feed items to RawPayload[]", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(FEED_XML, {
      headers: { "content-type": "application/rss+xml" },
    })));
    const out = await fetchRss({ url: "https://openai.com/news/rss.xml" });
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({
      source: "rss", externalId: "https://openai.com/p1",
      title: "GPT release", url: "https://openai.com/p1",
    });
    expect(out[0]!.createdAt).toBe("2026-05-30T10:00:00.000Z");
  });
});
