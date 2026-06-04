import { config, qualityWeights } from "../../config.js";

export interface QualityInput { llmValue: number; relevance: number; trust: number; }

function clamp01(x: number): number { return Math.max(0, Math.min(1, x)); }

// Q is time-invariant and llm-dominant: llmValue plus small ± nudges from
// relevance and source trust around their 0.5 midpoint.
export function computeQuality(i: QualityInput): number {
  const q = i.llmValue
    + qualityWeights.wRel * (i.relevance - 0.5)
    + qualityWeights.wTrust * (i.trust - 0.5);
  return clamp01(q);
}

export function passesGate(q: number): boolean {
  return q >= config.Q_THRESHOLD;
}

// Borderline band just below the gate, eligible for like-rescue.
export function inRescueBand(q: number): boolean {
  return q < config.Q_THRESHOLD && q >= config.Q_THRESHOLD - config.RESCUE_MARGIN;
}
