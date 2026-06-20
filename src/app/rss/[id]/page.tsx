import { db } from "../../../db/client.js";
import { getRssEntry } from "../rss-queries.js";
import { rssFeedLabel } from "../../../lib/sources/rss-feeds.js";
import { relativeTime } from "../../format.js";
import { hostOf } from "../../feed-item-data.js";
import { TranslatedBlock } from "../../kb-markdown.js";

export const dynamic = "force-dynamic";

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="kb-note__sec">
      <h3 className="kb-note__h">{title}</h3>
      {children}
    </section>
  );
}

export default async function RssDetail({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const numId = Number(id);
  const entry = Number.isInteger(numId) ? await getRssEntry(db, numId) : null;
  const now = new Date();

  if (!entry) {
    return (
      <main className="page">
        <div className="placeholder">
          <p className="placeholder__title">条目不存在</p>
          <p className="placeholder__body"><a href="/?source=rss">← 返回 RSS</a></p>
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
  const hasNote = entry.kbStatus === "ready" && (note.overview || (note.keypoints?.length ?? 0) > 0);

  return (
    <main className="page kb-detail">
      <p className="kb-detail__back"><a href="/?source=rss">← RSS</a></p>

      <div className="kb-detail__head">
        <h1 className="kb-detail__title">{title}</h1>
        <div className="item__meta">
          <span className="item__source">{rssFeedLabel(entry.feedUrl)}</span>
          {entry.author && (
            <><span className="meta-dot">·</span><span>{entry.author}</span></>
          )}
          {entry.publishedAt && (
            <><span className="meta-dot">·</span><span>{relativeTime(entry.publishedAt, now)}</span></>
          )}
          {entry.url && (
            <><span className="meta-dot">·</span>
            <a href={entry.url} target="_blank" rel="noreferrer">原文{host ? `（${host}）` : ""} ↗</a></>
          )}
        </div>
      </div>

      {entry.kbStatus === "pending" || entry.kbStatus === null ? (
        <div className="notice" role="status">正在整理这篇内容，稍后刷新查看。</div>
      ) : entry.kbStatus === "failed" ? (
        <div className="notice" role="status">整理失败，仅展示原文摘要。</div>
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

      {entry.bodyMd ? (
        <div className="kb-body">
          <h2 className="kb-body__h">全文</h2>
          <TranslatedBlock zh={entry.bodyZhMd} original={entry.bodyMd} />
        </div>
      ) : entry.summary ? (
        <div className="kb-body">
          <h2 className="kb-body__h">摘要</h2>
          <p className="item__summary">{entry.summaryZh || entry.summary}</p>
        </div>
      ) : null}
    </main>
  );
}
