// Single source of truth for the RSS feeds: the collector iterates `url`s, the
// /rss UI resolves a `feed_url` back to a human label. Keeping both here avoids
// drift between what we fetch and what we render.
export interface RssFeed {
  url: string;
  label: string;
}

export const RSS_FEEDS: RssFeed[] = [
  { url: "https://openai.com/news/rss.xml", label: "OpenAI" },
  { url: "https://raw.githubusercontent.com/Olshansk/rss-feeds/main/feeds/feed_anthropic_news.xml", label: "Anthropic" },
  { url: "https://research.google/blog/rss/", label: "Google Research" },
  { url: "https://deepmind.google/blog/rss.xml", label: "Google DeepMind" },
  { url: "https://raw.githubusercontent.com/Olshansk/rss-feeds/main/feeds/feed_cursor.xml", label: "Cursor" },
  { url: "https://raw.githubusercontent.com/Olshansk/rss-feeds/main/feeds/feed_claude.xml", label: "Claude" },
  { url: "https://developers.openai.com/codex/changelog/rss.xml", label: "OpenAI Codex" },
];

export function rssFeedLabel(feedUrl: string): string {
  const found = RSS_FEEDS.find((f) => f.url === feedUrl);
  if (found) return found.label;
  try {
    return new URL(feedUrl).hostname.replace(/^www\./, "");
  } catch {
    return feedUrl;
  }
}
