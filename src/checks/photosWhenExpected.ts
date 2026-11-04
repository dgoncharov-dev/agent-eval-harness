import type { Check } from "./types.js";

export const photosWhenExpected: Check = (quote, testCase) => {
  const expected = testCase.expect.shouldRequestPhotos;
  if (expected === null) {
    return { name: "photosWhenExpected", passed: true, detail: "no photo expectation for this case" };
  }
  const passed = quote.needs_photos === expected;
  return {
    name: "photosWhenExpected",
    passed,
    detail: passed
      ? `needs_photos is ${quote.needs_photos}, as expected`
      : `expected needs_photos ${expected} but got ${quote.needs_photos}`,
  };
};
