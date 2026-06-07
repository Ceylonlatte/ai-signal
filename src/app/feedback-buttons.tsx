"use client";

import { useState } from "react";

type Signal = "up" | "down";

async function mutateFeedback(itemId: number, signal: Signal, method: "POST" | "DELETE") {
  const res = await fetch("/api/feedback", {
    method,
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ itemId, signal }),
  });
  if (!res.ok) throw new Error(`feedback ${method} failed: ${res.status}`);
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

export function FeedbackButtons({
  itemId,
  initialSignal = null,
}: {
  itemId: number;
  initialSignal?: Signal | null;
}) {
  const [active, setActive] = useState<Signal | null>(initialSignal);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState(false);

  async function vote(signal: Signal) {
    if (pending) return;
    const prev = active;
    const next: Signal | null = prev === signal ? null : signal;
    setActive(next);
    setPending(true);
    setError(false);
    try {
      if (prev && prev !== next) await mutateFeedback(itemId, prev, "DELETE");
      if (next) await mutateFeedback(itemId, next, "POST");
      setPending(false);
    } catch {
      setActive(prev);
      setPending(false);
      setError(true);
    }
  }

  return (
    <span className="vote">
      {error && <span className="vote__err">未保存，重试</span>}
      <button
        type="button"
        className="vote__btn"
        data-kind="up"
        data-active={active === "up"}
        aria-pressed={active === "up"}
        aria-label="点赞，提升类似内容排序"
        disabled={pending}
        onClick={() => vote("up")}
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
        disabled={pending}
        onClick={() => vote("down")}
      >
        <ThumbIcon dir="down" />
      </button>
    </span>
  );
}
