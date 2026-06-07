import { describe, expect, it } from "vitest";
import { feedHref } from "../../src/app/feed-nav.js";

describe("feedHref", () => {
  it("uses a clean URL for the default all + latest view", () => {
    expect(feedHref({ source: "all", sort: "time" })).toBe("/");
  });

  it("keeps score sort for the all view", () => {
    expect(feedHref({ source: "all", sort: "score" })).toBe("/?sort=score");
  });

  it("keeps sort when switching platform", () => {
    expect(feedHref({ source: "reddit", sort: "score" })).toBe("/?source=reddit&sort=score");
  });

  it("keeps source even when sort is latest", () => {
    expect(feedHref({ source: "twitter", sort: "time" })).toBe("/?source=twitter&sort=time");
  });
});
