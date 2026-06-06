import { config } from "../../config.js";

export function clamp01(x: number): number { return Math.max(0, Math.min(1, x)); }

// like affinity = clamped max similarity to liked items, scaled by cold-start factor.
export function likeAffinity(maxLikeSim: number | null, nUp: number): number {
  const sim = clamp01(maxLikeSim ?? 0);
  const cold = config.COLDSTART_N0 <= 0 ? 1 : Math.min(1, nUp / config.COLDSTART_N0);
  return sim * cold;
}

// Symmetric to likeAffinity: similarity to recently disliked items, scaled by
// the same cold-start factor. Ranking subtracts this so content like what you
// 👎'd is softly demoted (distinct from the hard hide at SUPPRESS_THRESHOLD).
export function dislikeAffinity(maxDislikeSim: number | null, nDown: number): number {
  const sim = clamp01(maxDislikeSim ?? 0);
  const cold = config.COLDSTART_N0 <= 0 ? 1 : Math.min(1, nDown / config.COLDSTART_N0);
  return sim * cold;
}

export function isSuppressed(maxDislikeSim: number | null): boolean {
  return (maxDislikeSim ?? 0) >= config.SUPPRESS_THRESHOLD;
}

export function likeRescues(maxLikeSim: number | null): boolean {
  return (maxLikeSim ?? 0) >= config.RESCUE_SIM_THRESHOLD;
}
