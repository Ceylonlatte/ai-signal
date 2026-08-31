import { describe, expect, it } from "vitest";
import { assessHealth, STALL_MINUTES, FEED_STALE_HOURS, type KeyBudget } from "../../src/app/status-queries.js";

const NOW = new Date("2026-08-31T12:00:00Z");
const agoMin = (m: number) => new Date(NOW.getTime() - m * 60_000).toISOString();
const agoHr = (h: number) => agoMin(h * 60);

const budget = (over: Partial<KeyBudget> = {}): KeyBudget => ({
  ok: true, limit: 10, usage: 1, remaining: 9, reset: "weekly", error: null, ...over,
});

const base = {
  rawPending: 0,
  lastCallAt: agoMin(1),
  latestItemAt: agoMin(5),
  budget: budget(),
  now: NOW,
};

describe("assessHealth", () => {
  it("is quiet when the pipeline is draining normally", () => {
    const h = assessHealth({ ...base, rawPending: 500 });
    expect(h.stalled).toBe(false);
    expect(h.budgetExhausted).toBe(false);
    expect(h.budgetLow).toBe(false);
    expect(h.feedStale).toBe(false);
  });

  // The incident this page is meant to catch: raw items pile up while the
  // worker loops on 403s, so nothing new is ever scored into the feed.
  it("flags a backlog with a cold heartbeat as stalled", () => {
    const h = assessHealth({
      ...base,
      rawPending: 2048,
      lastCallAt: agoMin(STALL_MINUTES + 5),
    });
    expect(h.stalled).toBe(true);
    expect(h.pending).toBe(2048);
    expect(h.stalledMinutes).toBe(STALL_MINUTES + 5);
  });

  it("does not call an idle pipeline stalled — no backlog, no alarm", () => {
    const h = assessHealth({ ...base, rawPending: 0, lastCallAt: agoHr(48) });
    expect(h.stalled).toBe(false);
  });

  it("treats a backlog with no model call on record as stalled", () => {
    const h = assessHealth({ ...base, rawPending: 12, lastCallAt: null });
    expect(h.stalled).toBe(true);
    expect(h.stalledMinutes).toBeNull();
  });

  it("reports an exhausted key, and never also calls it merely low", () => {
    const h = assessHealth({ ...base, budget: budget({ remaining: 0, usage: 10 }) });
    expect(h.budgetExhausted).toBe(true);
    expect(h.budgetLow).toBe(false);
  });

  it("warns under 10% headroom", () => {
    const h = assessHealth({ ...base, budget: budget({ remaining: 0.5, usage: 9.5 }) });
    expect(h.budgetLow).toBe(true);
    expect(h.budgetExhausted).toBe(false);
  });

  it("stays silent on budget when the probe failed — unknown is not fine", () => {
    const h = assessHealth({
      ...base,
      budget: { ok: false, limit: null, usage: 0, remaining: null, reset: null, error: "timeout" },
    });
    expect(h.budgetExhausted).toBe(false);
    expect(h.budgetLow).toBe(false);
  });

  it("leaves an uncapped key alone", () => {
    const h = assessHealth({ ...base, budget: budget({ limit: null, remaining: null }) });
    expect(h.budgetExhausted).toBe(false);
    expect(h.budgetLow).toBe(false);
  });

  it("flags a stale feed past the threshold", () => {
    const h = assessHealth({ ...base, latestItemAt: agoHr(FEED_STALE_HOURS + 1) });
    expect(h.feedStale).toBe(true);
    expect(Math.round(h.feedAgeHours!)).toBe(FEED_STALE_HOURS + 1);
  });

  it("handles an empty corpus without claiming staleness", () => {
    const h = assessHealth({ ...base, latestItemAt: null });
    expect(h.feedStale).toBe(false);
    expect(h.feedAgeHours).toBeNull();
  });
});
