import { config } from "../../config.js";
import { exactRelevance, type Keyword } from "../keywords.js";

// A keyword as loaded from the DB: matching metadata + (optional) term vector.
export interface LoadedKeyword extends Keyword { embedding: number[] | null; }

export function cosineSim(a: number[], b: number[]): number {
  const n = Math.min(a.length, b.length);
  let dot = 0, na = 0, nb = 0;
  for (let i = 0; i < n; i++) {
    const x = a[i]!, y = b[i]!;
    dot += x * y; na += x * x; nb += y * y;
  }
  if (na === 0 || nb === 0) return 0;
  return dot / (Math.sqrt(na) * Math.sqrt(nb));
}

// Best keyword cosine similarity mapped into [0,1]: sims at/below the threshold
// contribute nothing; the [threshold, 1] range maps linearly to [0, 1].
export function semanticRelevance(embedding: number[] | null, keywords: LoadedKeyword[]): number {
  if (!embedding || embedding.length === 0) return 0;
  let max = 0;
  for (const k of keywords) {
    if (!k.embedding) continue;
    const s = cosineSim(embedding, k.embedding);
    if (s > max) max = s;
  }
  const t = config.RELEVANCE_SIM_THRESHOLD;
  if (max <= t) return 0;
  return Math.min(1, (max - t) / (1 - t));
}

// Hybrid: exact match is high-precision and cheap; semantic catches AI content
// that contains no listed term. Take the stronger of the two signals.
export function hybridRelevance(
  input: { title: string; text: string; embedding: number[] | null },
  keywords: LoadedKeyword[],
): number {
  const exact = exactRelevance(input.title, input.text, keywords);
  const semantic = semanticRelevance(input.embedding, keywords);
  return Math.max(exact, semantic);
}
