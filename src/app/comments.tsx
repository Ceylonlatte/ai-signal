import { Markdown } from "./kb-markdown.js";

// The build emits the discussion as a nested markdown list, one comment per
// bullet: `- **author** · ▲score` then the body on the following indented
// line(s); replies are bullets indented two spaces under their parent. We parse
// that regular shape into a tree so the reader can render real comment rows
// (monogram + byline + score chip) instead of a raw markdown wall.
export interface Comment {
  author: string;
  score: number | null;
  body: string;
  children: Comment[];
}

const BULLET = /^(\s*)-\s+\*\*(.+?)\*\*(?:\s*·\s*▲\s*(\d+))?\s*$/;

export function parseComments(md: string | null | undefined): Comment[] {
  const root: Comment[] = [];
  if (!md || !md.trim()) return root;

  const stack: { indent: number; children: Comment[] }[] = [{ indent: -1, children: root }];
  let current: Comment | null = null;
  let bodyLines: string[] = [];

  const flush = () => {
    if (current) current.body = bodyLines.join("\n").trim();
    bodyLines = [];
  };

  for (const raw of md.split("\n")) {
    const m = raw.match(BULLET);
    if (m) {
      flush();
      const indent = m[1].length;
      const node: Comment = {
        author: m[2],
        score: m[3] != null ? Number(m[3]) : null,
        body: "",
        children: [],
      };
      while (stack.length > 1 && stack[stack.length - 1].indent >= indent) stack.pop();
      stack[stack.length - 1].children.push(node);
      stack.push({ indent, children: node.children });
      current = node;
    } else if (current) {
      bodyLines.push(raw.replace(/^\s+/, ""));
    }
  }
  flush();
  return root;
}

export function countComments(list: Comment[]): number {
  return list.reduce((n, c) => n + 1 + countComments(c.children), 0);
}

function monogram(name: string): string {
  const ch = name.trim().charAt(0);
  return /[a-z]/i.test(ch) ? ch.toUpperCase() : ch;
}

function FlameIcon() {
  return (
    <svg className="kb-c__score-i" width="9" height="11" viewBox="0 0 10 12" aria-hidden="true">
      <path
        d="M5 0.4 C6.2 3 8.6 4.1 8.6 7.4 A3.6 3.6 0 0 1 1.4 7.4 C1.4 5.8 2.3 5 2.9 4.2 C3.6 5.1 4.3 4.9 4.3 3.8 C4.3 2.3 4.5 1.3 5 0.4 Z"
        fill="currentColor"
      />
    </svg>
  );
}

// The standout comment (a single, unambiguous top score) gets the amber accent;
// when the top scores tie, nothing is singled out.
function leadScore(nodes: Comment[]): number | null {
  const scores = nodes.map((n) => n.score ?? 0).sort((a, b) => b - a);
  if (scores.length === 0 || scores[0] <= 0) return null;
  return scores[0] > (scores[1] ?? -1) ? scores[0] : null;
}

export function CommentList({ nodes, depth = 0 }: { nodes: Comment[]; depth?: number }) {
  if (nodes.length === 0) return null;
  const lead = depth === 0 ? leadScore(nodes) : null;
  return (
    <div className={depth === 0 ? "kb-thread" : "kb-thread kb-thread--reply"}>
      {nodes.map((c, i) => (
        <article className="kb-c" key={`${c.author}-${i}`}>
          <span className="kb-c__mono" aria-hidden="true">{monogram(c.author)}</span>
          <div className="kb-c__main">
            <header className="kb-c__by">
              <span className="kb-c__name">{c.author}</span>
              {c.score != null && (
                <span className="kb-c__score" data-top={lead != null && c.score === lead ? "true" : undefined}>
                  <FlameIcon />
                  {c.score}
                </span>
              )}
            </header>
            {c.body && (
              <div className="kb-c__body markdown">
                <Markdown>{c.body}</Markdown>
              </div>
            )}
            {c.children.length > 0 && <CommentList nodes={c.children} depth={depth + 1} />}
          </div>
        </article>
      ))}
    </div>
  );
}
