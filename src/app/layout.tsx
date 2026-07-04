import type { Metadata } from "next";
import { Plus_Jakarta_Sans, Space_Grotesk, JetBrains_Mono } from "next/font/google";
import { SiteHeader } from "./site-header.js";
import { auth } from "../auth.js";
import "./globals.css";

// Body / UI text. CJK falls back to the system Chinese face, so only Latin
// glyphs pick up Jakarta.
const sans = Plus_Jakarta_Sans({
  subsets: ["latin"],
  weight: ["400", "500", "600", "700", "800"],
  variable: "--font-sans-latin",
  display: "swap",
});

// Display face for Latin headlines — an Obviously stand-in with wide apertures
// and a retrofuturist swagger against the dark void.
const display = Space_Grotesk({
  subsets: ["latin"],
  weight: ["400", "500", "600", "700"],
  variable: "--font-display-latin",
  display: "swap",
});

// Instrument-panel figures: the signal dial, stat readouts, badges, meta.
const mono = JetBrains_Mono({
  subsets: ["latin"],
  weight: ["400", "500", "600"],
  variable: "--font-mono-latin",
  display: "swap",
});

export const metadata: Metadata = {
  title: "信号流 · AI Signal",
  description: "个人 AI 资讯聚合与排序：只看对你有价值的，永久可搜索。",
};

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const session = await auth();
  return (
    <html lang="zh-CN" className={`${sans.variable} ${display.variable} ${mono.variable}`}>
      <head>
        {/* First-paint guard: paint the Void canvas before the app stylesheet
            loads (in dev it's injected async) so route changes never flash the
            browser's white base. Mirrors --app-bg / --porcelain. */}
        <style>{`html{background:#1f232e}`}</style>
        <noscript>
          {/* Scroll-reveal hides items until JS runs; keep them visible without it. */}
          <style>{`.feed .item{opacity:1!important}`}</style>
        </noscript>
      </head>
      <body>
        <div className="scroll-progress" aria-hidden="true" />
        <div className="app">
          <SiteHeader user={session?.user ?? null} />
          <div className="app__main">{children}</div>
        </div>
      </body>
    </html>
  );
}
