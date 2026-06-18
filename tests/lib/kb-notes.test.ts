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
