// Build the KB body for a Reddit item from the `reddit_discussion.v1` document
// the digest now carries in raw_items.payload.raw — no network fetch. The post
// body comes from items.text (selftext); the comment tree comes from
// `discussion.comments`. We produce three things:
//   - bodyMd:    the post body only (正文), rendered/translated for the detail page
//   - commentsMd: the FULL comment tree as threaded markdown (完整展示, no cap)
//   - noteInput: selftext + top-N comments, the bounded text fed to the LLM note

// Top comments (by score) folded into the LLM note input. The full tree is still
// rendered into commentsMd for display; this only bounds the summarization input.
const NOTE_TOP_COMMENTS = 20;

export interface RedditComment {
  author?: string | null;
  body?: string | null;
  score?: number | null;
  depth?: number;
  is_submitter?: boolean;
  distinguished?: string | null;
  stickied?: boolean;
  replies?: RedditComment[] | null;
}

export interface RedditDiscussion {
  fetch?: { status?: string | null } | null;
  comments?: RedditComment[] | null;
}

export interface RedditDoc {
  discussion?: RedditDiscussion | null;
}

interface FlatComment extends RedditComment {
  depth: number;
}

// Depth-first flatten that preserves thread order and records each node's depth.
export function flattenComments(comments: RedditComment[], depth = 0): FlatComment[] {
  const out: FlatComment[] = [];
  for (const c of comments ?? []) {
    if (!c) continue;
    out.push({ ...c, depth });
    if (Array.isArray(c.replies) && c.replies.length > 0) {
      out.push(...flattenComments(c.replies, depth + 1));
    }
  }
  return out;
}

function isVisible(c: RedditComment): boolean {
  const body = (c.body ?? "").trim();
  return body.length > 0 && body !== "[removed]" && body !== "[deleted]";
}

function authorOf(c: RedditComment): string {
  return c.author && c.author !== "[deleted]" ? c.author : "[deleted]";
}

function metaLine(c: RedditComment): string {
  const parts = [`**${authorOf(c)}**`];
  if (c.is_submitter) parts.push("OP");
  if (c.distinguished) parts.push(String(c.distinguished));
  if (c.stickied) parts.push("置顶");
  parts.push(`▲${c.score ?? 0}`);
  return parts.join(" · ");
}

// Render the WHOLE comment tree as a nested markdown bullet list: indentation
// encodes thread depth, the first line is the byline (author / OP / score), the
// second line is the comment body (newlines collapsed so it stays one list item).
export function renderCommentsMarkdown(comments: RedditComment[]): string {
  const flat = flattenComments(comments).filter(isVisible);
  if (flat.length === 0) return "";
  const lines = flat.map((c) => {
    const indent = "  ".repeat(c.depth);
    const body = (c.body ?? "").replace(/\r?\n+/g, " ").trim();
    return `${indent}- ${metaLine(c)}\n${indent}  ${body}`;
  });
  return lines.join("\n");
}

// Highest-signal comments for the LLM note: top-N by score plus every OP reply,
// de-duplicated and capped, formatted as plain lines (no nesting needed here).
function topCommentsForNote(comments: RedditComment[]): string {
  const flat = flattenComments(comments).filter(isVisible);
  if (flat.length === 0) return "";
  const byScore = [...flat].sort((a, b) => (b.score ?? 0) - (a.score ?? 0));
  const picked: FlatComment[] = [];
  const seen = new Set<FlatComment>();
  for (const c of byScore) {
    if (picked.length >= NOTE_TOP_COMMENTS) break;
    picked.push(c);
    seen.add(c);
  }
  for (const c of flat) {
    if (c.is_submitter && !seen.has(c)) picked.push(c);
  }
  return picked
    .map((c) => `- [${authorOf(c)}${c.is_submitter ? "/OP" : ""} ▲${c.score ?? 0}] ${(c.body ?? "").replace(/\r?\n+/g, " ").trim()}`)
    .join("\n");
}

export interface RedditKbBody {
  bodyMd: string;
  commentsMd: string;
  noteInput: string;
}

// Assemble the KB body for a reddit item. `selftext` is items.text (post body);
// `doc` is raw_items.payload.raw. Degrades gracefully when comments weren't
// fetched (status != success / legacy flat payload): commentsMd stays empty and
// the note is built from the post body alone.
export function buildRedditKbBody(doc: RedditDoc | null | undefined, selftext: string): RedditKbBody {
  const body = (selftext ?? "").trim();
  const discussion = doc?.discussion;
  const ok = discussion?.fetch?.status === "success" && Array.isArray(discussion.comments);
  const comments = ok ? discussion!.comments! : [];
  const commentsMd = comments.length > 0 ? renderCommentsMarkdown(comments) : "";
  const top = comments.length > 0 ? topCommentsForNote(comments) : "";
  const noteInput = top ? `${body}\n\n## 讨论\n${top}` : body;
  return { bodyMd: body, commentsMd, noteInput };
}
