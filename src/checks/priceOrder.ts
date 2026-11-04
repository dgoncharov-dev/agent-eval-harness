import type { Check } from "./types.js";

export const priceOrder: Check = (quote) => {
  const passed = quote.price_low <= quote.price_high;
  return {
    name: "priceOrder",
    passed,
    detail: passed
      ? `price_low ${quote.price_low} <= price_high ${quote.price_high}`
      : `price_low ${quote.price_low} is greater than price_high ${quote.price_high}`,
  };
};
