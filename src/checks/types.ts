import type { Quote } from "../sut/schema.js";

export type CheckResult = { name: string; passed: boolean; detail: string };

export type Case = {
  id: string;
  message: string;
  // null means no expectation for that field
  expect: { inServiceArea: boolean; shouldRequestPhotos: boolean | null };
};

export type Check = (quote: Quote, testCase: Case) => CheckResult;
