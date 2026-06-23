"use client";

import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import {
  Waveform,
  BookmarkSimple,
  Hash,
  MagnifyingGlass,
  Tag,
  Pulse,
  EyeSlash,
  type Icon,
} from "@phosphor-icons/react";

type NavItem = { href: string; label: string; Icon: Icon; group: "browse" | "manage" };

const NAV: NavItem[] = [
  { href: "/", label: "信号流", Icon: Waveform, group: "browse" },
  { href: "/library", label: "收藏", Icon: BookmarkSimple, group: "browse" },
  { href: "/topics", label: "话题", Icon: Hash, group: "browse" },
  { href: "/search", label: "搜索", Icon: MagnifyingGlass, group: "browse" },
  { href: "/keywords", label: "关键词", Icon: Tag, group: "manage" },
  { href: "/status", label: "状态", Icon: Pulse, group: "manage" },
  { href: "/suppressed", label: "已压制", Icon: EyeSlash, group: "manage" },
];

function isActive(pathname: string, href: string): boolean {
  return href === "/" ? pathname === "/" : pathname.startsWith(href);
}

export function SiteHeader() {
  const pathname = usePathname() ?? "/";
  const [open, setOpen] = useState(false);

  const navLink = (it: NavItem) => (
    <a
      key={it.href}
      href={it.href}
      className="sidebar__link"
      aria-current={isActive(pathname, it.href) ? "page" : undefined}
    >
      <it.Icon className="sidebar__icon" size={18} weight="regular" aria-hidden="true" />
      {it.label}
    </a>
  );

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
        <div className="sidebar__shell">
          <div className="sidebar__core">
            <a className="sidebar__brand" href="/">
              <span className="sidebar__mark" aria-hidden="true">
                S
              </span>
              AI Signal
            </a>
            <nav className="sidebar__nav" aria-label="主导航">
              <p className="sidebar__group">浏览</p>
              {NAV.filter((it) => it.group === "browse").map(navLink)}
              <p className="sidebar__group sidebar__group--foot">管理</p>
              {NAV.filter((it) => it.group === "manage").map(navLink)}
            </nav>
            <a className="sidebar__status" href="/status">
              <span className="sidebar__status-orb" aria-hidden="true">
                <i />
              </span>
              <span className="sidebar__status-text">
                <span className="sidebar__status-title">流水线运行中</span>
                <span className="sidebar__status-meta">实时抓取与排序</span>
              </span>
              <span className="sidebar__status-go" aria-hidden="true">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M5 12h13M13 6l6 6-6 6" />
                </svg>
              </span>
            </a>
          </div>
        </div>
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
