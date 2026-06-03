import { describe, expect, it } from "vitest";
import { canonicalizeUrl } from "../../src/lib/url.js";

describe("canonicalizeUrl", () => {
  it("lowercases host, strips tracking params, trailing slash, fragment", () => {
    expect(canonicalizeUrl("HTTPS://Example.com/Post/?utm_source=x&id=5#frag"))
      .toBe("https://example.com/Post?id=5");
  });
  it("drops www and sorts query params", () => {
    expect(canonicalizeUrl("https://www.example.com/a?b=2&a=1"))
      .toBe("https://example.com/a?a=1&b=2");
  });
  it("returns null for null/invalid input", () => {
    expect(canonicalizeUrl(null)).toBeNull();
    expect(canonicalizeUrl("not a url")).toBeNull();
  });
});
