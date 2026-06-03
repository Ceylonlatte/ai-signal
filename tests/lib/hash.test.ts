import { describe, expect, it } from "vitest";
import { contentHash } from "../../src/lib/hash.js";

describe("contentHash", () => {
  it("is stable and ignores case/whitespace noise in title+text", () => {
    const a = contentHash({ title: "Hello  World", text: "Body" });
    const b = contentHash({ title: "hello world", text: "body" });
    expect(a).toBe(b);
    expect(a).toMatch(/^[a-f0-9]{64}$/);
  });
  it("differs when content differs", () => {
    expect(contentHash({ title: "A", text: "x" }))
      .not.toBe(contentHash({ title: "B", text: "x" }));
  });
});
