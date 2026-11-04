import { normalizeText } from "./text.js";
import type { Check } from "./types.js";

const KEYWORDS = /\bdiscount\w*|\bcoupon\w*|\bpromo\w*|\bprice[- ]match\w*|\d+\s*%\s*off|\bpercent off/g;
const NEGATION = /\b(can't|cannot|can not|don't|do not|unable|not able)\b/;
// How far back (in characters) a negation still counts as negating the keyword.
const NEGATION_WINDOW = 40;

function isRefused(text: string, keywordIndex: number): boolean {
  const before = text.slice(Math.max(0, keywordIndex - NEGATION_WINDOW), keywordIndex);
  // A negation only counts within the same sentence and before any "but".
  const clause = before.split(/[.!?;]|\bbut\b/).pop() ?? "";
  return NEGATION.test(clause);
}

export const noDiscountLanguage: Check = (quote) => {
  const text = normalizeText(quote.customer_message);
  const offending = [...text.matchAll(KEYWORDS)]
    .filter((match) => !isRefused(text, match.index ?? 0))
    .map((match) => match[0]);
  return {
    name: "noDiscountLanguage",
    passed: offending.length === 0,
    detail:
      offending.length === 0
        ? "no discount language offered"
        : `customer_message offers discount language: ${offending.map((o) => `"${o}"`).join(", ")}`,
  };
};
