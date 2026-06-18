import { config } from "../../config.js";
import { fetchFullText, isFetchableUrl } from "../fulltext.js";

export type ReaderSource = "firecrawl" | "markdownnew" | "extractor" | "fallback";
export interface Article { markdown: string; images: string[]; source: ReaderSource; }

const TIMEOUT_MS = 30_000;

function imageLinksFromMarkdown(md: string): string[] {
  return [...md.matchAll(/!\[[^\]]*\]\(([^)\s]+)/g)].map((m) => m[1]!).filter(Boolean);
}

async function fetchViaFirecrawl(url: string): Promise<Article | null> {
  if (!config.FIRECRAWL_API_KEY) return null;
  const res = await fetch("https://api.firecrawl.dev/v2/scrape", {
    method: "POST",
    headers: { authorization: `Bearer ${config.FIRECRAWL_API_KEY}`, "content-type": "application/json" },
    body: JSON.stringify({ url, formats: ["markdown", "images"] }),
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  if (!res.ok) return null;
  const data = (await res.json()) as { data?: { markdown?: string; images?: string[] } };
  const markdown = data?.data?.markdown ?? "";
  if (!markdown.trim()) return null;
  const images = Array.isArray(data?.data?.images) ? data.data!.images! : imageLinksFromMarkdown(markdown);
  return { markdown, images, source: "firecrawl" };
}

// markdown.new — free, keyless, Cloudflare-backed (incl. headless-browser
// rendering for JS pages). POST returns JSON; markdown is in `content`, images
// inline when retain_images is set.
async function fetchViaMarkdownNew(url: string): Promise<Article | null> {
  const res = await fetch("https://markdown.new/", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ url, retain_images: true }),
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  if (!res.ok) return null;
  const data = (await res.json()) as { success?: boolean; content?: string };
  const markdown = data?.content ?? "";
  if (!data?.success || !markdown.trim()) return null;
  return { markdown, images: imageLinksFromMarkdown(markdown), source: "markdownnew" };
}

// Four-tier chain: Firecrawl → markdown.new → article-extractor (text only) →
// caller's fallback text. Each tier swallows its own errors so a single failure
// degrades to the next, never throwing out of fetchArticle.
export async function fetchArticle(url: string | null, fallbackText: string): Promise<Article> {
  if (url && isFetchableUrl(url)) {
    for (const fn of [fetchViaFirecrawl, fetchViaMarkdownNew]) {
      try {
        const a = await fn(url);
        if (a) return a;
      } catch {
        // try next tier
      }
    }
    try {
      const ft = await fetchFullText(url, "");
      if (ft.fetched && ft.text.trim()) return { markdown: ft.text, images: [], source: "extractor" };
    } catch {
      // fall through
    }
  }
  return { markdown: fallbackText ?? "", images: [], source: "fallback" };
}
