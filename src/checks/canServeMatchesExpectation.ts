import type { Check } from "./types.js";

export const canServeMatchesExpectation: Check = (quote, testCase) => {
  const passed = quote.can_serve === testCase.expect.canServe;
  return {
    name: "canServeMatchesExpectation",
    passed,
    detail: passed
      ? `can_serve is ${quote.can_serve}, as expected`
      : `expected can_serve ${testCase.expect.canServe} but got ${quote.can_serve}`,
  };
};
