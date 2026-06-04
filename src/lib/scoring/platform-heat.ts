import { config } from "../../config.js";

export type Source = "hn" | "rss" | "reddit" | "twitter";

const G = 1.8; // gravity exponent (HN ranking)
const H0 = 2;  // hours offset

function clamp01(x: number): number {
  return Math.max(0, Math.min(1, x));
}

export function hoursSince(createdAt: Date, now: Date = new Date()): number {
  const h = (now.getTime() - createdAt.getTime()) / 3_600_000;
  return h > 0 ? h : 0;
}

export function engagementOf(source: string, metrics: Record<string, number>): number {
  switch (source) {
    case "hn": return metrics.points ?? 0;
    case "reddit": return metrics.ups ?? metrics.score ?? metrics.points ?? 0;
    case "twitter":
      return (metrics.likes ?? 0) + 2 * (metrics.retweets ?? 0) + (metrics.replies ?? 0);
    default: return 0; // rss / unknown: no engagement
  }
}

function normDivisor(source: string): number {
  switch (source) {
    case "hn": return config.HEAT_K_HN;
    case "reddit": return config.HEAT_K_REDDIT;
    case "twitter": return config.HEAT_K_TWITTER;
    default: return 1;
  }
}

export function platformHeat(args: {
  source: string; metrics: Record<string, number>; hours: number; trust: number;
}): number {
  const { source, metrics, hours, trust } = args;
  const decay = Math.pow(H0 / (hours + H0), G); // 1 at hours=0, →0 as hours grows

  if (source === "rss") {
    return clamp01(trust * decay);
  }
  const eng = engagementOf(source, metrics);
  const raw = (eng - 1) / Math.pow(hours + H0, G);
  if (raw <= 0) return 0;
  return clamp01(Math.log10(1 + raw) / normDivisor(source));
}
