import { PRICING } from "../config.js";
import type { Check } from "./types.js";

export const priceableMatchesExpectation: Check = (quote, testCase) => {
  const expected = testCase.expect.priceable;
  const name = "priceableMatchesExpectation";
  if (expected === null || expected === undefined) {
    return { name, passed: true, detail: "no priceable expectation for this case" };
  }

  const { price_low: low, price_high: high } = quote;
  if (expected) {
    const passed = low > 0 && high > 0 && low >= PRICING.minimumCharge && high <= PRICING.maxQuote;
    return {
      name,
      passed,
      detail: passed
        ? `priced ${low}-${high} as expected`
        : `expected non-zero prices within ${PRICING.minimumCharge}-${PRICING.maxQuote}, got ${low}-${high}`,
    };
  }

  const passed = low === 0 && high === 0 && quote.needs_photos;
  return {
    name,
    passed,
    detail: passed
      ? "unpriceable: prices are 0 and photos are requested"
      : `expected prices 0-0 with needs_photos true, got ${low}-${high} with needs_photos ${quote.needs_photos}`,
  };
};
