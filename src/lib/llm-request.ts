import { config } from "../config.js";

// Shared OpenRouter body fields for every SCORING_MODEL chat call: provider
// pinning + reasoning toggle. Spread into the request body next to `model`.
export function llmRouting() {
  const order = config.LLM_PROVIDER_ORDER.split(",").map((s) => s.trim()).filter(Boolean);
  return {
    reasoning: { enabled: config.LLM_REASONING },
    ...(order.length > 0 && {
      // require_parameters: a fallback provider must honour response_format.
      provider: { order, allow_fallbacks: config.LLM_ALLOW_FALLBACKS, require_parameters: true },
    }),
  };
}
