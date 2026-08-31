import { afterEach, describe, expect, it, vi } from "vitest";
import { parseChunkResults, scoreBatch } from "../../src/lib/scoring/llm.js";

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

// Regression: the scoring model intermittently returns `id` as a string, and a
// strict `id: z.number()` used to throw out of responseSchema.parse() and lose
// the entire BATCH=25 chunk.
describe("scoreChunk result parsing", () => {
  const respond = (results: unknown[]) => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({
      choices: [{ message: { content: JSON.stringify({ results }) } }],
    })));
    vi.stubGlobal("fetch", fetchMock);
    process.env.OPENROUTER_API_KEY = "k";
    return fetchMock;
  };
  const candidates = [1, 2, 3].map((id) => ({
    id, title: `t${id}`, text: "", source: "hn", metrics: { points: 1 }, relevance: 1,
  }));

  it("accepts string ids", async () => {
    respond([{ id: "1", value: 70, topics: ["agents"], reason: "ok" }]);
    const out = await scoreBatch(candidates);
    expect(out.get(1)).toMatchObject({ id: 1, value: 70 });
  });

  it("keeps siblings when one entry is malformed", async () => {
    respond([
      { id: 1, value: 80, topics: [], reason: "a" },
      { id: { nope: true }, value: 50, topics: [], reason: "bad" },
      { id: "3", value: 60, topics: [], reason: "c" },
    ]);
    const out = await scoreBatch(candidates);
    expect([...out.keys()].sort()).toEqual([1, 3]);
    expect(out.get(3)!.value).toBe(60);
  });

  it("drops garbage ids instead of coercing them to 0", () => {
    const results = parseChunkResults(JSON.stringify({ results: [
      { id: "abc", value: 10, topics: [], reason: "" },
      { id: null, value: 10, topics: [], reason: "" },
      { id: true, value: 10, topics: [], reason: "" },
      { id: [], value: 10, topics: [], reason: "" },
      { id: 1.5, value: 10, topics: [], reason: "" },
      { id: "", value: 10, topics: [], reason: "" },
      { value: 10, topics: [], reason: "" },
      { id: 7, value: 10, topics: [], reason: "" },
    ] }));
    expect(results.map((r) => r.id)).toEqual([7]);
  });

  it("ignores ids that were not in the chunk", async () => {
    respond([
      { id: 1, value: 80, topics: [], reason: "a" },
      { id: 999, value: 90, topics: [], reason: "not ours" },
    ]);
    const out = await scoreBatch(candidates);
    expect(out.get(2)).toBeUndefined();
    expect(out.get(3)).toBeUndefined();
    expect(out.get(1)!.value).toBe(80);
  });

  it("drops the chunk without throwing when the payload is unusable", () => {
    expect(parseChunkResults("not json at all")).toEqual([]);
    expect(parseChunkResults(JSON.stringify({ oops: 1 }))).toEqual([]);
  });
});
