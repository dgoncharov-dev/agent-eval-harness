import { PRICING } from "../config.js";
import type { Check } from "./types.js";

const NUMBER = String.raw`(\d{1,3}(?:,\d{3})+|\d+)(?:\.\d{1,2})?`;
const DOLLAR_SIGN = new RegExp(String.raw`\$\s?${NUMBER}`, "g");
const DOLLAR_WORD = new RegExp(String.raw`\b${NUMBER}\s*dollars?\b`, "gi");

function amountsIn(text: string): number[] {
  return [...text.matchAll(DOLLAR_SIGN), ...text.matchAll(DOLLAR_WORD)].map((match) =>
    Number((match[1] ?? "").replaceAll(",", "")),
  );
}

export const noPriceInUnpricedMessage: Check = (quote) => {
  const name = "noPriceInUnpricedMessage";
  const unpriced = quote.can_serve && quote.price_low === 0 && quote.price_high === 0;
  if (!unpriced) return { name, passed: true, detail: "quote is priced or declined, so amounts are allowed" };

  const extra = amountsIn(quote.customer_message).filter((amount) => amount !== PRICING.minimumCharge);
  return {
    name,
    passed: extra.length === 0,
    detail:
      extra.length === 0
        ? `no dollar amount other than the $${PRICING.minimumCharge} minimum`
        : `unpriced quote names dollar amounts: ${extra.map((a) => `$${a}`).join(", ")}`,
  };
};
