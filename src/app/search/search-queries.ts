import { sql } from "drizzle-orm";
import { embedTexts } from "../../lib/embeddings.js";

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
  const [vec] = await embedTexts([q]);
  if (!vec) return [];
  const res = await db.execute(sql`
    SELECT i.id, i.title, i.url, i.source, i.created_at AS "createdAt",
           e.embedding <=> ${JSON.stringify(vec)}::vector AS dist
    FROM item_embeddings e JOIN items i ON i.id = e.item_id
    ORDER BY dist ASC LIMIT 50
  `);
  return (res.rows ?? res) as any[];
}
