import { rankingWeights } from "../../config.js";

export interface RankingInput {
  q: number; platformHeat: number; novelty: number; likeAffinity: number;
}

export function computeRanking(i: RankingInput): number {
  return rankingWeights.wQ * i.q
    + rankingWeights.wHeat * i.platformHeat
    + rankingWeights.wNov * i.novelty
    + rankingWeights.wAff * i.likeAffinity;
}
