"use client";

import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";

const NAV = [
  { href: "/", label: "信号流" },
  { href: "/library", label: "收藏" },
  { href: "/topics", label: "话题" },
  { href: "/search", label: "搜索" },
  { href: "/keywords", label: "关键词" },
  { href: "/status", label: "状态" },
  { href: "/suppressed", label: "已压制" },
] as const;

function isActive(pathname: string, href: string): boolean {
  return href === "/" ? pathname === "/" : pathname.startsWith(href);
}

export function SiteHeader() {
  const pathname = usePathname() ?? "/";
  const [open, setOpen] = useState(false);

  // Close the takeover whenever the route changes.
  useEffect(() => {
    setOpen(false);
  }, [pathname]);

  // While open: lock body scroll and let Esc dismiss.
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("keydown", onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = prev;
    };
  }, [open]);

  return (
    <>
      <aside className="sidebar">
        <a className="sidebar__brand" href="/">
          <span className="sidebar__mark" aria-hidden="true">
            S
          </span>
          AI Signal
        </a>
        <nav className="sidebar__nav" aria-label="主导航">
          {NAV.map((it) => (
            <a
              key={it.href}
              href={it.href}
              className="sidebar__link"
              aria-current={isActive(pathname, it.href) ? "page" : undefined}
            >
              {it.label}
            </a>
          ))}
        </nav>
      </aside>

      <header className="topbar">
        <a className="topbar__brand" href="/">
          <span className="topbar__mark" aria-hidden="true">
            S
          </span>
          AI Signal
        </a>
        <button
          type="button"
          className="topbar__burger"
          aria-label={open ? "关闭菜单" : "打开菜单"}
          aria-expanded={open}
          aria-controls="nav-takeover"
          onClick={() => setOpen((v) => !v)}
        >
          <span />
          <span />
        </button>
      </header>

      <div id="nav-takeover" className="navmodal" data-open={open} aria-hidden={!open}>
        <button
          type="button"
          className="navmodal__close"
          aria-label="关闭菜单"
          onClick={() => setOpen(false)}
        >
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" aria-hidden="true">
            <path d="M6 6l12 12M18 6L6 18" />
          </svg>
        </button>
        <nav className="navmodal__nav" aria-label="主导航">
          {NAV.map((it, i) => (
            <a
              key={it.href}
              href={it.href}
              className="navmodal__link"
              style={{ "--i": i } as React.CSSProperties}
              aria-current={isActive(pathname, it.href) ? "page" : undefined}
              onClick={() => setOpen(false)}
            >
              {it.label}
            </a>
          ))}
        </nav>
      </div>
    </>
  );
}
