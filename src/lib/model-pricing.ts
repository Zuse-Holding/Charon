/**
 * Per-model $/1M-token pricing for cost_usd tracking (task C, pre-launch).
 * Keyed by the exact model string sent to each provider — src/lib/llm.ts
 * calls priceForModel() after every real API response.
 *
 * ⚠️ Groq prices below are best-effort from general knowledge, NOT pulled
 * from a live pricing page — attempted to fetch Groq's current pricing
 * programmatically while building this and couldn't get a real number
 * (the marketing pricing page has no pricing table; the console page
 * requires login). Verify these against console.groq.com's actual current
 * rate card before trusting cost_usd numbers for anything real — flagged
 * in CHECKLIST.md.
 *
 * OpenRouter's three models here are all suffixed ":free" (see
 * DEFAULT_OPENROUTER_MODELS in llm.ts) — genuinely $0, not an estimate.
 * Ollama is always $0 — it's a local model, no per-token API cost.
 *
 * A model called that ISN'T in this table contributes $0 to the total and
 * logs a warning, rather than guessing a price — see computeCost below.
 * That means total cost is a floor, not an exact figure, whenever an
 * unpriced/overridden model gets used.
 */
export interface ModelPrice {
  /** $ per 1,000,000 input/prompt tokens */
  inputPer1M: number;
  /** $ per 1,000,000 output/completion tokens */
  outputPer1M: number;
}

export const MODEL_PRICES: Record<string, ModelPrice> = {
  // Groq — approximate, see warning above.
  "llama-3.3-70b-versatile": { inputPer1M: 0.59, outputPer1M: 0.79 },
  "llama-3.1-8b-instant": { inputPer1M: 0.05, outputPer1M: 0.08 },

  // OpenRouter free-tier models (DEFAULT_OPENROUTER_MODELS in llm.ts) — $0.
  "google/gemma-4-31b-it:free": { inputPer1M: 0, outputPer1M: 0 },
  "poolside/laguna-xs-2.1:free": { inputPer1M: 0, outputPer1M: 0 },
  "google/gemma-4-26b-a4b-it:free": { inputPer1M: 0, outputPer1M: 0 },

  // Ollama (local, OLLAMA_MODEL default) — always $0, no API cost.
  "llama3.1:8b": { inputPer1M: 0, outputPer1M: 0 },
};

export function priceForModel(model: string): ModelPrice | null {
  return MODEL_PRICES[model] ?? null;
}

export function costForCall(model: string, promptTokens: number, completionTokens: number): number {
  const price = priceForModel(model);
  if (!price) {
    console.warn(`[model-pricing] No price entry for model "${model}" — contributing $0 to cost_usd (undercounts the real total). Add it to MODEL_PRICES.`);
    return 0;
  }
  return (promptTokens / 1_000_000) * price.inputPer1M + (completionTokens / 1_000_000) * price.outputPer1M;
}
