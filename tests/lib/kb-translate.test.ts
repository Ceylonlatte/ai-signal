import { afterEach, expect, it, vi } from "vitest";
import { needsTranslation, splitMarkdown } from "../../src/lib/kb/translate.js";

afterEach(() => { vi.restoreAllMocks(); });

it("flags predominantly-English text as needing translation", () => {
  expect(needsTranslation("This is an English sentence about agents.")).toBe(true);
});

it("leaves predominantly-Chinese text alone", () => {
  expect(needsTranslation("这是一段中文说明，介绍智能体的能力。")).toBe(false);
});

it("returns false for empty or letterless text", () => {
  expect(needsTranslation("")).toBe(false);
  expect(needsTranslation("   ")).toBe(false);
  expect(needsTranslation("123 456 :) —— !!")).toBe(false); // no CJK and no latin letters
});

it("splitMarkdown packs blocks up to the target and keeps order", () => {
  const md = "para one\n\npara two\n\npara three";
  expect(splitMarkdown(md, 20)).toEqual(["para one\n\npara two", "para three"]);
  expect(splitMarkdown(md, 10_000)).toEqual([md]);
  expect(splitMarkdown("", 100)).toEqual([]);
});

it("splitMarkdown never splits inside a code fence", () => {
  const fence = "```py\nline1\n\nline2\n```";
  const md = `intro\n\n${fence}\n\noutro`;
  const chunks = splitMarkdown(md, 8);
  expect(chunks).toContain(fence); // fence survives whole despite its interior blank line
  expect(chunks.join("\n\n")).toBe(md);
});

it("translateToZh translates chunks independently and rejoins in order", async () => {
  // Two English paragraphs with a tiny target impossible — use default target but
  // large blocks: force two chunks by exceeding 4K in the first paragraph.
  const p1 = "English paragraph one ".repeat(200); // ~4.4K chars → own chunk
  const p2 = "English paragraph two.";
  const calls: string[] = [];
  vi.stubGlobal("fetch", vi.fn(async (_url: any, init: any) => {
    const body = JSON.parse(init.body);
    calls.push(body.messages[1].content);
    const zh = body.messages[1].content.includes("one") ? "第一段译文" : "第二段译文";
    return new Response(JSON.stringify({ choices: [{ message: { content: zh } }] }), { status: 200 });
  }));
  const { translateToZh } = await import("../../src/lib/kb/translate.js");
  expect(await translateToZh(`${p1.trim()}\n\n${p2}`)).toBe("第一段译文\n\n第二段译文");
  expect(calls).toHaveLength(2);
});

it("translateToZh passes code-only chunks through without calling the model", async () => {
  const spy = vi.fn();
  vi.stubGlobal("fetch", spy);
  const code = "```\n1 + 1\n```";
  const { translateToZh } = await import("../../src/lib/kb/translate.js");
  expect(await translateToZh(code)).toBe(code);
  expect(spy).not.toHaveBeenCalled();
});

it("translateToZh retries a still-English result once, then falls back to the original chunk", async () => {
  const fetchMock = vi.fn(async () =>
    new Response(JSON.stringify({ choices: [{ message: { content: "still English output" } }] }), { status: 200 }),
  );
  vi.stubGlobal("fetch", fetchMock);
  const { translateToZh } = await import("../../src/lib/kb/translate.js");
  const input = "An English paragraph that should have been translated.";
  expect(await translateToZh(input)).toBe(input); // fallback keeps content readable
  expect(fetchMock).toHaveBeenCalledTimes(2); // first try + one retry
});

it("translateToZh posts to the model and returns trimmed content", async () => {
  // No `usage` field → recordModelUsage returns early, keeping this test db-free.
  vi.stubGlobal("fetch", vi.fn(async () =>
    new Response(JSON.stringify({ choices: [{ message: { content: "  译文内容  " } }] }), { status: 200 }),
  ));
  const { translateToZh } = await import("../../src/lib/kb/translate.js");
  expect(await translateToZh("English body")).toBe("译文内容");
});

it("translateToZh returns '' for empty input without calling the model", async () => {
  const spy = vi.fn();
  vi.stubGlobal("fetch", spy);
  const { translateToZh } = await import("../../src/lib/kb/translate.js");
  expect(await translateToZh("   ")).toBe("");
  expect(spy).not.toHaveBeenCalled();
});
