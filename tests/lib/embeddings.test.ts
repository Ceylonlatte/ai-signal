import { afterEach, describe, expect, it, vi } from "vitest";
import { embedTexts } from "../../src/lib/embeddings.js";

afterEach(() => vi.restoreAllMocks());

describe("embedTexts", () => {
  it("returns one vector per input", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({
      data: [{ embedding: [0.1, 0.2] }, { embedding: [0.3, 0.4] }],
    }))));
    process.env.OPENROUTER_API_KEY = "k";
    const out = await embedTexts(["a", "b"]);
    expect(out).toHaveLength(2);
    expect(out[0]).toEqual([0.1, 0.2]);
  });
  it("returns [] for empty input without calling fetch", async () => {
    const f = vi.fn();
    vi.stubGlobal("fetch", f);
    expect(await embedTexts([])).toEqual([]);
    expect(f).not.toHaveBeenCalled();
  });
});
