import { eq } from "drizzle-orm";
import { keywords as keywordsTable } from "../../db/schema.js";
import { config } from "../../config.js";
import { embedTexts } from "../embeddings.js";
import { WATCHED_KEYWORDS } from "../keywords.js";
import type { LoadedKeyword } from "./relevance.js";

type Db = any;

// The worker loop calls loadKeywords() every batch; a short TTL avoids a DB hit
// per batch. Edits made via the /keywords UI (a separate process) become visible
// to the worker within TTL_MS.
const TTL_MS = 60_000;
let cache: { at: number; items: LoadedKeyword[] } | null = null;

export function clearKeywordCache(): void { cache = null; }

const seedFallback = (): LoadedKeyword[] =>
  WATCHED_KEYWORDS.map((k) => ({ ...k, embedding: null }));

// pgvector columns may deserialize as number[] or a "[...]" string depending on
// the driver path; coerce defensively.
function toVec(v: unknown): number[] | null {
  if (!v) return null;
  if (Array.isArray(v)) return v as number[];
  if (typeof v === "string") {
    try { const a = JSON.parse(v); return Array.isArray(a) ? a : null; } catch { return null; }
  }
  return null;
}

export async function loadKeywords(db: Db): Promise<LoadedKeyword[]> {
  if (cache && Date.now() - cache.at < TTL_MS) return cache.items;

  let rows: any[];
  try {
    rows = await db.select().from(keywordsTable).where(eq(keywordsTable.enabled, true));
  } catch {
    // Table missing / DB unavailable → exact-only matching on the built-in seed.
    return seedFallback();
  }
  if (rows.length === 0) {
    cache = { at: Date.now(), items: seedFallback() };
    return cache.items;
  }

  // Lazy, best-effort backfill: embed any enabled keyword that lacks a vector
  // (e.g. migration-seeded rows) so semantic matching activates without a script.
  const missing = rows.filter((r) => !toVec(r.embedding));
  if (missing.length > 0 && config.OPENROUTER_API_KEY) {
    try {
      const vecs = await embedTexts(missing.map((r) => r.term));
      for (let i = 0; i < missing.length; i++) {
        const v = vecs[i];
        if (!v) continue;
        missing[i].embedding = v;
        await db.update(keywordsTable).set({ embedding: v }).where(eq(keywordsTable.id, missing[i].id));
      }
    } catch { /* keep exact-only for these until a later pass */ }
  }

  const items: LoadedKeyword[] = rows.map((r) => ({
    term: r.term,
    caseSensitive: !!r.caseSensitive,
    embedding: toVec(r.embedding),
  }));
  cache = { at: Date.now(), items };
  return items;
}
