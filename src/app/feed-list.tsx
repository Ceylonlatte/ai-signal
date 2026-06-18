"use client";

import { useEffect, useRef, useState, type CSSProperties } from "react";
import { strengthLabel, type Strength } from "./format.js";
import type { FeedItemData } from "./feed-item-data.js";
import type { FeedSort, FeedSource } from "./feed-queries.js";
import { loadFeedPage } from "./feed-actions.js";
import { FavoriteButton } from "./favorite-button.js";

export type { FeedItemData } from "./feed-item-data.js";

type Signal = "up" | "down";
interface VoteState {
  signal: Signal | null;
  pending: boolean;
  error: boolean;
}

async function mutateFeedback(itemId: number, signal: Signal, method: "POST" | "DELETE") {
  const res = await fetch("/api/feedback", {
    method,
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ itemId, signal }),
  });
  if (!res.ok) throw new Error(`feedback ${method} failed: ${res.status}`);
}

// Seed each item's persisted signal so up/down votes render consistently across
// every list on load (the server is the source of truth). Without this, votes
// start blank and re-clicking an already-voted item POSTs a duplicate feedback row.
function seedVotes(items: FeedItemData[]): Record<number, VoteState> {
  const m: Record<number, VoteState> = {};
  for (const it of items) m[it.id] = { signal: it.signal, pending: false, error: false };
  return m;
}

export function FeedList({
  initialItems,
  total: initialTotal,
  totalPages: initialTotalPages,
  sort,
  source,
}: {
  initialItems: FeedItemData[];
  total: number;
  totalPages: number;
  sort: FeedSort;
  source: FeedSource;
}) {
  const [items, setItems] = useState<FeedItemData[]>(initialItems);
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(initialTotal);
  const [totalPages, setTotalPages] = useState(initialTotalPages);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(false);
  const [votes, setVotes] = useState<Record<number, VoteState>>(() => seedVotes(initialItems));

  const hasMore = page < totalPages;

  async function loadMore() {
    if (loading || page >= totalPages) return;
    setLoading(true);
    setError(false);
    try {
      const res = await loadFeedPage(page + 1, sort, source);
      setItems((prev) => {
        const seen = new Set(prev.map((it) => it.id));
        return [...prev, ...res.items.filter((it) => !seen.has(it.id))];
      });
      // Seed persisted signals for the newly appended rows, but never clobber a
      // vote the user already changed this session.
      setVotes((prev) => {
        const next = { ...prev };
        for (const it of res.items) {
          if (!(it.id in next)) next[it.id] = { signal: it.signal, pending: false, error: false };
        }
        return next;
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

  // Scroll-reveal: items are hidden by CSS until they enter view, then
  // rise + sharpen. --i is each item's position within its observer batch,
  // so the first screen staggers while a lone scrolled-in item reveals at
  // once. Re-runs on append to pick up newly loaded rows; reduced-motion
  // or a missing observer flips the list to its at-rest visible state.
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

  async function vote(id: number, signal: Signal) {
    const prev = votes[id]?.signal ?? null;
    const next: Signal | null = prev === signal ? null : signal;
    setVotes((m) => ({ ...m, [id]: { signal: next, pending: true, error: false } }));
    try {
      if (prev && prev !== next) await mutateFeedback(id, prev, "DELETE");
      if (next) await mutateFeedback(id, next, "POST");
      setVotes((m) => ({ ...m, [id]: { signal: next, pending: false, error: false } }));
    } catch {
      setVotes((m) => ({ ...m, [id]: { signal: prev, pending: false, error: true } }));
    }
  }

  return (
    <>
      <div className="feed" role="list" ref={listRef}>
        {items.map((it) => (
          <FeedItem key={it.id} data={it} vote={votes[it.id]} onVote={(s) => vote(it.id, s)} />
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

function ThumbIcon({ dir }: { dir: Signal }) {
  return (
    <svg
      className="vote__icon"
      width="15"
      height="15"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {dir === "up" ? (
        <>
          <path d="M7 10v12" />
          <path d="M15 5.88 14 10h5.83a2 2 0 0 1 1.92 2.56l-2.33 8A2 2 0 0 1 17.5 22H4a2 2 0 0 1-2-2v-8a2 2 0 0 1 2-2h2.76a2 2 0 0 0 1.79-1.11L12 2a3.13 3.13 0 0 1 3 3.88Z" />
        </>
      ) : (
        <>
          <path d="M17 14V2" />
          <path d="M9 18.12 10 14H4.17a2 2 0 0 1-1.92-2.56l2.33-8A2 2 0 0 1 6.5 2H20a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2h-2.76a2 2 0 0 0-1.79 1.11L12 22a3.13 3.13 0 0 1-3-3.88Z" />
        </>
      )}
    </svg>
  );
}

function SignalBadge({
  strength,
  score,
  rText,
}: {
  strength: Strength;
  score: number;
  rText: string;
}) {
  return (
    <span
      className="signal"
      data-strength={strength}
      title={`信号强度：${strengthLabel(strength)} · 信号分 ${score} · R ${rText}`}
      aria-label={`信号强度 ${strengthLabel(strength)}，信号分 ${score}`}
    >
      <svg className="signal__ring" width="46" height="46" viewBox="0 0 46 46" aria-hidden="true">
        <circle className="signal__track" cx="23" cy="23" r="17" fill="none" strokeWidth="4" />
        <circle
          className="signal__fill"
          cx="23"
          cy="23"
          r="17"
          fill="none"
          strokeWidth="4"
          strokeLinecap="round"
          pathLength={100}
          transform="rotate(-90 23 23)"
          style={{ "--score": score, strokeDasharray: `${score} 100` } as CSSProperties}
        />
        <text className="signal__num" x="23" y="24" textAnchor="middle" dominantBaseline="middle">
          {score}
        </text>
      </svg>
    </span>
  );
}

function FeedItem({
  data,
  vote,
  onVote,
}: {
  data: FeedItemData;
  vote?: VoteState;
  onVote: (signal: Signal) => void;
}) {
  const [showEn, setShowEn] = useState(false);
  const active = vote?.signal ?? null;

  return (
    <article className="item" role="listitem" data-strength={data.strength}>
      <div className="item__top">
        <SignalBadge strength={data.strength} score={data.score} rText={data.rText} />
        <a className="item__title" href={data.url ?? "#"} target="_blank" rel="noreferrer">
          {data.title}
          {data.host && <span className="item__ext">{data.host} ↗</span>}
        </a>
      </div>

      {data.reason && <p className="item__reason">{data.reason}</p>}
      {data.summaryZh && <p className="item__summary">{data.summaryZh}</p>}
      {data.summaryEn && (
        <div className="item__en" data-open={showEn} aria-hidden={!showEn}>
          <div className="item__en-inner">
            <p className="item__summary-en">{data.summaryEn}</p>
          </div>
        </div>
      )}

      <div className="item__meta">
        <span className="item__source">{data.sourceLabel}</span>
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
        {data.tags.length > 0 && (
          <span className="tags">
            {data.tags.map((t) => (
              <span key={t} className="tag">
                {t}
              </span>
            ))}
          </span>
        )}
        {data.summaryEn && (
          <button type="button" className="linkish" onClick={() => setShowEn((v) => !v)}>
            {showEn ? "隐藏 EN" : "EN"}
          </button>
        )}

        <span className="vote">
          {vote?.error && <span className="vote__err">未保存，重试</span>}
          <button
            type="button"
            className="vote__btn"
            data-kind="up"
            data-active={active === "up"}
            aria-pressed={active === "up"}
            aria-label="点赞，提升类似内容排序"
            disabled={vote?.pending}
            onClick={() => onVote("up")}
          >
            <ThumbIcon dir="up" />
          </button>
          <button
            type="button"
            className="vote__btn"
            data-kind="down"
            data-active={active === "down"}
            aria-pressed={active === "down"}
            aria-label="点踩，降低类似内容排序"
            disabled={vote?.pending}
            onClick={() => onVote("down")}
          >
            <ThumbIcon dir="down" />
          </button>
        </span>

        <FavoriteButton itemId={data.id} initial={data.isFavorited} />
      </div>
    </article>
  );
}
