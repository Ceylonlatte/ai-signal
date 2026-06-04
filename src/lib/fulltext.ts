import { extract } from "@extractus/article-extractor";

function stripHtml(html: string): string {
  return html.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
}

// Always attempt to fetch + extract the article body; on any failure
// (network, paywall, empty), fall back to the provided text.
export async function fetchFullText(
  url: string | null, fallback: string,
): Promise<{ text: string; fetched: boolean }> {
  if (!url) return { text: fallback, fetched: false };
  try {
    const article = await extract(url);
    const content = article?.content ? stripHtml(article.content) : "";
    if (content.length > 0) return { text: content, fetched: true };
  } catch {
    // swallow: fall through to fallback
  }
  return { text: fallback, fetched: false };
}
