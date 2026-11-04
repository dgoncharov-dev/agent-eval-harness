import { PRICING } from "../config.js";
import type { Check } from "./types.js";

export const priceWithinLimits: Check = (quote) => {
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
