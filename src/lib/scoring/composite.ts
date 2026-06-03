export function normalizeHeat(metrics: Record<string, number>): number {
  const points = metrics.points ?? metrics.score ?? 0;
  const comments = metrics.comments ?? 0;
  const raw = points + 2 * comments;
  if (raw <= 0) return 0;
  return Math.min(1, Math.log10(1 + raw) / 3);
}

interface Parts { heat: number; relevance: number; novelty: number; llmValue: number; }
interface Weights { heat: number; relevance: number; novelty: number; llm: number; }

export function computeComposite(p: Parts, w: Weights): number {
  return w.heat * p.heat + w.relevance * p.relevance + w.novelty * p.novelty + w.llm * p.llmValue;
}
