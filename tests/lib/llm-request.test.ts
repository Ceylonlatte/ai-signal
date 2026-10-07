import { afterEach, describe, expect, it } from "vitest";
import { config } from "../../src/config.js";
import { llmRouting } from "../../src/lib/llm-request.js";

const saved = {
  order: config.LLM_PROVIDER_ORDER,
  fallbacks: config.LLM_ALLOW_FALLBACKS,
  reasoning: config.LLM_REASONING,
};

describe("llmRouting", () => {
  afterEach(() => {
    config.LLM_PROVIDER_ORDER = saved.order;
    config.LLM_ALLOW_FALLBACKS = saved.fallbacks;
    config.LLM_REASONING = saved.reasoning;
  });

  it("defaults to inference-net with fallbacks and reasoning off", () => {
    expect(llmRouting()).toEqual({
      reasoning: { enabled: false },
      provider: { order: ["inference-net"], allow_fallbacks: true, require_parameters: true },
    });
  });

  it("parses a comma-separated provider order and a hard pin", () => {
    config.LLM_PROVIDER_ORDER = " inference-net , decart ";
    config.LLM_ALLOW_FALLBACKS = false;
    expect(llmRouting().provider).toEqual({
      order: ["inference-net", "decart"],
      allow_fallbacks: false,
      require_parameters: true,
    });
  });

  it("omits provider routing when the order is empty", () => {
    config.LLM_PROVIDER_ORDER = "";
    config.LLM_REASONING = true;
    expect(llmRouting()).toEqual({ reasoning: { enabled: true } });
  });
});
