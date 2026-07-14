import { config, qualityWeights } from "../../config.js";

export interface QualityInput { llmValue: number; relevance: number; trust: number; }

function clamp01(x: number): number { return Math.max(0, Math.min(1, x)); }

// Q is time-invariant and llm-dominant: llmValue plus small ± nudges from
// relevance and source trust around their 0.5 midpoint.
// Rounded to 3 decimals: IEEE754 leaves sums like 0.7 - 0.15 at 0.5499999…,
// which reads as 0.550 everywhere (triage JSON, /raw) yet fails a >= 0.55
// gate — the stored q must be the same number the gate saw.
export function computeQuality(i: QualityInput): number {
  const q = i.llmValue
    + qualityWeights.wRel * (i.relevance - 0.5)
    + qualityWeights.wTrust * (i.trust - 0.5);
  return Math.round(clamp01(q) * 1000) / 1000;
}

export function passesGate(q: number, threshold: number = config.Q_THRESHOLD): boolean {
  return q >= threshold;
}

// Borderline band just below the gate, eligible for like-rescue.
export function inRescueBand(q: number): boolean {
  return q < config.Q_THRESHOLD && q >= config.Q_THRESHOLD - config.RESCUE_MARGIN;
}
