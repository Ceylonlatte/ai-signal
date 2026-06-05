export interface Keyword { term: string; caseSensitive: boolean; }

// A SMALL curated default set. The full, user-managed list lives in the
// `keywords` DB table (seeded with these) and is editable at /keywords.
export const WATCHED_KEYWORDS: Keyword[] = [
  { term: "Agentic", caseSensitive: false },
  { term: "Harness", caseSensitive: false },
];

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

const HAS_CJK = /[\u3400-\u9fff]/;

// Exact/substring relevance: fraction of (up to 3) distinct keyword hits.
// ASCII terms match on word boundaries (so "AI" ≠ "detail"); CJK terms match by
// substring (CJK characters aren't \w, so \b word boundaries never fire).
export function exactRelevance(title: string, text: string, list: Keyword[]): number {
  const haystack = `${title} ${text}`;
  let hits = 0;
  for (const k of list) {
    if (HAS_CJK.test(k.term)) {
      if (haystack.includes(k.term)) hits++;
      continue;
    }
    const flags = k.caseSensitive ? "" : "i";
    const re = new RegExp(`\\b${escapeRegex(k.term)}\\b`, flags);
    if (re.test(haystack)) hits++;
  }
  return Math.min(1, hits / 3);
}

// Back-compat convenience: exact relevance against the built-in seed (no DB).
// The live pipeline uses the DB-backed hybrid scorer in scoring/relevance.ts.
export function computeRelevance(title: string, text: string): number {
  return exactRelevance(title, text, WATCHED_KEYWORDS);
}
