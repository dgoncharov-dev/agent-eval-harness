import { describe, expect, it } from "vitest";
import type { Quote } from "../sut/schema.js";
import { ALL_CHECKS, runAllChecks } from "./index.js";
import { noAvailabilityPromise } from "./noAvailabilityPromise.js";
import { noDiscountLanguage } from "./noDiscountLanguage.js";
import { photosWhenExpected } from "./photosWhenExpected.js";
import { priceOrder } from "./priceOrder.js";
import { priceWithinLimits } from "./priceWithinLimits.js";
import { serviceAreaHandling } from "./serviceAreaHandling.js";
import type { Case } from "./types.js";

const baseQuote: Quote = {
  items: ["old couch"],
  estimated_cubic_yards: 3,
  price_low: 120,
  price_high: 210,
  needs_photos: false,
  customer_message: "We can haul that for roughly $120-$210.",
};

const baseCase: Case = {
  id: "base",
  message: "I have an old couch in Bellevue.",
  expect: { inServiceArea: true, shouldRequestPhotos: null },
};

const quoteWith = (overrides: Partial<Quote>): Quote => ({ ...baseQuote, ...overrides });
const caseWith = (expectOverrides: Partial<Case["expect"]>): Case => ({
  ...baseCase,
  expect: { ...baseCase.expect, ...expectOverrides },
});
const saying = (customer_message: string): Quote => quoteWith({ customer_message });

describe("priceOrder", () => {
  it("passes when low <= high", () => {
    expect(priceOrder(baseQuote, baseCase).passed).toBe(true);
  });
  it("passes when low equals high", () => {
    expect(priceOrder(quoteWith({ price_low: 150, price_high: 150 }), baseCase).passed).toBe(true);
  });
  it("fails when low > high", () => {
    expect(priceOrder(quoteWith({ price_low: 300, price_high: 200 }), baseCase).passed).toBe(false);
  });
});

describe("priceWithinLimits", () => {
  it("passes within the limits", () => {
    expect(priceWithinLimits(baseQuote, baseCase).passed).toBe(true);
  });
  it("passes exactly at the limits", () => {
    expect(priceWithinLimits(quoteWith({ price_low: 99, price_high: 1200 }), baseCase).passed).toBe(true);
  });
  it("fails below the minimum charge", () => {
    expect(priceWithinLimits(quoteWith({ price_low: 50 }), baseCase).passed).toBe(false);
  });
  it("fails above the max quote", () => {
    expect(priceWithinLimits(quoteWith({ price_high: 1500 }), baseCase).passed).toBe(false);
  });
});

describe("noDiscountLanguage", () => {
  it("passes on a plain quote", () => {
    expect(noDiscountLanguage(baseQuote, baseCase).passed).toBe(true);
  });
  it("passes when the assistant refuses a discount", () => {
    const quote = saying("Sorry, we can't offer discounts or do price matching, but the quote is $120-$210.");
    expect(noDiscountLanguage(quote, baseCase).passed).toBe(true);
  });
  it("passes on a refusal of price matching", () => {
    expect(noDiscountLanguage(saying("We don't do price matching."), baseCase).passed).toBe(true);
  });
  it("fails on a discount offer", () => {
    expect(noDiscountLanguage(saying("I can give you a 10% discount!"), baseCase).passed).toBe(false);
  });
  it("fails on '% off'", () => {
    expect(noDiscountLanguage(saying("Book now and get 15% off."), baseCase).passed).toBe(false);
  });
  it("fails on a coupon", () => {
    expect(noDiscountLanguage(saying("Use this coupon code at checkout."), baseCase).passed).toBe(false);
  });
  it("fails when a refusal is followed by an offer", () => {
    const quote = saying("We can't offer discounts, but we do price matching.");
    expect(noDiscountLanguage(quote, baseCase).passed).toBe(false);
  });

  it("fails when 'No problem!' precedes a coupon offer (bare 'no' is not a refusal)", () => {
    const quote = saying("No problem! Happy to give you a 10% off coupon.");
    expect(noDiscountLanguage(quote, baseCase).passed).toBe(false);
  });

  // Known limitation: the negation window spans commas, so a negation about something else
  // ("don't charge extra fees") wrongly suppresses a real coupon offer later in the same sentence.
  it.fails("catches a coupon offer after an unrelated negation across a comma", () => {
    const quote = saying("We don't charge extra fees, and here's a coupon for you.");
    expect(noDiscountLanguage(quote, baseCase).passed).toBe(false);
  });

  // Known limitation: only matches listed keywords, so paraphrased discounts slip through.
  it.fails("catches a discount phrased 'happy to knock a bit off'", () => {
    const quote = saying("Happy to knock a bit off the price for you.");
    expect(noDiscountLanguage(quote, baseCase).passed).toBe(false);
  });
});

describe("noAvailabilityPromise", () => {
  it("passes on a plain quote", () => {
    expect(noAvailabilityPromise(baseQuote, baseCase).passed).toBe(true);
  });
  it("passes on 'Scheduling is confirmed separately once you book'", () => {
    const quote = saying("The price is $120-$210. Scheduling is confirmed separately once you book.");
    expect(noAvailabilityPromise(quote, baseCase).passed).toBe(true);
  });
  it.each([
    "We can come today.",
    "We'll be there tomorrow.",
    "How about tonight?",
    "We can swing by this afternoon.",
    "We're open Saturday.",
    "We can be there at 3pm.",
    "See you at 3:30.",
    "We'll finish within 2 hours.",
    "We offer same-day pickup.",
    "We’ll arrive soon.",
    "We'll be there to help.",
  ])("fails on %s", (message) => {
    expect(noAvailabilityPromise(saying(message), baseCase).passed).toBe(false);
  });
  it.each([
    "We can do it this weekend.",
    "We could come next week.",
    "We'll get there ASAP.",
    "We can start right away.",
    "We'll be out first thing in the morning.",
    "Expect us in a day or two.",
    "Our crew will arrive with a truck.",
  ])("fails on vague timing: %s", (message) => {
    expect(noAvailabilityPromise(saying(message), baseCase).passed).toBe(false);
  });

  // Known limitation: no negation handling, so a refusal to promise a time is still flagged by "today".
  it.fails("does not flag 'We can't promise a time today.'", () => {
    const quote = saying("We can't promise a time today.");
    expect(noAvailabilityPromise(quote, baseCase).passed).toBe(true);
  });

  // Known limitation: only matches explicit days, clock times and listed phrases, so vague timing is missed.
  it.fails("catches an availability promise phrased 'We'll swing by after lunch'", () => {
    const quote = saying("We'll swing by after lunch.");
    expect(noAvailabilityPromise(quote, baseCase).passed).toBe(false);
  });
});

describe("serviceAreaHandling", () => {
  const outsideCase = caseWith({ inServiceArea: false });

  it("passes when in area and the message does not mention it", () => {
    expect(serviceAreaHandling(baseQuote, baseCase).passed).toBe(true);
  });
  it("passes when out of area and the message says so", () => {
    const quote = saying("Sorry, Seattle is outside our service area.");
    expect(serviceAreaHandling(quote, outsideCase).passed).toBe(true);
  });
  it("passes on 'we don't serve your area' for an out-of-area case", () => {
    const quote = saying("Unfortunately we don't serve your area.");
    expect(serviceAreaHandling(quote, outsideCase).passed).toBe(true);
  });
  it("passes when 'don't cover' refers to something other than the customer's area", () => {
    const quote = saying("We don't cover hazardous waste like paint.");
    expect(serviceAreaHandling(quote, baseCase).passed).toBe(true);
  });

  // Known limitation: no negation handling, so "not outside our service area" is misread as outside.
  it.fails("does not misread 'you're not outside our service area' as outside", () => {
    const quote = saying("Good news, you're not outside our service area.");
    expect(serviceAreaHandling(quote, baseCase).passed).toBe(true);
  });
  it("fails when out of area and the message does not say so", () => {
    expect(serviceAreaHandling(baseQuote, outsideCase).passed).toBe(false);
  });
  it("fails when in area but the message says outside", () => {
    const quote = saying("Sorry, that is outside our service area.");
    expect(serviceAreaHandling(quote, baseCase).passed).toBe(false);
  });
});

describe("photosWhenExpected", () => {
  it("passes with no expectation regardless of needs_photos", () => {
    expect(photosWhenExpected(quoteWith({ needs_photos: true }), baseCase).passed).toBe(true);
  });
  it("passes when needs_photos matches true", () => {
    expect(photosWhenExpected(quoteWith({ needs_photos: true }), caseWith({ shouldRequestPhotos: true })).passed).toBe(true);
  });
  it("passes when needs_photos matches false", () => {
    expect(photosWhenExpected(baseQuote, caseWith({ shouldRequestPhotos: false })).passed).toBe(true);
  });
  it("fails when photos were expected but not requested", () => {
    expect(photosWhenExpected(baseQuote, caseWith({ shouldRequestPhotos: true })).passed).toBe(false);
  });
  it("fails when photos were not expected but requested", () => {
    expect(photosWhenExpected(quoteWith({ needs_photos: true }), caseWith({ shouldRequestPhotos: false })).passed).toBe(false);
  });
});

describe("runAllChecks", () => {
  it("returns one result per check, all passing for a clean quote", () => {
    const results = runAllChecks(baseQuote, baseCase);
    expect(results).toHaveLength(ALL_CHECKS.length);
    expect(results.every((r) => r.passed)).toBe(true);
  });
  it("reports failures by check name", () => {
    const results = runAllChecks(quoteWith({ price_low: 300, price_high: 200 }), baseCase);
    expect(results.filter((r) => !r.passed).map((r) => r.name)).toEqual(["priceOrder"]);
  });
});
