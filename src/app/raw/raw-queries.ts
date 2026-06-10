import { sql } from "drizzle-orm";
import { relativeTime, sourceLabel } from "../format.js";
import { hostOf } from "../feed-item-data.js";
import type { TriageDecision } from "../../types.js";

type Db = any;

// raw_items only ever holds the LLM-pipeline platforms; RSS keeps its own table
// and never enters raw_items, so it's intentionally absent from the tabs.
const RAW_SOURCES = ["hn", "reddit", "twitter"] as const;
export type RawSource = "all" | (typeof RAW_SOURCES)[number];

export function normalizeRawSource(source: string | null | undefined): RawSource {
  return source === "hn" || source === "reddit" || source === "twitter" ? source : "all";
}

// Triage-outcome filter: accepted = entered the feed, dropped = triaged but
// rejected by the quality gate, pending = not yet triaged.
export type RawState = "all" | "accepted" | "dropped" | "pending";

export function normalizeRawState(state: string | null | undefined): RawState {
  return state === "accepted" || state === "dropped" || state === "pending" ? state : "all";
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
  /** triage 后写入了 items（进入 feed 流）。processed && !accepted ⇒ 被过滤。 */
  accepted: boolean;
  /** triage 决策详情；该列上线前处理的旧行为 null。 */
  triage: TriageDecision | null;
}

export interface RawFeedPage {
  items: RawFeedItem[];
  total: number;
  /** 当前过滤条件下已收录进 feed 流（items 表）的总数。 */
  accepted: number;
  page: number;
  totalPages: number;
}

// The de-duped raw corpus exactly as ingested (payload jsonb), newest-collected
// first. Mirrors the home feed's paging contract but skips scoring/ranking —
// raw_items has no scores, so rows render verbatim. `count(*) OVER()` returns the
// full filtered total alongside the page so the header + paging stay accurate.
export async function getRawFeed(
  db: Db,
  opts: { page?: number; pageSize?: number; source?: string; state?: string },
): Promise<RawFeedPage> {
  const source = normalizeRawSource(opts.source);
  const state = normalizeRawState(opts.state);
  const pageSize = Math.max(1, opts.pageSize ?? 30);
  const page = Math.max(1, Math.floor(opts.page ?? 1) || 1);
  const offset = (page - 1) * pageSize;
  let filter = source === "all"
    ? sql`r.payload->>'source' IN ('hn', 'reddit', 'twitter')`
    : sql`r.payload->>'source' = ${source}`;
  if (state === "accepted") filter = sql`${filter} AND i.id IS NOT NULL`;
  else if (state === "dropped") filter = sql`${filter} AND r.processed_at IS NOT NULL AND i.id IS NULL`;
  else if (state === "pending") filter = sql`${filter} AND r.processed_at IS NULL`;

  // LEFT JOIN items: a raw row is "accepted" iff triage inserted an items row
  // for it (raw_item_id back-reference; at most one per raw item). NOTE: a
  // content_hash dedupe skip also shows as "filtered" here even though the
  // same content entered the feed via another raw row. count(i.id) OVER()
  // counts only matched joins = accepted total for the current filter.
  const res = await db.execute(sql`
    SELECT r.id,
           r.payload->>'source'    AS source,
           r.payload->>'title'     AS title,
           r.payload->>'text'      AS text,
           r.payload->>'url'       AS url,
           r.payload->>'author'    AS author,
           r.payload->>'feed'      AS feed,
           r.payload->>'createdAt' AS "createdAt",
           (r.processed_at IS NOT NULL) AS processed,
           (i.id IS NOT NULL) AS accepted,
           r.triage AS triage,
           count(*) OVER() AS "totalCount",
           count(i.id) OVER() AS "acceptedCount"
    FROM raw_items r
    LEFT JOIN items i ON i.raw_item_id = r.id
    WHERE ${filter}
    ORDER BY r.fetched_at DESC, r.id DESC
    LIMIT ${pageSize} OFFSET ${offset}
  `);
  const rows = (res.rows ?? res) as Array<Record<string, unknown>>;
  const total = rows.length > 0 ? Number(rows[0]!.totalCount ?? 0) : 0;
  const accepted = rows.length > 0 ? Number(rows[0]!.acceptedCount ?? 0) : 0;
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
      accepted: Boolean(r.accepted),
      triage: (r.triage as TriageDecision | null) ?? null,
    };
  });

  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  return { items, total, accepted, page: Math.min(page, totalPages), totalPages };
}
