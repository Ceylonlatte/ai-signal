import { normalizeHeat } from "./composite.js";

export interface Candidate {
  id: number; title: string; text: string; source: string;
  metrics: Record<string, number>;
  // Hybrid (exact + semantic) relevance, precomputed by the caller (triage),
  // which has the item embedding needed for semantic matching.
  relevance: number;
}

const HEAT_FLOOR = 0.5;

// Cheap pre-pass before the (paid) LLM: keep anything that is keyword/semantic
// relevant OR already hot. Everything else is dropped without scoring.
export function selectCandidates<T extends Candidate>(items: T[]): T[] {
  return items.filter((i) => i.relevance > 0 || normalizeHeat(i.metrics) >= HEAT_FLOOR);
}
