import { extract } from "@extractus/article-extractor";

const FETCH_TIMEOUT_MS = 10_000;

function stripHtml(html: string): string {
  return html.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
}

// SSRF guard: refuse to fetch private / loopback / link-local / cloud-metadata
// targets. This is a pre-check on the literal URL host only — it does NOT follow
// redirects, so it is a proportionate mitigation for a personal deployment, not
// airtight protection. Non-http(s) schemes are rejected outright.
export function isFetchableUrl(raw: string): boolean {
  let u: URL;
  try {
    u = new URL(raw);
  } catch {
    return false;
  }
  if (u.protocol !== "http:" && u.protocol !== "https:") return false;

  const host = u.hostname.toLowerCase();
  if (host === "localhost" || host.endsWith(".localhost")) return false;

  if (host.includes(":")) {
    const h = host.replace(/^\[|\]$/g, "");
    if (h === "::1" || h === "::") return false;
    if (/^fe[89ab]/.test(h)) return false; // fe80::/10 link-local
    if (/^f[cd]/.test(h)) return false; // fc00::/7 unique-local
    return true;
  }

  const m = host.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  if (m) {
    const a = Number(m[1]);
    const b = Number(m[2]);
    if (a === 0 || a === 10 || a === 127) return false; // this-host / private / loopback
    if (a === 169 && b === 254) return false; // link-local + cloud metadata (169.254.169.254)
    if (a === 172 && b >= 16 && b <= 31) return false; // 172.16.0.0/12
    if (a === 192 && b === 168) return false; // 192.168.0.0/16
    if (a === 100 && b >= 64 && b <= 127) return false; // 100.64.0.0/10 CGNAT
  }
  return true;
}

// Always attempt to fetch + extract the article body; on any failure
// (blocked host, network, timeout, paywall, empty), fall back to the provided text.
export async function fetchFullText(
  url: string | null, fallback: string,
): Promise<{ text: string; fetched: boolean }> {
  if (!url || !isFetchableUrl(url)) return { text: fallback, fetched: false };
  try {
    const article = await extract(url, {}, { signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) });
    const content = article?.content ? stripHtml(article.content) : "";
    if (content.length > 0) return { text: content, fetched: true };
  } catch {
    // swallow: fall through to fallback
  }
  return { text: fallback, fetched: false };
}
