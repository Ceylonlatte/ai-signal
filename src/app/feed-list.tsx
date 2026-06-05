"use client";

import { useState } from "react";
import { strengthLabel, strengthPips, type Strength } from "./format.js";

export interface FeedItemData {
  id: number;
  url: string | null;
  host: string;
  title: string;
  author: string | null;
  reason: string;
  summaryZh: string;
  summaryEn: string;
  sourceLabel: string;
  tags: string[];
  strength: Strength;
  rText: string;
  timeText: string;
}

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

export function FeedList({ items }: { items: FeedItemData[] }) {
  const [votes, setVotes] = useState<Record<number, VoteState>>({});

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
    <div className="feed" role="list">
      {items.map((it) => (
        <FeedItem key={it.id} data={it} vote={votes[it.id]} onVote={(s) => vote(it.id, s)} />
      ))}
    </div>
  );
}

function SignalBadge({ strength, rText }: { strength: Strength; rText: string }) {
  const on = strengthPips(strength);
  return (
    <span
      className="signal"
      data-strength={strength}
      title={`信号强度：${strengthLabel(strength)} · R ${rText}`}
      aria-label={`信号强度 ${strengthLabel(strength)}`}
    >
      <span className="signal__bars" aria-hidden="true">
        {[0, 1, 2].map((p) => (
          <i key={p} data-on={p < on ? "" : undefined} />
        ))}
      </span>
      {strengthLabel(strength)}
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
        <SignalBadge strength={data.strength} rText={data.rText} />
        <a className="item__title" href={data.url ?? "#"} target="_blank" rel="noreferrer">
          {data.title}
          {data.host && <span className="item__ext">{data.host} ↗</span>}
        </a>
      </div>

      {data.reason && <p className="item__reason">{data.reason}</p>}
      {data.summaryZh && <p className="item__summary">{data.summaryZh}</p>}
      {showEn && data.summaryEn && <p className="item__summary-en">{data.summaryEn}</p>}

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
            👍
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
            👎
          </button>
        </span>
      </div>
    </article>
  );
}
