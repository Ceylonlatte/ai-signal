// Bump RUBRIC_VERSION whenever the prompt/weights change so jobs can re-score.
export const RUBRIC_VERSION = "2026-06-04.1";

export const RUBRIC = `You rank AI-news items by PERSONAL value to a hands-on AI engineer who cares about:
LLMs, agents/agentic systems, AI coding (Claude Code, Codex, Cursor), RAG, context engineering,
multimodal, and lab releases (OpenAI, Anthropic, Google DeepMind).
Score 0-100 where:
- 80-100: directly actionable or a significant capability/release the reader must know.
- 50-79: relevant and informative but not urgent.
- 20-49: tangentially related or shallow.
- 0-19: marketing, rehash, low-signal noise.
Penalize hype with no substance. Reward concrete technical detail.`;
