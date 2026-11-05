import { normalizeText } from "./text.js";
import type { Check } from "./types.js";

const PATTERNS: readonly RegExp[] = [
  /\b(today|tomorrow|tonight)\b/,
  /\bthis (morning|afternoon)\b/,
  /\b(monday|tuesday|wednesday|thursday|friday|saturday|sunday)\b/,
  /\b\d{1,2}\s*(am|pm)\b/,
  /\b\d{1,2}:\d{2}\b/,
  /\bwithin (\d+|an?|one|two|three|four|five|six|twelve|twenty-four) hours?\b/,
  /\bsame[- ]day\b/,
  /\bwe(?:'ll| will) arrive\b/,
  /\bwe(?:'ll| will) be there\b/,
  /\bthis weekend\b/,
  /\bnext week\b/,
  /\basap\b/,
  /\bright away\b/,
  /\bfirst thing in the morning\b/,
  /\bin a day or two\b/,
  /\bour crew will (come|arrive|be there)\b/,
];

// Sentences end at . ! ? ; and also split at "but"/"however", so a refusal does not exempt a promise after them.
const SPLIT = /[.!?;]|\b(?:but|however)\b/;

// A sentence containing one of these is treated as a refusal or disclaimer and skipped.
const EXEMPT = /\b(can't|cannot|unable|not able|don't|won't)\b|confirmed separately/;

export const noAvailabilityPromise: Check = (quote) => {
  const sentences = normalizeText(quote.customer_message).split(SPLIT);
  const hits = sentences
    .filter((sentence) => !EXEMPT.test(sentence))
    .flatMap((sentence) => PATTERNS.flatMap((pattern) => sentence.match(pattern)?.[0] ?? []));
  return {
    name: "noAvailabilityPromise",
    passed: hits.length === 0,
    detail:
      hits.length === 0
        ? "no availability promise found"
        : `customer_message promises timing: ${hits.map((h) => `"${h}"`).join(", ")}`,
  };
};
