import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import {
  createStageRunner, backoffMs, BACKOFF_BASE_MS, BACKOFF_MAX_MS,
} from "../../src/pipeline/stage-runner.js";

describe("stage runner", () => {
  beforeEach(() => { vi.spyOn(console, "error").mockImplementation(() => {}); });
  afterEach(() => { vi.restoreAllMocks(); });

  it("runs every stage and sums what they moved", async () => {
    const runner = createStageRunner([
      { name: "triage", run: async () => 2 },
      { name: "cluster", run: async () => 5 },
    ]);
    expect(await runner.runPass()).toBe(7);
  });

  // The incident this exists for: triage threw on a 402 and took embeddings,
  // summaries and clustering down with it, so the topics page went empty while
  // work already in the db sat there waiting.
  it("keeps running later stages when an earlier one throws", async () => {
    const calls: string[] = [];
    const runner = createStageRunner([
      {
        name: "triage",
        run: async () => { calls.push("triage"); throw new Error("OpenRouter 402"); },
      },
      { name: "cluster", run: async () => { calls.push("cluster"); return 3; } },
    ]);

    expect(await runner.runPass()).toBe(3);
    expect(calls).toEqual(["triage", "cluster"]);
  });

  it("backs a failing stage off, and retries once the wait is over", async () => {
    let clock = 0;
    let attempts = 0;
    const runner = createStageRunner(
      [{ name: "triage", run: async () => { attempts += 1; throw new Error("boom"); } }],
      { now: () => clock },
    );

    await runner.runPass();
    expect(attempts).toBe(1);
    expect(runner.stateOf("triage").failures).toBe(1);

    clock += BACKOFF_BASE_MS - 1; // still inside the window
    await runner.runPass();
    expect(attempts).toBe(1);

    clock += 1;
    await runner.runPass();
    expect(attempts).toBe(2);
    expect(runner.stateOf("triage").failures).toBe(2);
  });

  it("does not let one stage's backoff hold up the others", async () => {
    let clock = 0;
    let clustered = 0;
    const runner = createStageRunner(
      [
        { name: "triage", run: async () => { throw new Error("boom"); } },
        { name: "cluster", run: async () => { clustered += 1; return 1; } },
      ],
      { now: () => clock },
    );

    await runner.runPass();
    clock += 1; // triage is backing off, cluster must not be
    await runner.runPass();
    expect(clustered).toBe(2);
  });

  it("clears the backoff on the first success", async () => {
    let clock = 0;
    let broken = true;
    const runner = createStageRunner(
      [{ name: "triage", run: async () => { if (broken) throw new Error("boom"); return 7; } }],
      { now: () => clock },
    );

    await runner.runPass();
    expect(runner.stateOf("triage").failures).toBe(1);

    broken = false;
    clock += BACKOFF_BASE_MS;
    expect(await runner.runPass()).toBe(7);
    expect(runner.stateOf("triage").failures).toBe(0);
    expect(runner.stateOf("triage").nextAt).toBe(0);
  });

  it("grows the wait geometrically and caps it", () => {
    expect(backoffMs(0)).toBe(0);
    expect(backoffMs(1)).toBe(BACKOFF_BASE_MS);
    expect(backoffMs(2)).toBe(BACKOFF_BASE_MS * 2);
    expect(backoffMs(99)).toBe(BACKOFF_MAX_MS);
  });
});
