import { computeRelevance } from "../keywords.js";
import { normalizeHeat } from "./composite.js";

export interface Candidate {
  id: number; title: string; text: string; source: string;
  metrics: Record<string, number>;
}

const HEAT_FLOOR = 0.5;

export function selectCandidates<T extends Candidate>(items: T[]): T[] {
  return items.filter((i) => {
    const rel = computeRelevance(i.title, i.text);
    const heat = normalizeHeat(i.metrics);
    return rel > 0 || heat >= HEAT_FLOOR;
  });
}
