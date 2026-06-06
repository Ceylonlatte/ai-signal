import type { Metadata } from "next";
import { Inter } from "next/font/google";
import { SiteHeader } from "./site-header.js";
import "./globals.css";

const inter = Inter({
  subsets: ["latin"],
  weight: ["500", "700"],
  variable: "--font-inter",
  display: "swap",
});

export const metadata: Metadata = {
  title: "AI Signal — 今日信号",
  description: "个人 AI 资讯聚合与排序：只看对你有价值的，永久可搜索。",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="zh-CN" className={inter.variable}>
      <head>
        <noscript>
          {/* Scroll-reveal hides items until JS runs; keep them visible without it. */}
          <style>{`.feed .item{opacity:1!important}`}</style>
        </noscript>
      </head>
      <body>
        <div className="scroll-progress" aria-hidden="true" />
        <SiteHeader />
        {children}
      </body>
    </html>
  );
}
