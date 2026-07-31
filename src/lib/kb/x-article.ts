import { config } from "../../config.js";

// X Articles (long-form posts) live behind x.com's login wall, so the reader
// chain (firecrawl/markdown.new) only ever sees the login shell. FxTwitter's
// public API returns the full article for a status id — including the Draft.js
// content blocks and image entities — for both the article tweet itself and a
// tweet that quotes one.

const TIMEOUT_MS = 15_000;

export interface XArticle {
  title: string;
  markdown: string;
  images: string[];
  /** true when the article came from the quoted tweet, not the tweet itself */
  quoted: boolean;
}

export function statusIdFromUrl(url: string | null | undefined): string | null {
  if (!url) return null;
  const m = url.match(/^https?:\/\/(?:www\.)?(?:x|twitter)\.com\/[^/]+\/status\/(\d+)/i);
  return m?.[1] ?? null;
}

interface DraftBlock {
  text: string;
  type: string;
  inlineStyleRanges?: { offset: number; length: number; style: string }[];
  entityRanges?: { offset: number; length: number; key: number }[];
}
interface DraftEntity { type?: string; data?: Record<string, any> }
interface ArticlePayload {
  title?: string;
  content?: { blocks?: DraftBlock[]; entityMap?: unknown } | string;
  media_entities?: { media_id?: string; media_info?: { original_img_url?: string } }[];
}

// FxTwitter serializes the Draft.js entityMap as a list of {key, value} pairs
// in original-key order; block entityRanges reference entities positionally.
// Fall back to matching the pair's own key for safety.
function entityAt(entityMap: unknown, key: number): DraftEntity | null {
  if (!Array.isArray(entityMap)) return null;
  const byPos = entityMap[key];
  if (byPos?.value) return byPos.value as DraftEntity;
  const byKey = entityMap.find((e) => e?.key === String(key));
  return (byKey?.value as DraftEntity) ?? null;
}

// Draft.js offsets are UTF-16 code units, which is exactly what JS string
// slicing uses — apply ranges back-to-front so earlier offsets stay valid.
function applyInlineMarks(block: DraftBlock, entityMap: unknown): string {
  type Mark = { offset: number; length: number; before: string; after: string };
  const marks: Mark[] = [];
  for (const r of block.inlineStyleRanges ?? []) {
    if (r.style === "Bold") marks.push({ offset: r.offset, length: r.length, before: "**", after: "**" });
    else if (r.style === "Italic") marks.push({ offset: r.offset, length: r.length, before: "*", after: "*" });
    else if (r.style === "Code") marks.push({ offset: r.offset, length: r.length, before: "`", after: "`" });
  }
  for (const r of block.entityRanges ?? []) {
    const ent = entityAt(entityMap, r.key);
    const url = ent?.type === "LINK" ? ent.data?.url : null;
    if (url) marks.push({ offset: r.offset, length: r.length, before: "[", after: `](${url})` });
  }
  let text = block.text ?? "";
  marks.sort((a, b) => b.offset - a.offset);
  for (const m of marks) {
    const end = Math.min(m.offset + m.length, text.length);
    if (m.offset < 0 || m.offset >= end) continue;
    text = text.slice(0, m.offset) + m.before + text.slice(m.offset, end) + m.after + text.slice(end);
  }
  return text;
}

function atomicToMarkdown(
  block: DraftBlock,
  entityMap: unknown,
  mediaUrlById: Map<string, string>,
  images: string[],
): string {
  const parts: string[] = [];
  for (const r of block.entityRanges ?? []) {
    const ent = entityAt(entityMap, r.key);
    if (!ent) continue;
    if (ent.type === "DIVIDER") parts.push("---");
    else if (ent.type === "MARKDOWN" && typeof ent.data?.markdown === "string") parts.push(ent.data.markdown);
    else if (ent.type === "MEDIA") {
      for (const mi of ent.data?.mediaItems ?? []) {
        const url = mediaUrlById.get(String(mi?.mediaId ?? ""));
        if (url) { parts.push(`![](${url})`); images.push(url); }
      }
    }
  }
  return parts.join("\n\n");
}

export function articleToMarkdown(article: ArticlePayload): { markdown: string; images: string[] } {
  const content = typeof article.content === "string" ? JSON.parse(article.content) : article.content;
  const blocks: DraftBlock[] = content?.blocks ?? [];
  const entityMap = content?.entityMap;
  const mediaUrlById = new Map<string, string>();
  for (const m of article.media_entities ?? []) {
    const url = m?.media_info?.original_img_url;
    if (m?.media_id && url) mediaUrlById.set(String(m.media_id), url);
  }

  const images: string[] = [];
  const out: string[] = [];
  let ordinal = 0;
  for (const b of blocks) {
    if (b.type !== "ordered-list-item") ordinal = 0;
    if (b.type === "atomic") {
      const md = atomicToMarkdown(b, entityMap, mediaUrlById, images);
      if (md) out.push(md);
      continue;
    }
    const text = applyInlineMarks(b, entityMap);
    if (!text.trim()) continue;
    switch (b.type) {
      case "header-one": out.push(`# ${text}`); break;
      case "header-two": out.push(`## ${text}`); break;
      case "header-three": out.push(`### ${text}`); break;
      case "unordered-list-item": out.push(`- ${text}`); break;
      case "ordered-list-item": out.push(`${++ordinal}. ${text}`); break;
      case "blockquote": out.push(`> ${text}`); break;
      case "code-block": out.push("```\n" + b.text + "\n```"); break;
      default: out.push(text);
    }
  }
  return { markdown: out.join("\n\n"), images };
}

/**
 * Fetch the X Article attached to (or quoted by) a tweet. Returns null when the
 * tweet has no article, or on any network/shape failure — callers fall back to
 * the plain tweet text.
 */
export async function fetchXArticle(statusId: string): Promise<XArticle | null> {
  try {
    const res = await fetch(`${config.FX_API_BASE}/i/status/${statusId}`, {
      headers: { "user-agent": "ai-signal-kb/1.0" },
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    if (!res.ok) return null;
    const data = (await res.json()) as { tweet?: { article?: ArticlePayload; quote?: { article?: ArticlePayload } } };
    const own = data?.tweet?.article;
    const fromQuote = data?.tweet?.quote?.article;
    const article = own ?? fromQuote;
    if (!article) return null;
    const { markdown, images } = articleToMarkdown(article);
    if (!markdown.trim()) return null;
    return { title: article.title ?? "", markdown, images, quoted: !own && !!fromQuote };
  } catch {
    return null;
  }
}
