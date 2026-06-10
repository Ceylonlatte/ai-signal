import { afterEach, expect, it, vi } from "vitest";
import { findTcoLinks, expandTcoLinks, replaceTcoLinks } from "../../src/lib/tco.js";

function headResponse(location: string | null): Response {
  return new Response(null, {
    status: 301,
    headers: location ? { location } : {},
  });
}

afterEach(() => { vi.unstubAllGlobals(); });

it("finds t.co links in tweet text", () => {
  const text = "GM https://t.co/abc123 and https://t.co/XYZ9 done";
  expect(findTcoLinks(text)).toEqual(["https://t.co/abc123", "https://t.co/XYZ9"]);
  expect(findTcoLinks("no links here")).toEqual([]);
});

it("expands links via the redirect Location header and replaces them", async () => {
  vi.stubGlobal("fetch", vi.fn(async (url: string) =>
    headResponse(url === "https://t.co/abc123" ? "https://github.com/foo/bar" : null)));

  const expanded = await expandTcoLinks(["https://t.co/abc123", "https://t.co/dead1"]);
  expect(expanded.get("https://t.co/abc123")).toBe("https://github.com/foo/bar");
  expect(expanded.has("https://t.co/dead1")).toBe(false);

  const out = replaceTcoLinks("see https://t.co/abc123 + https://t.co/dead1", expanded);
  expect(out).toBe("see https://github.com/foo/bar + https://t.co/dead1");
});

it("keeps the short link when fetch fails or redirects back to t.co", async () => {
  vi.stubGlobal("fetch", vi.fn(async (url: string) => {
    if (url === "https://t.co/boom1") throw new Error("network");
    return headResponse("https://t.co/loop2");
  }));

  const expanded = await expandTcoLinks(["https://t.co/boom1", "https://t.co/loop2"]);
  expect(expanded.size).toBe(0);
  expect(replaceTcoLinks("x https://t.co/boom1", expanded)).toBe("x https://t.co/boom1");
});

it("deduplicates and only fetches each unique link once", async () => {
  const fetchMock = vi.fn(async () => headResponse("https://example.com/a"));
  vi.stubGlobal("fetch", fetchMock);

  await expandTcoLinks(["https://t.co/same1", "https://t.co/same1", "https://t.co/same1"]);
  expect(fetchMock).toHaveBeenCalledTimes(1);
});
