import { sql } from "drizzle-orm";
import { embedTexts } from "../../lib/embeddings.js";
import { config } from "../../config.js";

type Db = any;

export async function keywordSearch(db: Db, q: string) {
  // Postgres's default FTS parser doesn't segment space-less scripts: a whole run
  // of CJK like "微信小程序可以被微信" becomes one lexeme, so a query token like
  // "小程序" never matches. Pair the tsvector match (English word/stemming
  // precision) with a case-insensitive substring (ILIKE) match that catches CJK
  // and literal substrings. Escape LIKE metacharacters in the user's query.
  //
  // Searches raw_items (the full pre-triage corpus) rather than items, so
  // filtered-out rows surface too — `accepted` marks whether triage kept the
  // row (an items row references it), letting the UI separate kept vs dropped.
  const like = `%${q.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
  const res = await db.execute(sql`
    SELECT r.id,
           r.payload->>'title'     AS title,
           r.payload->>'url'       AS url,
           r.payload->>'source'    AS source,
           r.payload->>'createdAt' AS "createdAt",
           (r.processed_at IS NOT NULL) AS processed,
           (i.id IS NOT NULL) AS accepted
    FROM raw_items r
    LEFT JOIN items i ON i.raw_item_id = r.id
    WHERE to_tsvector('english', coalesce(r.payload->>'title','') || ' ' || coalesce(r.payload->>'text',''))
          @@ plainto_tsquery('english', ${q})
       OR (coalesce(r.payload->>'title','') || ' ' || coalesce(r.payload->>'text','')) ILIKE ${like}
    ORDER BY r.fetched_at DESC, r.id DESC LIMIT 50
  `);
  return (res.rows ?? res) as any[];
}

export async function semanticSearch(db: Db, q: string) {
  const [vec] = await embedTexts([q], { query: true });
  if (!vec) return [];
  // Cosine sim must clear RELEVANCE_SIM_THRESHOLD, i.e. distance (1 - sim) must
  // stay below 1 - threshold. Without this the nearest 50 always come back, so
  // a query with no real matches still returns 50 unrelated rows.
  const maxDist = 1 - config.RELEVANCE_SIM_THRESHOLD;
  const vecJson = JSON.stringify(vec);
  // Only accepted items have stored embeddings (triage embeds dropped rows but
  // never persists their vectors), so semantic search can't cover the filtered
  // corpus — every hit is accepted by construction.
  const res = await db.execute(sql`
    SELECT i.id, i.title, i.url, i.source, i.created_at AS "createdAt",
           TRUE AS processed, TRUE AS accepted,
           e.embedding <=> ${vecJson}::vector AS dist
    FROM item_embeddings e JOIN items i ON i.id = e.item_id
    WHERE e.embedding <=> ${vecJson}::vector < ${maxDist}
    ORDER BY dist ASC LIMIT 50
  `);
  return (res.rows ?? res) as any[];
}
