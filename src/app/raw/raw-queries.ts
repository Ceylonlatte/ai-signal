import { sql } from "drizzle-orm";
import { relativeTime, sourceLabel } from "../format.js";
import { hostOf } from "../feed-item-data.js";

type Db = any;

// raw_items only ever holds the LLM-pipeline platforms; RSS keeps its own table
// and never enters raw_items, so it's intentionally absent from the tabs.
const RAW_SOURCES = ["hn", "reddit", "twitter"] as const;
export type RawSource = "all" | (typeof RAW_SOURCES)[number];

export function normalizeRawSource(source: string | null | undefined): RawSource {
  return source === "hn" || source === "reddit" || source === "twitter" ? source : "all";
}

const TEXT_MAX = 280;
function clamp(text: string): string {
  const t = (text ?? "").trim();
  return t.length > TEXT_MAX ? `${t.slice(0, TEXT_MAX)}…` : t;
}

export interface RawFeedItem {
  id: number;
  source: string;
  sourceLabel: string;
  url: string | null;
  host: string;
  title: string;
  text: string;
  author: string | null;
  feed: string | null;
  timeText: string;
  processed: boolean;
}

export interface RawFeedPage {
  items: RawFeedItem[];
  total: number;
  page: number;
  totalPages: number;
}

// The de-duped raw corpus exactly as ingested (payload jsonb), newest-collected
// first. Mirrors the home feed's paging contract but skips scoring/ranking —
// raw_items has no scores, so rows render verbatim. `count(*) OVER()` returns the
// full filtered total alongside the page so the header + paging stay accurate.
export async function getRawFeed(
  db: Db,
  opts: { page?: number; pageSize?: number; source?: string },
): Promise<RawFeedPage> {
  const source = normalizeRawSource(opts.source);
  const pageSize = Math.max(1, opts.pageSize ?? 30);
  const page = Math.max(1, Math.floor(opts.page ?? 1) || 1);
  const offset = (page - 1) * pageSize;
  const filter = source === "all"
    ? sql`payload->>'source' IN ('hn', 'reddit', 'twitter')`
    : sql`payload->>'source' = ${source}`;

  const res = await db.execute(sql`
    SELECT id,
           payload->>'source'    AS source,
           payload->>'title'     AS title,
           payload->>'text'      AS text,
           payload->>'url'       AS url,
           payload->>'author'    AS author,
           payload->>'feed'      AS feed,
           payload->>'createdAt' AS "createdAt",
           (processed_at IS NOT NULL) AS processed,
           count(*) OVER() AS "totalCount"
    FROM raw_items
    WHERE ${filter}
    ORDER BY fetched_at DESC, id DESC
    LIMIT ${pageSize} OFFSET ${offset}
  `);
  const rows = (res.rows ?? res) as Array<Record<string, unknown>>;
  const total = rows.length > 0 ? Number(rows[0]!.totalCount ?? 0) : 0;
  const now = new Date();

  const items: RawFeedItem[] = rows.map((r) => {
    const url = (r.url as string | null) || null;
    const createdAt = r.createdAt as string | null;
    return {
      id: Number(r.id),
      source: String(r.source ?? ""),
      sourceLabel: sourceLabel(String(r.source ?? "")),
      url,
      host: hostOf(url),
      title: (r.title as string) || "(无标题)",
      text: clamp((r.text as string) ?? ""),
      author: (r.author as string | null) || null,
      feed: (r.feed as string | null) || null,
      timeText: createdAt ? relativeTime(createdAt, now) : "",
      processed: Boolean(r.processed),
    };
  });

  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  return { items, total, page: Math.min(page, totalPages), totalPages };
}
