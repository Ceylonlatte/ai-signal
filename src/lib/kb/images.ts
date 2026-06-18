import { createHash } from "node:crypto";
import { config } from "../../config.js";
import { isFetchableUrl } from "../fulltext.js";
import { putObject, r2Configured } from "./r2.js";

const ALLOWED: Record<string, string> = {
  "image/jpeg": "jpg", "image/png": "png", "image/gif": "gif",
  "image/webp": "webp", "image/avif": "avif",
};

// UI chrome / tracking / icons that pollute extracted markdown. Dropped before
// download so the KB body keeps only real content images.
const NOISE = /(cookieyes|consent|sprite|favicon|\blogo\b|\bicon\b|pixel|analytics|\.svg(\?|$))/i;

const DOWNLOAD_TIMEOUT_MS = 15_000;

export interface StoredImage { srcUrl: string; r2Url: string; bytes: number; contentType: string; }

export function isNoiseImage(srcUrl: string): boolean {
  return NOISE.test(srcUrl);
}

export async function downloadAndStore(itemId: number, srcUrl: string): Promise<StoredImage | null> {
  if (!r2Configured() || !isFetchableUrl(srcUrl) || isNoiseImage(srcUrl)) return null;
  const res = await fetch(srcUrl, { signal: AbortSignal.timeout(DOWNLOAD_TIMEOUT_MS) });
  // Re-validate the post-redirect URL: fetch follows redirects, so a literal-OK
  // src can still land on a private/metadata host. (res.url is empty for the
  // synthetic Response objects used in unit tests, so only check when present.)
  if (!res.ok || (res.url && !isFetchableUrl(res.url))) return null;
  const contentType = (res.headers.get("content-type") ?? "").split(";")[0]!.trim().toLowerCase();
  const ext = ALLOWED[contentType];
  if (!ext) return null;
  const declared = Number(res.headers.get("content-length") ?? "");
  if (Number.isFinite(declared) && declared > config.KB_MAX_IMAGE_BYTES) return null;
  const buf = new Uint8Array(await res.arrayBuffer());
  if (buf.byteLength === 0 || buf.byteLength > config.KB_MAX_IMAGE_BYTES) return null;
  const key = `kb/${itemId}/${createHash("sha1").update(srcUrl).digest("hex")}.${ext}`;
  const r2Url = await putObject(key, buf, contentType);
  return { srcUrl, r2Url, bytes: buf.byteLength, contentType };
}

// Download every unique content image, upload to R2, and replace its URL in the
// markdown body. Per-image failures are swallowed: the original remote URL stays
// in the markdown so the body is never broken.
export async function localizeImages(
  itemId: number, markdown: string, imageUrls: string[],
): Promise<{ markdown: string; images: StoredImage[] }> {
  const images: StoredImage[] = [];
  let md = markdown;
  for (const src of [...new Set(imageUrls)]) {
    const stored = await downloadAndStore(itemId, src).catch(() => null);
    if (stored) {
      images.push(stored);
      md = md.split(src).join(stored.r2Url);
    }
  }
  return { markdown: md, images };
}
