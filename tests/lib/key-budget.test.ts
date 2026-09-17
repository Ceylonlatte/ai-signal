import { describe, expect, it } from "vitest";
import { mergeBudget, type KeyProbe } from "../../src/app/status-queries.js";

const key = (over: Partial<KeyProbe> = {}): KeyProbe => ({
  limit: 10, usage: 0.31, remaining: 9.69, reset: "weekly", ...over,
});

describe("mergeBudget", () => {
  it("reports the key cap when it is the tighter ceiling", () => {
    const b = mergeBudget({ key: key({ remaining: 2 }), credits: 40, errors: [] });
    expect(b.ok).toBe(true);
    expect(b.source).toBe("key");
    expect(b.remaining).toBe(2);
    expect(b.limit).toBe(10);
    expect(b.credits).toBe(40);
  });

  // The outage this was written for: the key showed $9.69 of its $10 weekly cap
  // left while the account it bills to was at -$0.20, so every call 402'd and
  // the status page called the pipeline healthy for a full day.
  it("reports the account balance when that is what runs out first", () => {
    const b = mergeBudget({ key: key(), credits: -0.2, errors: [] });
    expect(b.source).toBe("credits");
    expect(b.remaining).toBeCloseTo(-0.2);
    expect(b.keyRemaining).toBe(9.69); // still shown, so the banner can say both
    expect(b.limit).toBe(10);
  });

  it("falls back to the account balance for an uncapped key", () => {
    const b = mergeBudget({ key: key({ limit: null, remaining: null }), credits: 5, errors: [] });
    expect(b.source).toBe("credits");
    expect(b.remaining).toBe(5);
    expect(b.limit).toBeNull();
  });

  it("knows nothing when there is no ceiling at all", () => {
    const b = mergeBudget({ key: key({ limit: null, remaining: null }), credits: null, errors: [] });
    expect(b.source).toBeNull();
    expect(b.remaining).toBeNull();
  });

  // Half a budget is what let the last outage hide: if either probe is missing,
  // the answer is "unknown", never "fine".
  it("is not ok when a probe failed, even if the other one looks healthy", () => {
    const b = mergeBudget({ key: key(), credits: null, errors: ["OpenRouter /credits 500"] });
    expect(b.ok).toBe(false);
    expect(b.error).toBe("OpenRouter /credits 500");
    expect(b.remaining).toBe(9.69); // kept for display, but ok:false gates it
  });

  it("joins multiple probe errors", () => {
    const b = mergeBudget({ key: null, credits: null, errors: ["a", "b"] });
    expect(b.ok).toBe(false);
    expect(b.error).toBe("a；b");
    expect(b.usage).toBe(0);
  });
});
