"use client";

import { usePathname } from "next/navigation";

const NAV = [
  { href: "/", label: "信号流" },
  { href: "/rss", label: "RSS" },
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
  return (
    <header className="shell">
      <a className="shell__brand" href="/">
        <span className="shell__mark" aria-hidden="true">
          S
        </span>
        AI Signal
      </a>
      <nav className="shell__nav" aria-label="主导航">
        {NAV.map((it) => (
          <a
            key={it.href}
            href={it.href}
            className="shell__link"
            aria-current={isActive(pathname, it.href) ? "page" : undefined}
          >
            {it.label}
          </a>
        ))}
      </nav>
    </header>
  );
}
