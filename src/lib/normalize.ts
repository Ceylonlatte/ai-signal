import { contentHash } from "./hash.js";
import { canonicalizeUrl } from "./url.js";
import type { NormalizedItem, RawPayload } from "../types.js";

export function normalizeRawItem(raw: RawPayload): NormalizedItem {
  const title = raw.title.trim();
  const text = (raw.text ?? "").trim();
  return {
    source: raw.source,
    url: raw.url,
    canonicalUrl: canonicalizeUrl(raw.url),
    author: raw.author,
    title,
    text,
    createdAt: new Date(raw.createdAt),
    metrics: raw.metrics ?? {},
    ...(raw.feed ? { feed: raw.feed } : {}),
    contentHash: contentHash({ title, text }),
  };
}
