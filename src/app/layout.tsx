import type { Metadata } from "next";
import { Plus_Jakarta_Sans } from "next/font/google";
import { SiteHeader } from "./site-header.js";
import "./globals.css";

// One family across the whole system (Awesomic's single-typeface rule —
// weight carries the hierarchy). CJK falls back to the system Chinese face,
// so only Latin glyphs pick up Jakarta.
const sans = Plus_Jakarta_Sans({
  subsets: ["latin"],
  weight: ["400", "500", "600", "700", "800"],
  variable: "--font-sans-latin",
  display: "swap",
});

export const metadata: Metadata = {
  title: "信号流 · AI Signal",
  description: "个人 AI 资讯聚合与排序：只看对你有价值的，永久可搜索。",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="zh-CN" className={sans.variable}>
      <head>
        <noscript>
          {/* Scroll-reveal hides items until JS runs; keep them visible without it. */}
          <style>{`.feed .item{opacity:1!important}`}</style>
        </noscript>
      </head>
      <body>
        <div className="scroll-progress" aria-hidden="true" />
        <div className="app">
          <SiteHeader />
          <div className="app__main">{children}</div>
        </div>
      </body>
    </html>
  );
}
