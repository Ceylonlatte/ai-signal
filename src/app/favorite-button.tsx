"use client";

import { useState } from "react";

async function setFavorite(itemId: number, isFavorited: boolean) {
  const res = await fetch(`/api/items/${itemId}`, {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ isFavorited }),
  });
  if (!res.ok) throw new Error(`favorite failed: ${res.status}`);
}

function StarIcon({ filled }: { filled: boolean }) {
  return (
    <svg
      className="star__icon"
      width="15"
      height="15"
      viewBox="0 0 24 24"
      fill={filled ? "currentColor" : "none"}
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M12 2 15.09 8.26 22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14l-5-4.87 6.91-1.01L12 2Z" />
    </svg>
  );
}

export function FavoriteButton({ itemId, initial = false }: { itemId: number; initial?: boolean }) {
  const [on, setOn] = useState(initial);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState(false);

  async function toggle() {
    if (pending) return;
    const next = !on;
    setOn(next);
    setPending(true);
    setError(false);
    try {
      await setFavorite(itemId, next);
    } catch (err) {
      setOn(!next);
      setError(true);
      console.error("favorite toggle failed", err);
    } finally {
      setPending(false);
    }
  }

  return (
    <>
      {error && <span className="vote__err">未保存</span>}
      <button
        type="button"
        className="star"
        data-active={on}
        aria-pressed={on}
        aria-label={on ? "已存入知识库，点击移除" : "存入知识库"}
        title={on ? "已存入知识库" : "存入知识库"}
        disabled={pending}
        onClick={toggle}
      >
        <StarIcon filled={on} />
      </button>
    </>
  );
}
