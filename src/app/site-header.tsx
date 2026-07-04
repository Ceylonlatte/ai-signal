"use client";

import Link from "next/link";
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
  SignOut,
  type Icon,
} from "@phosphor-icons/react";
import { signOutAction } from "./auth-actions.js";

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

type SessionUser = { name?: string | null; email?: string | null; image?: string | null };

export function SiteHeader({ user }: { user?: SessionUser | null }) {
  const pathname = usePathname() ?? "/";
  const [open, setOpen] = useState(false);

  const navLink = (it: NavItem) => (
    <Link
      key={it.href}
      href={it.href}
      className="sidebar__link"
      aria-current={isActive(pathname, it.href) ? "page" : undefined}
    >
      <it.Icon className="sidebar__icon" size={18} weight="regular" aria-hidden="true" />
      {it.label}
    </Link>
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

  // The login gate is a standalone surface — no app chrome behind it.
  if (pathname === "/login") return null;

  return (
    <>
      <aside className="sidebar">
        <div className="sidebar__shell">
          <div className="sidebar__core">
            <Link className="sidebar__brand" href="/">
              <span className="sidebar__mark" aria-hidden="true">
                S
              </span>
              AI Signal
            </Link>
            <nav className="sidebar__nav" aria-label="主导航">
              <p className="sidebar__group">浏览</p>
              {NAV.filter((it) => it.group === "browse").map(navLink)}
              <p className="sidebar__group sidebar__group--foot">管理</p>
              {NAV.filter((it) => it.group === "manage").map(navLink)}
            </nav>
            <Link className="sidebar__status" href="/status">
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
            </Link>
            {user ? (
              <div className="sidebar__user">
                <span className="sidebar__avatar" aria-hidden="true">
                  {user.image ? (
                    // Google avatar (lh3.googleusercontent.com). Plain img keeps
                    // this a static asset; no-referrer avoids hotlink 403s.
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={user.image} alt="" referrerPolicy="no-referrer" />
                  ) : (
                    (user.name || user.email || "?").charAt(0).toUpperCase()
                  )}
                </span>
                <span className="sidebar__user-text">
                  <span className="sidebar__user-name">{user.name || user.email}</span>
                  {user.email ? <span className="sidebar__user-mail">{user.email}</span> : null}
                </span>
                <form action={signOutAction} className="sidebar__signout-form">
                  <button
                    type="submit"
                    className="sidebar__signout-btn"
                    aria-label="退出登录"
                    title="退出登录"
                  >
                    <SignOut size={16} weight="regular" aria-hidden="true" />
                  </button>
                </form>
              </div>
            ) : (
              <form action={signOutAction} className="sidebar__signout-form">
                <button type="submit" className="sidebar__signout">
                  <SignOut size={16} weight="regular" aria-hidden="true" />
                  退出登录
                </button>
              </form>
            )}
          </div>
        </div>
      </aside>

      <header className="topbar">
        <Link className="topbar__brand" href="/">
          <span className="topbar__mark" aria-hidden="true">
            S
          </span>
          AI Signal
        </Link>
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
            <Link
              key={it.href}
              href={it.href}
              className="navmodal__link"
              style={{ "--i": i } as React.CSSProperties}
              aria-current={isActive(pathname, it.href) ? "page" : undefined}
              onClick={() => setOpen(false)}
            >
              {it.label}
            </Link>
          ))}
          {user?.email ? <p className="navmodal__user">{user.email}</p> : null}
          <form action={signOutAction} className="navmodal__signout-form">
            <button type="submit" className="navmodal__signout">
              <SignOut size={20} weight="regular" aria-hidden="true" />
              退出登录
            </button>
          </form>
        </nav>
      </div>
    </>
  );
}
