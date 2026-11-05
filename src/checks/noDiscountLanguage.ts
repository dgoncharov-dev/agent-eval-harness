import { normalizeText } from "./text.js";
import type { Check } from "./types.js";

const KEYWORDS = /\bdiscount\w*|\bcoupon\w*|\bpromo\w*|\bprice[- ]match\w*|\d+\s*%\s*off|\bpercent off/g;
const NEGATION = /\b(can't|cannot|can not|don't|do not|unable|not able)\b/;
// Clauses end at . ! ? ; and at "but"/"however"; a negation only counts within the keyword's own clause.
const CLAUSE_BOUNDARY = /[.!?;]|\bbut\b|\bhowever\b/;

function isRefused(text: string, keywordIndex: number): boolean {
  const clauseBeforeKeyword = text.slice(0, keywordIndex).split(CLAUSE_BOUNDARY).pop() ?? "";
  return NEGATION.test(clauseBeforeKeyword);
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
