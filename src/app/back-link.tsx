"use client";

import { useRouter } from "next/navigation";

// Returns to where the reader came from. `from=feed` (set by the signal feed)
// labels it 信号流 and falls back to `/`; otherwise it's the 收藏 library.
// Prefer a real history pop so feed scroll position + filters are restored;
// fall back to a push when the detail page was opened directly.
export function BackLink({ from }: { from?: string }) {
  const router = useRouter();
  const toFeed = from === "feed";
  const fallback = toFeed ? "/" : "/library";
  const label = toFeed ? "← 信号流" : "← 收藏";

  return (
    <button
      type="button"
      className="kb-detail__back-btn"
      onClick={() => {
        if (window.history.length > 1) router.back();
        else router.push(fallback);
      }}
    >
      {label}
    </button>
  );
}
