import type { RssRow } from "./rss-queries.js";

export interface RssDayGroup {
  day: string;
  items: RssRow[];
}

export function dayLabel(iso: string): string {
  return new Date(iso).toLocaleDateString("zh-CN", {
    year: "numeric",
    month: "long",
    day: "numeric",
    weekday: "long",
  });
}

// Items already arrive newest-first, so a single linear pass produces
// date-ordered groups without re-sorting.
export function groupByDay(rows: RssRow[]): RssDayGroup[] {
  const groups: RssDayGroup[] = [];
  for (const r of rows) {
    const day = dayLabel(r.publishedAt);
    const last = groups[groups.length - 1];
    if (last && last.day === day) last.items.push(r);
    else groups.push({ day, items: [r] });
  }
  return groups;
}
