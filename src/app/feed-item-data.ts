import { relativeScore, relativeStrength, relativeTime, sourceLabel, type Strength } from "./format.js";

export interface FeedItemData {
  id: number;
  url: string | null;
  host: string;
  title: string;
  author: string | null;
  reason: string;
  summaryZh: string;
  summaryEn: string;
  sourceLabel: string;
  tags: string[];
  strength: Strength;
  score: number;
  rText: string;
  timeText: string;
}

export function hostOf(url: string | null): string {
  if (!url) return "";
  try {
    return new URL(url).host.replace(/^www\./, "");
  } catch {
    return "";
  }
}

// `rMin`/`rMax` are the ranking-score bounds of the *entire* visible feed, so a
// given item reads the same strength on page 1 and page 5 (stable under infinite
// scroll), not relative to whichever 30 rows happen to share its page.
export function toFeedData(item: any, now: Date, rMin: number, rMax: number): FeedItemData {
  return {
    id: item.id,
    url: item.url ?? null,
    host: hostOf(item.url ?? null),
    title: item.titleZh || item.title || "(无标题)",
    author: item.source === "twitter" ? (item.author ?? null) : null,
    reason: item.reason ?? "",
    summaryZh: item.summaryZh ?? "",
    summaryEn: item.summaryEn ?? "",
    sourceLabel: sourceLabel(item.source),
    tags: Array.isArray(item.topicTags) ? item.topicTags.map(String) : [],
    strength: relativeStrength(item.r, rMin, rMax),
    score: relativeScore(item.r, rMin, rMax),
    rText: typeof item.r === "number" ? item.r.toFixed(2) : "—",
    timeText: item.createdAt ? relativeTime(item.createdAt, now) : "",
  };
}
