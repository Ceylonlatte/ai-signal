import type { SourceKind } from "../types.js";

const SOURCE_LABELS: Record<string, string> = {
  hn: "Hacker News",
  rss: "RSS",
  reddit: "Reddit",
  twitter: "X",
};

export function sourceLabel(source: string): string {
  return SOURCE_LABELS[source] ?? source;
}

export type Strength = "high" | "mid" | "low";

// Strength is relative to the current view: the live ranking score `r` is
// min-max normalized across the items on screen, so the strongest signals
// read "强" and the weakest "弱" regardless of the absolute scale (which
// drifts low for aged items as platform heat decays).
export function relativeStrength(
  r: number | null | undefined,
  min: number,
  max: number,
): Strength {
  const v = typeof r === "number" ? r : 0;
  if (!(max > min)) return "mid";
  const n = (v - min) / (max - min);
  if (n >= 0.66) return "high";
  if (n >= 0.33) return "mid";
  return "low";
}

export function strengthLabel(s: Strength): string {
  return s === "high" ? "强" : s === "mid" ? "中" : "弱";
}

// The same view-relative normalization as `relativeStrength`, surfaced as a
// 0–100 "signal score" for the dial. Degenerate (all-equal) views read 50.
export function relativeScore(
  r: number | null | undefined,
  min: number,
  max: number,
): number {
  const v = typeof r === "number" ? r : 0;
  if (!(max > min)) return 50;
  const n = (v - min) / (max - min);
  return Math.round(Math.min(1, Math.max(0, n)) * 100);
}

export function relativeTime(iso: string, now: Date = new Date()): string {
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return "";
  const mins = Math.round((now.getTime() - then) / 60000);
  if (mins < 1) return "刚刚";
  if (mins < 60) return `${mins} 分钟前`;
  const hours = Math.round(mins / 60);
  if (hours < 24) return `${hours} 小时前`;
  const days = Math.round(hours / 24);
  if (days < 30) return `${days} 天前`;
  return new Date(iso).toLocaleDateString("zh-CN", { month: "numeric", day: "numeric" });
}

export { SOURCE_LABELS };
export type { SourceKind };
