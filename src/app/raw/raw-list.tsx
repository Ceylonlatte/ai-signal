"use client";

import { useEffect, useRef, useState } from "react";
import type { RawFeedItem, RawSource, RawState } from "./raw-queries.js";
import { loadRawPage } from "./raw-actions.js";

export type { RawFeedItem } from "./raw-queries.js";

export function RawList({
  initialItems,
  total: initialTotal,
  totalPages: initialTotalPages,
  source,
  state,
}: {
  initialItems: RawFeedItem[];
  total: number;
  totalPages: number;
  source: RawSource;
  state: RawState;
}) {
  const [items, setItems] = useState<RawFeedItem[]>(initialItems);
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(initialTotal);
  const [totalPages, setTotalPages] = useState(initialTotalPages);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(false);

  const hasMore = page < totalPages;

  async function loadMore() {
    if (loading || page >= totalPages) return;
    setLoading(true);
    setError(false);
    try {
      const res = await loadRawPage(page + 1, source, state);
      setItems((prev) => {
        const seen = new Set(prev.map((it) => it.id));
        return [...prev, ...res.items.filter((it) => !seen.has(it.id))];
      });
      setPage(res.page);
      setTotal(res.total);
      setTotalPages(res.totalPages);
    } catch {
      setError(true);
    } finally {
      setLoading(false);
    }
  }

  // Keep the observer stable while always calling the latest closure.
  const loadMoreRef = useRef(loadMore);
  loadMoreRef.current = loadMore;
  const sentinelRef = useRef<HTMLDivElement | null>(null);
  const listRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const el = sentinelRef.current;
    if (!el) return;
    const io = new IntersectionObserver(
      (entries) => {
        if (entries[0]?.isIntersecting) loadMoreRef.current();
      },
      { rootMargin: "600px 0px" },
    );
    io.observe(el);
    return () => io.disconnect();
  }, []);

  // Scroll-reveal mirrors the home feed: items stay hidden by CSS until they
  // enter view, then rise + sharpen. Re-runs on append to pick up new rows;
  // reduced-motion or a missing observer flips to the at-rest visible state.
  useEffect(() => {
    const root = listRef.current;
    if (!root) return;
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (reduce || typeof IntersectionObserver === "undefined") {
      root.dataset.animate = "off";
      return;
    }
    const io = new IntersectionObserver(
      (entries) => {
        let i = 0;
        for (const entry of entries) {
          if (!entry.isIntersecting) continue;
          const el = entry.target as HTMLElement;
          el.style.setProperty("--i", String(i++));
          el.classList.add("is-in");
          io.unobserve(el);
        }
      },
      { rootMargin: "0px 0px -8% 0px", threshold: 0.05 },
    );
    root.querySelectorAll<HTMLElement>(".item:not(.is-in)").forEach((el) => io.observe(el));
    return () => io.disconnect();
  }, [items]);

  return (
    <>
      <div className="feed" role="list" ref={listRef}>
        {items.map((it) => (
          <RawItem key={it.id} data={it} />
        ))}
      </div>

      <div className="feed-foot">
        <p className="feed-status" aria-live="polite">
          已加载 {items.length} / 共 {total} 条
        </p>

        {hasMore ? (
          <>
            {error && (
              <p className="feed-error" role="alert">
                加载失败，
                <button type="button" className="linkish" onClick={() => loadMore()}>
                  重试
                </button>
              </p>
            )}
            <button type="button" className="feed-more" onClick={() => loadMore()} disabled={loading}>
              {loading ? "加载中…" : "加载更多"}
            </button>
            {loading && (
              <div className="feed-loading" aria-hidden="true">
                {[0, 1].map((i) => (
                  <div key={i} className="skeleton-item">
                    <div className="skeleton-line" style={{ width: "70%" }} />
                    <div className="skeleton-line" style={{ width: "92%", marginTop: 10 }} />
                  </div>
                ))}
              </div>
            )}
            <div ref={sentinelRef} className="feed-sentinel" aria-hidden="true" />
          </>
        ) : (
          items.length > 0 && <p className="feed-end">没有更多了</p>
        )}
      </div>
    </>
  );
}

function RawItem({ data }: { data: RawFeedItem }) {
  return (
    <article className="item" role="listitem">
      <div className="item__top">
        <a className="item__title" href={data.url ?? "#"} target="_blank" rel="noreferrer">
          {data.title}
          {data.host && <span className="item__ext">{data.host} ↗</span>}
        </a>
      </div>

      {data.text && <p className="item__summary">{data.text}</p>}

      <div className="item__meta">
        <span className="item__source">{data.sourceLabel}</span>
        {data.feed && (
          <>
            <span className="meta-dot">·</span>
            <span>{data.feed}</span>
          </>
        )}
        {data.author && (
          <>
            <span className="meta-dot">·</span>
            <span className="item__author">@{data.author}</span>
          </>
        )}
        {data.timeText && (
          <>
            <span className="meta-dot">·</span>
            <span>{data.timeText}</span>
          </>
        )}
        <span className="tags">
          {!data.processed ? (
            <span className="tag tag--pending">待处理</span>
          ) : data.accepted ? (
            <span className="tag tag--accepted">{data.triage?.rescued ? "已收录 · 救回" : "已收录"}</span>
          ) : (
            <span className="tag tag--dropped">已过滤</span>
          )}
        </span>
      </div>

      {data.processed && data.triage && (
        <p className="item__triage">
          Q {data.triage.q.toFixed(2)} / 门槛 {data.triage.gate.toFixed(2)}
          <span className="meta-dot"> · </span>LLM {data.triage.llmValue.toFixed(2)}
          <span className="meta-dot"> · </span>相关 {data.triage.relevance.toFixed(2)}
          <span className="meta-dot"> · </span>信任 {data.triage.trust.toFixed(2)}
          {data.triage.reason && (
            <>
              <span className="meta-dot"> · </span>
              {data.triage.reason}
            </>
          )}
        </p>
      )}
    </article>
  );
}
