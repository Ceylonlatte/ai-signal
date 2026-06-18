import { afterEach, expect, it, vi } from "vitest";

// Stub the R2 module so no network/S3 is touched; uploads return a fake URL.
vi.mock("../../src/lib/kb/r2.js", () => ({
  r2Configured: () => true,
  publicUrl: (k: string) => `https://cdn.test/${k}`,
  putObject: vi.fn(async (k: string) => `https://cdn.test/${k}`),
}));

afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });

function imgResponse(bytes: number, contentType = "image/png") {
  return new Response(new Uint8Array(bytes), { status: 200, headers: { "content-type": contentType } });
}

it("flags noise images (cookie/icon/svg) regardless of host", async () => {
  const { isNoiseImage } = await import("../../src/lib/kb/images.js");
  expect(isNoiseImage("https://cdn-cookieyes.com/assets/images/close.svg")).toBe(true);
  expect(isNoiseImage("https://site.com/favicon.png")).toBe(true);
  expect(isNoiseImage("https://site.com/article/diagram.png")).toBe(false);
});

it("downloads a content image, uploads it, and rewrites the markdown URL", async () => {
  vi.stubGlobal("fetch", vi.fn(async () => imgResponse(1000, "image/png")));
  const { localizeImages } = await import("../../src/lib/kb/images.js");
  const md = "before ![cap](https://site.com/a/diagram.png) after";
  const out = await localizeImages(42, md, ["https://site.com/a/diagram.png"]);
  expect(out.images).toHaveLength(1);
  expect(out.images[0]!.r2Url).toContain("https://cdn.test/kb/42/");
  expect(out.markdown).toContain("https://cdn.test/kb/42/");
  expect(out.markdown).not.toContain("site.com/a/diagram.png");
});

it("skips oversized images and keeps the original markdown url", async () => {
  vi.stubGlobal("fetch", vi.fn(async () => imgResponse(10_000_000, "image/png")));
  const { localizeImages } = await import("../../src/lib/kb/images.js");
  const md = "![big](https://site.com/a/huge.png)";
  const out = await localizeImages(7, md, ["https://site.com/a/huge.png"]);
  expect(out.images).toHaveLength(0);
  expect(out.markdown).toBe(md);
});
