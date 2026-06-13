import { describe, expect, it } from "vitest";
import { groupByDay } from "../../src/app/rss/rss-group.js";
import type { RssRow } from "../../src/app/rss/rss-queries.js";

function row(id: number, publishedAt: string): RssRow {
  return {
    id,
    feedUrl: "https://example.com/feed.xml",
    url: "https://example.com/post",
    title: "title",
    titleZh: "标题",
    author: null,
    summary: "summary",
    summaryZh: "摘要",
    publishedAt,
  };
}

describe("groupByDay", () => {
  it("groups consecutive same-day rows and preserves order", () => {
    // identical timestamp => same day in any timezone; a month apart => a
    // different day in every timezone, so grouping is deterministic in CI.
    const rows = [
      row(1, "2026-06-13T12:00:00.000Z"),
      row(2, "2026-06-13T12:00:00.000Z"),
      row(3, "2026-05-10T12:00:00.000Z"),
    ];
    const groups = groupByDay(rows);
    expect(groups.map((g) => g.items.map((r) => r.id))).toEqual([[1, 2], [3]]);
    expect(new Set(groups.map((g) => g.day)).size).toBe(2);
  });

  it("returns an empty array for no rows", () => {
    expect(groupByDay([])).toEqual([]);
  });
});
