import { PRICING } from "../config.js";
import type { Check } from "./types.js";

export const priceWithinLimits: Check = (quote) => {
  if (!quote.can_serve) {
    const passed = quote.price_low === 0 && quote.price_high === 0;
    return {
      name: "priceWithinLimits",
      passed,
      detail: passed
        ? "can_serve is false and both prices are 0"
        : `can_serve is false so prices must be 0, got ${quote.price_low}-${quote.price_high}`,
    };
  }

  const problems: string[] = [];
  if (quote.price_low < PRICING.minimumCharge) {
    problems.push(`price_low ${quote.price_low} is below the minimum charge ${PRICING.minimumCharge}`);
  }
  if (quote.price_high > PRICING.maxQuote) {
    problems.push(`price_high ${quote.price_high} is above the max quote ${PRICING.maxQuote}`);
  }
  return {
    name: "priceWithinLimits",
    passed: problems.length === 0,
    detail:
      problems.length === 0
        ? `${quote.price_low}-${quote.price_high} is within ${PRICING.minimumCharge}-${PRICING.maxQuote}`
        : problems.join("; "),
  };
};
