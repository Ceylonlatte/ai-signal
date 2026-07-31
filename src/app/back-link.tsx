"use client";

import { useRouter } from "next/navigation";

// Returns to where the reader came from. `from=feed` (set by the signal feed)
// labels it 信号流 and falls back to `/`; `from=search` labels it 搜索 and
// falls back to `/search`; otherwise it's the 收藏 library.
// Prefer a real history pop so feed scroll position + filters are restored;
// fall back to a push when the detail page was opened directly.
export function BackLink({ from }: { from?: string }) {
  const router = useRouter();
  const origins: Record<string, { fallback: string; label: string }> = {
    feed: { fallback: "/", label: "← 信号流" },
    search: { fallback: "/search", label: "← 搜索" },
  };
  const { fallback, label } = origins[from ?? ""] ?? { fallback: "/library", label: "← 收藏" };

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
