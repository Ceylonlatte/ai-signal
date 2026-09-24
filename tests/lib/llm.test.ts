import { afterEach, describe, expect, it, vi } from "vitest";
import {
  extractLabel,
  fallbackLabel,
  isLabelLike,
  labelTopic,
  parseChunkResults,
  scoreBatch,
} from "../../src/lib/scoring/llm.js";

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

// Regression: LABEL_PROMPT used to be free text and labelTopic stored
// `content.trim().slice(0, 60)` unchecked. When the scoring model read the
// member titles as a question it answered in prose, and the first 60 chars of
// that chat reply became a topic's label on the daily board:
//   "是的，我很熟悉这个方向。在 LLM Agent 架构中，“外部状态引擎”（External State Engine）通"
describe("labelTopic", () => {
  const PROSE =
    "是的，我很熟悉这个方向。在 LLM Agent 架构中，“外部状态引擎”（External State Engine）" +
    "通常指把会话状态从模型上下文里剥离出来的一层组件，它的职责是持久化、检索和裁剪。";
  const TITLES = [
    "LlamaIndex 发布文档解析基准 ParseBench",
    "LlamaIndex ships ParseBench for document parsing",
  ];
  // Each call takes the next reply; the last one repeats so a single prose
  // string can stand for "the model keeps answering in prose".
  const respondWith = (...contents: string[]) => {
    let i = 0;
    const fetchMock = vi.fn(async (_url: string, _init: RequestInit) => new Response(JSON.stringify({
      choices: [{ message: { content: contents[Math.min(i++, contents.length - 1)]! } }],
    })));
    vi.stubGlobal("fetch", fetchMock);
    process.env.OPENROUTER_API_KEY = "k";
    return fetchMock;
  };
  const bodyOf = (fetchMock: ReturnType<typeof respondWith>, call: number) =>
    JSON.parse(fetchMock.mock.calls[call]![1].body as string);

  it("accepts a well-formed JSON label and asks for a JSON response", async () => {
    const fetchMock = respondWith(JSON.stringify({ label: "LlamaIndex 发布文档解析基准 ParseBench" }));

    expect(await labelTopic(TITLES)).toBe("LlamaIndex 发布文档解析基准 ParseBench");
    expect(fetchMock).toHaveBeenCalledOnce();
    expect(bodyOf(fetchMock, 0).response_format).toEqual({ type: "json_object" });
  });

  it("accepts a bare-text label, since response_format is a request not a guarantee", async () => {
    respondWith("「Claude Fable 5 发布」");
    expect(await labelTopic(TITLES)).toBe("Claude Fable 5 发布");
  });

  it("retries a prose reply and keeps the second answer when it is a label", async () => {
    const fetchMock = respondWith(PROSE, JSON.stringify({ label: "Claude Fable 5 发布" }));

    expect(await labelTopic(TITLES)).toBe("Claude Fable 5 发布");
    expect(fetchMock).toHaveBeenCalledTimes(2);
    // The retry has to say what was wrong, or it is just the same prompt twice.
    const retryPrompts = bodyOf(fetchMock, 1).messages.filter((m: { role: string }) => m.role === "system");
    expect(retryPrompts).toHaveLength(2);
    expect(retryPrompts[1].content).toContain("不是标题");
  });

  it("falls back to a title-derived label when the model only ever answers in prose", async () => {
    const fetchMock = respondWith(PROSE);

    const label = await labelTopic(TITLES);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(label).toBe("LlamaIndex 发布文档解析基准 ParseBench");
    expect(label).not.toContain("是的");
  });

  it("rejects an over-long label instead of storing it truncated", async () => {
    // 60+ chars of plausible-looking label text: the old code sliced this to
    // exactly the 60-char ceiling and stored it.
    respondWith(JSON.stringify({ label: "OpenAI 与 Google 在同一天各自发布了面向企业的推理模型并同步更新了各自的开发者定价页面以及配套文档" }));

    expect(await labelTopic(TITLES)).toBe("LlamaIndex 发布文档解析基准 ParseBench");
  });

  // The fallback feeds the same column the model's answer does, so whatever it
  // produces has to pass the same check — otherwise bin/relabel-bad-topics.ts
  // would report every fallback label as broken, forever.
  it("produces a label-shaped fallback from long or prose-y member titles", () => {
    for (const title of [
      "Anthropic ships a very long headline about agentic coding that nobody would call a label",
      "外部状态引擎：把 Agent 状态移出上下文窗口，我们做了一个实验，结果很有意思",
      "OpenAI 发布 o5。定价同步下调。",
    ]) {
      const out = fallbackLabel([title]);
      expect(out.length).toBeLessThanOrEqual(40);
      expect(isLabelLike(out)).toBe(true);
    }
    expect(fallbackLabel(["", "  ", "Claude Fable 5 发布"])).toBe("Claude Fable 5 发布");
    expect(fallbackLabel([])).toBe("未命名话题");
  });
});

describe("label shape checks", () => {
  it("passes event-style labels", () => {
    for (const s of [
      "LlamaIndex 发布文档解析基准 ParseBench",
      "Claude Fable 5 发布",
      "GPT-5.5 降价",
      "OpenAI 开源 gpt-oss-120b",
    ]) expect(isLabelLike(s)).toBe(true);
  });

  it("rejects chat replies, sentences and empty answers", () => {
    for (const s of [
      "是的，我很熟悉这个方向",
      "当然可以帮你概括这些标题",
      "Sure, here is a label for these headlines",
      "这些标题都在讨论 Agent 的状态管理。",
      "Anthropic 发布了新模型！",
      "",
      "—",
    ]) expect(isLabelLike(s)).toBe(false);
  });

  it("unwraps the label from JSON, code fences and quotes", () => {
    expect(extractLabel(JSON.stringify({ label: "Claude Fable 5 发布" }))).toBe("Claude Fable 5 发布");
    expect(extractLabel('```json\n{"label": "Claude Fable 5 发布"}\n```')).toBe("Claude Fable 5 发布");
    expect(extractLabel("标题：Claude Fable 5 发布")).toBe("Claude Fable 5 发布");
    expect(extractLabel('"Claude Fable 5 发布"')).toBe("Claude Fable 5 发布");
    expect(extractLabel(JSON.stringify({ answer: "是的" }))).toBe("");
  });
});
