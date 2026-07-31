import { afterEach, expect, it, vi } from "vitest";

afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });

it("parses the five-field note from the model JSON", async () => {
  const content = JSON.stringify({
    overview: "概述句。",
    keypoints: ["要点1", "要点2"],
    facts: ["72.6% FuncPass"],
    why: "值得记的理由。",
    terms: [{ term: "harness", def: "工具框架" }],
  });
  // No `usage` field → recordModelUsage returns early, keeping this test db-free.
  vi.stubGlobal("fetch", vi.fn(async () =>
    new Response(JSON.stringify({ choices: [{ message: { content } }] }), { status: 200 }),
  ));
  const { synthesizeNotes } = await import("../../src/lib/kb/notes.js");
  const note = await synthesizeNotes({ title: "T", markdown: "body" });
  expect(note.overview).toBe("概述句。");
  expect(note.keypoints).toEqual(["要点1", "要点2"]);
  expect(note.terms[0]).toEqual({ term: "harness", def: "工具框架" });
});

it("map-reduces long bodies: one extract per chunk, one final synthesis", async () => {
  // ~22K chars of paragraphs → splitMarkdown(10K) yields 3 chunks → 3 extract
  // calls + 1 reduce call. The old single-shot path silently dropped everything
  // past KB_NOTE_INPUT_CHARS.
  const para = "A paragraph about forward deployed engineering. ".repeat(20).trim();
  const longBody = Array.from({ length: 23 }, () => para).join("\n\n");
  expect(longBody.length).toBeGreaterThan(12_000);

  const systems: string[] = [];
  vi.stubGlobal("fetch", vi.fn(async (_url: any, init: any) => {
    const body = JSON.parse(init.body);
    systems.push(body.messages[0].content);
    const isReduce = body.messages[0].content.includes("已提取的要点集合");
    const content = isReduce
      ? JSON.stringify({ overview: "合成概述", keypoints: ["贯穿全文的要点"], facts: ["729%"], why: "w", terms: [] })
      : JSON.stringify({ points: [`片段要点`], facts: ["$785K"], terms: [] });
    return new Response(JSON.stringify({ choices: [{ message: { content } }] }), { status: 200 });
  }));

  const { synthesizeNotes } = await import("../../src/lib/kb/notes.js");
  const note = await synthesizeNotes({ title: "T", markdown: longBody });
  expect(note.overview).toBe("合成概述");
  expect(note.keypoints).toEqual(["贯穿全文的要点"]);
  const extractCalls = systems.filter((s) => s.includes("长文的一个片段")).length;
  const reduceCalls = systems.filter((s) => s.includes("已提取的要点集合")).length;
  expect(extractCalls).toBe(3);
  expect(reduceCalls).toBe(1);
});

it("keeps short bodies on the single-shot path", async () => {
  const fetchMock = vi.fn(async () =>
    new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify({ overview: "短文概述" }) } }] }), { status: 200 }),
  );
  vi.stubGlobal("fetch", fetchMock);
  const { synthesizeNotes } = await import("../../src/lib/kb/notes.js");
  const note = await synthesizeNotes({ title: "T", markdown: "short body" });
  expect(note.overview).toBe("短文概述");
  expect(fetchMock).toHaveBeenCalledTimes(1);
});

it("tolerates missing fields with safe defaults", async () => {
  vi.stubGlobal("fetch", vi.fn(async () =>
    new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify({ overview: "只有概述" }) } }] }), { status: 200 }),
  ));
  const { synthesizeNotes } = await import("../../src/lib/kb/notes.js");
  const note = await synthesizeNotes({ title: "T", markdown: "body" });
  expect(note.overview).toBe("只有概述");
  expect(note.keypoints).toEqual([]);
  expect(note.facts).toEqual([]);
  expect(note.terms).toEqual([]);
});
