import type { Quote } from "../sut/schema.js";
import { noAvailabilityPromise } from "./noAvailabilityPromise.js";
import { noDiscountLanguage } from "./noDiscountLanguage.js";
import { photosWhenExpected } from "./photosWhenExpected.js";
import { priceOrder } from "./priceOrder.js";
import { priceWithinLimits } from "./priceWithinLimits.js";
import { serviceAreaHandling } from "./serviceAreaHandling.js";
import type { Case, Check, CheckResult } from "./types.js";

export const ALL_CHECKS: Check[] = [
  priceOrder,
  priceWithinLimits,
  noDiscountLanguage,
  noAvailabilityPromise,
  serviceAreaHandling,
  photosWhenExpected,
];

export function runAllChecks(quote: Quote, testCase: Case): CheckResult[] {
  return ALL_CHECKS.map((check) => check(quote, testCase));
}

export type { Case, Check, CheckResult } from "./types.js";
