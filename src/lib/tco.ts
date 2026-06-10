// Twitter wraps every link in an opaque https://t.co/… redirect, which hides
// the real destination from both the embedding and the LLM scorer — a tweet
// whose substance lives behind the link presents almost no scoreable signal.
// Expanding is one HEAD request per unique link: t.co answers with a 301 and
// the target in the Location header. Best-effort: any failure (timeout,
// missing header, non-redirect) keeps the original short link.

const TCO_RE = /https?:\/\/t\.co\/[A-Za-z0-9]+/g;
const TIMEOUT_MS = 4000;
const CONCURRENCY = 8;

export function findTcoLinks(text: string): string[] {
  return text.match(TCO_RE) ?? [];
}

async function resolveOne(url: string): Promise<string | null> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(url, { method: "HEAD", redirect: "manual", signal: ctrl.signal });
    const loc = res.headers.get("location");
    return loc && /^https?:\/\//.test(loc) && !/^https?:\/\/t\.co\//.test(loc) ? loc : null;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

/** Resolve unique t.co links to their destinations; failed lookups are absent. */
export async function expandTcoLinks(urls: Iterable<string>): Promise<Map<string, string>> {
  const unique = [...new Set(urls)];
  const out = new Map<string, string>();
  for (let i = 0; i < unique.length; i += CONCURRENCY) {
    const slice = unique.slice(i, i + CONCURRENCY);
    const resolved = await Promise.all(slice.map(resolveOne));
    resolved.forEach((r, j) => { if (r) out.set(slice[j]!, r); });
  }
  return out;
}

export function replaceTcoLinks(text: string, expanded: Map<string, string>): string {
  return text.replace(TCO_RE, (m) => expanded.get(m) ?? m);
}
