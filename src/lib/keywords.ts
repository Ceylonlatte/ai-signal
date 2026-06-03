interface Keyword { term: string; caseSensitive: boolean; }

export const WATCHED_KEYWORDS: Keyword[] = [
  { term: "LLM", caseSensitive: true }, { term: "LLMs", caseSensitive: true },
  { term: "AGI", caseSensitive: true }, { term: "RAG", caseSensitive: true },
  { term: "AI", caseSensitive: true }, { term: "Agent", caseSensitive: true },
  { term: "AI Agent", caseSensitive: true }, { term: "Multi-agent", caseSensitive: false },
  { term: "Context Engineering", caseSensitive: false }, { term: "Harness", caseSensitive: false },
  { term: "Agentic", caseSensitive: false }, { term: "multimodal", caseSensitive: false },
  { term: "Vibe Coding", caseSensitive: false }, { term: "AI Coding", caseSensitive: false },
  { term: "Vibe Design", caseSensitive: false }, { term: "Claude Code", caseSensitive: false },
  { term: "Codex", caseSensitive: false }, { term: "OpenAI", caseSensitive: false },
  { term: "Anthropic", caseSensitive: false },
];

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export function computeRelevance(title: string, text: string): number {
  const haystack = `${title} ${text}`;
  let hits = 0;
  for (const k of WATCHED_KEYWORDS) {
    const flags = k.caseSensitive ? "" : "i";
    const re = new RegExp(`\\b${escapeRegex(k.term)}\\b`, flags);
    if (re.test(haystack)) hits++;
  }
  return Math.min(1, hits / 3);
}
