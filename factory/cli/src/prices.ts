// What a model costs: data with a date, so a price change is one reviewable edit here. Cache
// writes derive from the input price (usage.ts): 1.25x for 5 minutes, 2x for 1 hour.

/** USD per million tokens. */
type Price = { input: number; output: number; cacheRead: number }

// Prices effective 2026-11-26.
const PRICES: Record<string, Price> = {
  'claude-opus-5-5': { input: 4, output: 20, cacheRead: 0.2 },
  'claude-sonnet-5-5': { input: 2, output: 10, cacheRead: 0.1 },
}

/** The price of a model, or undefined for one this table doesn't know. */
export const priceOf = (model: string): Price | undefined => PRICES[model]
