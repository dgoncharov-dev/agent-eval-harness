import type { Quote } from "../sut/schema.js";

export type CheckResult = { name: string; passed: boolean; detail: string };

export type Case = {
  id: string;
  message: string;
  // null means no expectation for that field
  expect: {
    inServiceArea: boolean;
    canServe: boolean;
    shouldRequestPhotos: boolean | null;
    // true: must be priced; false: must be unpriced (0-0) with photos requested; null/absent: no opinion.
    // "| undefined" is explicit because zod's .optional() infers it and exactOptionalPropertyTypes is on.
    priceable?: boolean | null | undefined;
  };
};

export type Check = (quote: Quote, testCase: Case) => CheckResult;
