import type { FeedSort, FeedSource } from "./feed-queries.js";

export function feedHref({ source, sort }: { source: FeedSource; sort: FeedSort }): string {
  const params = new URLSearchParams();
  if (source !== "all") params.set("source", source);
  if (!(source === "all" && sort === "time")) params.set("sort", sort);
  const qs = params.toString();
  return qs ? `/?${qs}` : "/";
}
