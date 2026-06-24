import { sql } from "drizzle-orm";
import Link from "next/link";
import { db } from "../../../db/client.js";
import { sourceLabel, relativeTime } from "../../format.js";
import { hostOf } from "../../feed-item-data.js";
import { FavoriteButton } from "../../favorite-button.js";
import { Markdown } from "../../kb-markdown.js";
import { CommentList, parseComments, countComments } from "../../comments.js";
import { BilingualBody, BilingualDiscussion } from "../../bilingual-reader.js";
import { BackLink } from "../../back-link.js";

export const dynamic = "force-dynamic";

interface DetailRow {
  id: number; title: string; titleZh: string; url: string | null; source: string;
  author: string | null; createdAt: string; isFavorited: boolean;
  summaryZh: string | null; summaryEn: string | null;
  status: string | null; note: any; bodyMd: string | null; bodySource: string | null;
  bodyZhMd: string | null; commentsMd: string | null; commentsZhMd: string | null;
}

async function getEntry(id: number): Promise<DetailRow | null> {
  const res = await db.execute(sql`
    SELECT i.id::int AS id, i.title, s.title_zh AS "titleZh", i.url, i.source, i.author AS "author",
           i.created_at AS "createdAt", i.is_favorited AS "isFavorited",
           s.summary_zh AS "summaryZh", s.summary_en AS "summaryEn",
           k.status AS "status", k.note AS "note", k.body_md AS "bodyMd", k.body_source AS "bodySource",
           k.body_zh_md AS "bodyZhMd", k.comments_md AS "commentsMd", k.comments_zh_md AS "commentsZhMd"
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

export default async function LibraryDetail({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ from?: string }>;
}) {
  const { id } = await params;
  const { from } = await searchParams;
  const numId = Number(id);
  const entry = Number.isInteger(numId) ? await getEntry(numId) : null;
  const now = new Date();

  if (!entry) {
    return (
      <main className="page">
        <div className="placeholder">
          <p className="placeholder__title">条目不存在</p>
          <p className="placeholder__body"><Link href="/library">← 返回收藏</Link></p>
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
  // 概述优先用 KB 笔记的 overview；笔记被跳过（如推文等短内容）时回退到双语摘要的中文，
  // 这样详情页始终有一段概述，不会出现"没有总结概要"的空白。
  const overviewText = (note.overview || entry.summaryZh || "").trim();
  const summaryEn = (entry.summaryEn ?? "").trim();
  const hasStructured = entry.status === "ready" && (
    (note.keypoints?.length ?? 0) > 0 ||
    (note.facts?.length ?? 0) > 0 ||
    Boolean(note.why) ||
    (note.terms?.length ?? 0) > 0
  );

  const hasBodyZh = Boolean(entry.bodyZhMd?.trim());
  const hasCommentsZh = Boolean(entry.commentsZhMd?.trim());
  const zhComments = parseComments(entry.commentsZhMd);
  const enComments = parseComments(entry.commentsMd);

  return (
    <main className="page kb-detail">
      <p className="kb-detail__back"><BackLink from={from} /></p>

      <div className="kb-detail__head">
        <div className="kb-detail__headmain">
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
          </div>
        </div>
        <FavoriteButton itemId={entry.id} initial={entry.isFavorited} variant="action" />
      </div>

      {entry.status === "pending" || entry.status === null ? (
        <div className="notice" role="status">正在整理这篇内容，稍后刷新查看。</div>
      ) : entry.status === "failed" ? (
        <div className="notice" role="status">整理失败。可取消 ⭐ 再重新收藏以重试。</div>
      ) : null}

      {(overviewText || hasStructured) && (
        <div className="kb-note-shell">
          <div className="kb-note">
            {overviewText && (
              <Section title="概述">
                <p>{overviewText}</p>
                {!note.overview && summaryEn && <p className="kb-note__en">{summaryEn}</p>}
              </Section>
            )}
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
        </div>
      )}

      {entry.bodyMd && (
        <BilingualBody
          hasZh={hasBodyZh}
          zh={<div className="markdown"><Markdown>{entry.bodyZhMd ?? ""}</Markdown></div>}
          original={<div className="markdown"><Markdown>{entry.bodyMd}</Markdown></div>}
        />
      )}

      {entry.commentsMd && (
        <BilingualDiscussion
          count={countComments(hasCommentsZh ? zhComments : enComments)}
          hasZh={hasCommentsZh}
          zh={<CommentList nodes={hasCommentsZh ? zhComments : enComments} />}
          original={<CommentList nodes={enComments} />}
        />
      )}
    </main>
  );
}
