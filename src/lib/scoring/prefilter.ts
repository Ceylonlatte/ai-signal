import { normalizeHeat } from "./composite.js";

export interface Candidate {
  id: number; title: string; text: string; source: string;
  metrics: Record<string, number>;
  // Hybrid (exact + semantic) relevance, precomputed by the caller (triage),
  // which has the item embedding needed for semantic matching.
  relevance: number;
}

const HEAT_FLOOR = 0.5;

// composite.normalizeHeat reads points/score/comments — fields twitter metrics
// ({likes,retweets,replies}) don't have, so every tweet scored heat 0 and could
// only pass the prefilter via relevance. Score twitter on its own engagement,
// normalized the same log10(1+x)/3 way so HEAT_FLOOR stays comparable per source.
function prefilterHeat(source: string, metrics: Record<string, number>): number {
  if (source !== "twitter") return normalizeHeat(metrics);
  const eng = (metrics.likes ?? 0) + 2 * (metrics.retweets ?? 0) + (metrics.replies ?? 0);
  return eng > 0 ? Math.min(1, Math.log10(1 + eng) / 3) : 0;
}

// Cheap pre-pass before the (paid) LLM: keep anything that is keyword/semantic
// relevant OR already hot. Everything else is dropped without scoring.
export function selectCandidates<T extends Candidate>(items: T[]): T[] {
  return items.filter((i) => i.relevance > 0 || prefilterHeat(i.source, i.metrics) >= HEAT_FLOOR);
}
