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
  signal: "up" | "down" | null;
  isFavorited: boolean;
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

// HN "Ask HN"/"Tell HN" and other text posts have no external URL — the Algolia
// API returns url: null — so the title link must point at the HN discussion page
// (where the content lives) instead of falling back to "#", which only scrolls
// to the top of the current page.
export function itemUrl(item: {
  url?: string | null;
  source?: string | null;
  externalId?: string | null;
}): string | null {
  if (item.url) return item.url;
  if (item.source === "hn" && item.externalId) {
    return `https://news.ycombinator.com/item?id=${item.externalId}`;
  }
  return null;
}

// `rMin`/`rMax` are the ranking-score bounds of the *entire* visible feed, so a
// given item reads the same strength on page 1 and page 5 (stable under infinite
// scroll), not relative to whichever 30 rows happen to share its page.
export function toFeedData(item: any, now: Date, rMin: number, rMax: number): FeedItemData {
  const url = itemUrl(item);
  return {
    id: item.id,
    url,
    host: hostOf(url),
    title: item.titleZh || item.title || "(无标题)",
    author: item.source === "twitter" ? (item.author ?? null) : null,
    reason: item.reason ?? "",
    summaryZh: item.summaryZh ?? "",
    summaryEn: item.summaryEn ?? "",
    sourceLabel: sourceLabel(item.source),
    tags: Array.isArray(item.topicTags) ? item.topicTags.map(String) : [],
    signal: item.signal === "up" || item.signal === "down" ? item.signal : null,
    isFavorited: item.isFavorited === true,
    strength: relativeStrength(item.r, rMin, rMax),
    score: relativeScore(item.r, rMin, rMax),
    rText: typeof item.r === "number" ? item.r.toFixed(2) : "—",
    timeText: item.createdAt ? relativeTime(item.createdAt, now) : "",
  };
}
