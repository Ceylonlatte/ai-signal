import { sql } from "drizzle-orm";
import { embedTexts } from "../../lib/embeddings.js";
import { config } from "../../config.js";

type Db = any;

export async function keywordSearch(db: Db, q: string) {
  const res = await db.execute(sql`
    SELECT id, title, url, source, created_at AS "createdAt"
    FROM items
    WHERE to_tsvector('english', coalesce(title,'') || ' ' || coalesce(text,''))
          @@ plainto_tsquery('english', ${q})
    ORDER BY created_at DESC LIMIT 50
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
  const res = await db.execute(sql`
    SELECT i.id, i.title, i.url, i.source, i.created_at AS "createdAt",
           e.embedding <=> ${vecJson}::vector AS dist
    FROM item_embeddings e JOIN items i ON i.id = e.item_id
    WHERE e.embedding <=> ${vecJson}::vector < ${maxDist}
    ORDER BY dist ASC LIMIT 50
  `);
  return (res.rows ?? res) as any[];
}
