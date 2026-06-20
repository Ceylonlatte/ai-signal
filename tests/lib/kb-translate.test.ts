import { afterEach, expect, it, vi } from "vitest";
import { needsTranslation } from "../../src/lib/kb/translate.js";

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
