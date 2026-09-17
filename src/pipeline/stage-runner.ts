// Runs the worker's stages so that one failing stage cannot take the rest of
// the pipeline down with it.
//
// The loop used to await every stage inside a single try: the first throw
// aborted the whole pass. A 402 on the scoring key therefore froze triage AND
// everything downstream of it — embeddings, summaries, clustering — so the
// crawler kept filling raw_items while /topics quietly went empty. The stages
// are ordered by data flow, but they are independent by failure: work that is
// already sitting in the db (unclustered items, un-summarized scores, KB jobs)
// must keep draining even while the stage in front of it is broken.

/** One pipeline stage: a named unit of work that reports how much it moved. */
export type Stage = { name: string; run: () => Promise<number> };

// A stage that keeps throwing — an exhausted key, a provider outage, one
// poisonous row — would otherwise be retried every poll: ~17k failing passes a
// day, each re-running the embedding calls triage makes before it ever reaches
// the scorer, and burying every other line in the log. Back the failing stage
// off on its own; the first success clears it.
export const BACKOFF_BASE_MS = 30_000;
export const BACKOFF_MAX_MS = 10 * 60_000;

export function backoffMs(failures: number): number {
  if (failures <= 0) return 0;
  return Math.min(BACKOFF_BASE_MS * 2 ** (failures - 1), BACKOFF_MAX_MS);
}

export type StageState = { failures: number; nextAt: number };

export interface StageRunner {
  /** Run every stage that isn't backing off; returns the total progress. */
  runPass(): Promise<number>;
  /** Current backoff bookkeeping for a stage (test/debug surface). */
  stateOf(name: string): StageState;
}

export function createStageRunner(
  stages: Stage[],
  opts: { now?: () => number } = {},
): StageRunner {
  const now = opts.now ?? (() => Date.now());
  const states = new Map<string, StageState>();
  const stateOf = (name: string): StageState => {
    let s = states.get(name);
    if (!s) { s = { failures: 0, nextAt: 0 }; states.set(name, s); }
    return s;
  };

  async function runPass(): Promise<number> {
    let progress = 0;
    for (const stage of stages) {
      const state = stateOf(stage.name);
      if (state.failures > 0 && now() < state.nextAt) continue;
      try {
        progress += await stage.run();
        state.failures = 0;
        state.nextAt = 0;
      } catch (err) {
        state.failures += 1;
        const wait = backoffMs(state.failures);
        state.nextAt = now() + wait;
        console.error(
          `worker stage ${stage.name} failed (${state.failures}x, next try in ${Math.round(wait / 1000)}s)`,
          err,
        );
      }
    }
    return progress;
  }

  return { runPass, stateOf };
}
