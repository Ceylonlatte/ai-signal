import { afterEach, describe, expect, it, vi } from "vitest";
import { scoreBatch } from "../../src/lib/scoring/llm.js";

afterEach(() => vi.restoreAllMocks());

const llmJson = {
  choices: [{ message: { content: JSON.stringify({
    results: [
      { id: 1, value: 88, topics: ["agents", "claude code"], reason: "concrete release", summary: "Anthropic ships X." },
      { id: 2, value: 12, topics: ["marketing"], reason: "hype", summary: "Startup blog." },
    ],
  }) } }],
};

describe("scoreBatch", () => {
  it("sends candidates and parses validated results keyed by id", async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify(llmJson)));
    vi.stubGlobal("fetch", fetchMock);
    process.env.OPENROUTER_API_KEY = "k";

    const out = await scoreBatch([
      { id: 1, title: "Anthropic X", text: "details", source: "hn", metrics: { points: 100 }, relevance: 1 },
      { id: 2, title: "Blog", text: "", source: "hn", metrics: { points: 1 }, relevance: 0 },
    ]);

    expect(fetchMock).toHaveBeenCalledOnce();
    expect(out.get(1)).toMatchObject({ value: 88 });
    expect(out.get(2)!.value).toBe(12);

    const r = out.get(1)!;
    expect("summary" in r).toBe(false);
  });

  it("returns empty map for empty input without calling fetch", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const out = await scoreBatch([]);
    expect(out.size).toBe(0);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
