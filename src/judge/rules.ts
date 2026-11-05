import { BUSINESS, PRICING } from "../config.js";

// Business facts the judge needs for context. Built from config on purpose: it must not
// reuse the SUT prompt, so the judge stays independent of what the SUT was told.
export function buildBusinessRules(): string {
  const { minimumCharge, maxQuote, perCubicYard } = PRICING;
  return `Business rules (context for grading; the rubric decides pass or fail):
- Business: ${BUSINESS.name}, a junk-removal company.
- Service area: ${BUSINESS.serviceArea.join(", ")}.
- Pricing: roughly $${perCubicYard.low}-$${perCubicYard.high} per cubic yard. The minimum charge is $${minimumCharge}. No quote may exceed $${maxQuote}.
- Loads that cannot be sized from the customer's description get no price: the assistant gives no price range (prices 0, volume 0), asks for photos, and may mention only the $${minimumCharge} minimum charge.`;
}
