import { afterEach, describe, expect, it, vi } from "vitest";
import { fetchHackerNews } from "../../src/collectors/hn.js";

const algoliaResponse = {
  hits: [{
    objectID: "999", title: "GPT-5 released", url: "https://openai.com/gpt5",
    author: "sama", points: 500, num_comments: 200, created_at_i: 1748599200,
    story_text: null,
  }],
};

afterEach(() => vi.restoreAllMocks());

describe("fetchHackerNews", () => {
  it("maps Algolia hits to RawPayload[]", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify(algoliaResponse))));
    const out = await fetchHackerNews({ query: "AI", sinceHours: 24 });
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({
      source: "hn", externalId: "999", title: "GPT-5 released",
      url: "https://openai.com/gpt5", author: "sama",
      metrics: { points: 500, comments: 200 },
    });
    expect(out[0]!.createdAt).toBe("2025-05-30T10:00:00.000Z");
  });
});
