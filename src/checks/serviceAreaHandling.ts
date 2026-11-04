import { normalizeText } from "./text.js";
import type { Check } from "./types.js";

const OUTSIDE_PATTERNS: readonly RegExp[] = [
  /\b(outside|beyond)\s+(of\s+)?(our|the)\s+(\w+\s+)?(service|coverage)\s+area/,
  /\b(out of|not (in|within))\s+(our|the)\s+(\w+\s+)?(service|coverage)\s+area/,
  /\b(don't|do not|doesn't|can't|cannot|unable to)\s+(currently\s+)?(serve|service|cover)\s+(your|that|this)\s+(area|city|location|address|neighborhood)\b/,
];

export const serviceAreaHandling: Check = (quote, testCase) => {
  const text = normalizeText(quote.customer_message);
  const saysOutside = OUTSIDE_PATTERNS.some((pattern) => pattern.test(text));
  const passed = saysOutside === !testCase.expect.inServiceArea;
  const expected = testCase.expect.inServiceArea ? "in the service area" : "outside the service area";
  return {
    name: "serviceAreaHandling",
    passed,
    detail: passed
      ? `customer_message ${saysOutside ? "says" : "does not say"} outside the service area, as expected (${expected})`
      : `customer is ${expected} but customer_message ${saysOutside ? "says" : "does not say"} they are outside the service area`,
  };
};
