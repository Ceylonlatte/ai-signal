import { sql } from "drizzle-orm";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { db } from "../../../db/client.js";
import { sourceLabel, relativeTime } from "../../format.js";
import { hostOf } from "../../feed-item-data.js";
import { FavoriteButton } from "../../favorite-button.js";

export const dynamic = "force-dynamic";

interface DetailRow {
  id: number; title: string; titleZh: string; url: string | null; source: string;
  author: string | null; createdAt: string; isFavorited: boolean;
  status: string | null; note: any; bodyMd: string | null; bodySource: string | null;
}

async function getEntry(id: number): Promise<DetailRow | null> {
  const res = await db.execute(sql`
    SELECT i.id::int AS id, i.title, s.title_zh AS "titleZh", i.url, i.source, i.author AS "author",
           i.created_at AS "createdAt", i.is_favorited AS "isFavorited",
           k.status AS "status", k.note AS "note", k.body_md AS "bodyMd", k.body_source AS "bodySource"
    FROM items i
    LEFT JOIN scores s ON s.item_id = i.id
    LEFT JOIN kb_entries k ON k.item_id = i.id
    WHERE i.id = ${id}
    LIMIT 1
  `);
  const rows = (res.rows ?? res) as unknown as DetailRow[];
  return rows[0] ?? null;
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="kb-note__sec">
      <h3 className="kb-note__h">{title}</h3>
      {children}
    </section>
  );
}

export default async function LibraryDetail({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const entry = await getEntry(Number(id));
  const now = new Date();

  if (!entry) {
    return (
      <main className="page">
        <div className="placeholder">
          <p className="placeholder__title">条目不存在</p>
          <p className="placeholder__body"><a href="/library">← 返回收藏</a></p>
        </div>
      </main>
    );
  }

  const title = entry.titleZh || entry.title || "(无标题)";
  const host = hostOf(entry.url ?? null);
  const note = (entry.note ?? {}) as {
    overview?: string; keypoints?: string[]; facts?: string[]; why?: string;
    terms?: { term: string; def: string }[];
  };
  const hasNote = entry.status === "ready" && (note.overview || (note.keypoints?.length ?? 0) > 0);

  return (
    <main className="page kb-detail">
      <p className="kb-detail__back"><a href="/library">← 收藏</a></p>

      <div className="kb-detail__head">
        <h1 className="kb-detail__title">{title}</h1>
        <div className="item__meta">
          <span className="item__source">{sourceLabel(entry.source)}</span>
          {entry.author && entry.source === "twitter" && (
            <><span className="meta-dot">·</span><span>@{entry.author}</span></>
          )}
          {entry.createdAt && (
            <><span className="meta-dot">·</span><span>{relativeTime(entry.createdAt, now)}</span></>
          )}
          {entry.url && (
            <><span className="meta-dot">·</span>
            <a href={entry.url} target="_blank" rel="noreferrer">原文{host ? `（${host}）` : ""} ↗</a></>
          )}
          <FavoriteButton itemId={entry.id} initial={entry.isFavorited} />
        </div>
      </div>

      {entry.status === "pending" || entry.status === null ? (
        <div className="notice" role="status">正在整理这篇内容，稍后刷新查看。</div>
      ) : entry.status === "failed" ? (
        <div className="notice" role="status">整理失败。可取消 ⭐ 再重新收藏以重试。</div>
      ) : null}

      {hasNote && (
        <div className="kb-note">
          {note.overview && <Section title="概述"><p>{note.overview}</p></Section>}
          {note.keypoints && note.keypoints.length > 0 && (
            <Section title="核心要点">
              <ul>{note.keypoints.map((k, i) => <li key={i}>{k}</li>)}</ul>
            </Section>
          )}
          {note.facts && note.facts.length > 0 && (
            <Section title="关键数据 · 结论">
              <ul>{note.facts.map((f, i) => <li key={i}>{f}</li>)}</ul>
            </Section>
          )}
          {note.why && <Section title="为什么值得记"><p>{note.why}</p></Section>}
          {note.terms && note.terms.length > 0 && (
            <Section title="术语">
              <ul>{note.terms.map((t, i) => <li key={i}><strong>{t.term}</strong>：{t.def}</li>)}</ul>
            </Section>
          )}
        </div>
      )}

      {entry.bodyMd && (
        <div className="kb-body">
          <h2 className="kb-body__h">全文</h2>
          <div className="markdown">
            <ReactMarkdown remarkPlugins={[remarkGfm]}>{entry.bodyMd}</ReactMarkdown>
          </div>
        </div>
      )}
    </main>
  );
}
