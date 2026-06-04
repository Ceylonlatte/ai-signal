// Per-host trust for RSS official blogs; per-kind default otherwise. 0..1.
const HOST_TRUST: Array<{ match: string; trust: number }> = [
  { match: "openai.com", trust: 0.95 },
  { match: "anthropic.com", trust: 0.95 },
  { match: "deepmind.google", trust: 0.95 },
  { match: "research.google", trust: 0.9 },
  { match: "cursor.com", trust: 0.85 },
  { match: "cursor.sh", trust: 0.85 },
];

const KIND_DEFAULT: Record<string, number> = {
  hn: 0.5, reddit: 0.5, twitter: 0.5, rss: 0.6,
};

export function sourceTrust(source: string, url: string | null): number {
  if (url) {
    let host = "";
    try { host = new URL(url).hostname.toLowerCase(); } catch { host = ""; }
    for (const h of HOST_TRUST) {
      if (host === h.match || host.endsWith(`.${h.match}`)) return h.trust;
    }
  }
  return KIND_DEFAULT[source] ?? 0.5;
}
