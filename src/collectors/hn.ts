import type { RawPayload } from "../types.js";

interface HnHit {
  objectID: string; title: string | null; url: string | null;
  author: string | null; points: number | null; num_comments: number | null;
  created_at_i: number; story_text: string | null;
}

interface FetchArgs { query: string; sinceHours: number; hitsPerPage?: number; }

export async function fetchHackerNews(args: FetchArgs): Promise<RawPayload[]> {
  const since = Math.floor(Date.now() / 1000) - args.sinceHours * 3600;
  const url = new URL("https://hn.algolia.com/api/v1/search");
  url.searchParams.set("query", args.query);
  url.searchParams.set("tags", "story");
  url.searchParams.set("numericFilters", `created_at_i>${since}`);
  url.searchParams.set("hitsPerPage", String(args.hitsPerPage ?? 100));

  const res = await fetch(url);
  if (!res.ok) throw new Error(`HN Algolia ${res.status}`);
  const data = (await res.json()) as { hits: HnHit[] };

  return data.hits
    .filter((h) => h.title)
    .map((h) => ({
      source: "hn" as const,
      externalId: h.objectID,
      url: h.url,
      author: h.author,
      title: h.title!,
      text: h.story_text ?? "",
      createdAt: new Date(h.created_at_i * 1000).toISOString(),
      metrics: { points: h.points ?? 0, comments: h.num_comments ?? 0 },
      raw: h,
    }));
}
