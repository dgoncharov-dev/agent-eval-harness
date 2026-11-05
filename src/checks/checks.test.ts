import { describe, expect, it } from "vitest";
import type { Quote } from "../sut/schema.js";
import { ALL_CHECKS, runAllChecks } from "./index.js";
import { canServeMatchesExpectation } from "./canServeMatchesExpectation.js";
import { itemsPresentWhenServing } from "./itemsPresentWhenServing.js";
import { noAvailabilityPromise } from "./noAvailabilityPromise.js";
import { noDiscountLanguage } from "./noDiscountLanguage.js";
import { noPriceInUnpricedMessage } from "./noPriceInUnpricedMessage.js";
import { photosWhenExpected } from "./photosWhenExpected.js";
import { priceableMatchesExpectation } from "./priceableMatchesExpectation.js";
import { priceOrder } from "./priceOrder.js";
import { priceWithinLimits } from "./priceWithinLimits.js";
import { serviceAreaHandling } from "./serviceAreaHandling.js";
import type { Case } from "./types.js";

const baseQuote: Quote = {
  can_serve: true,
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
  expect: { inServiceArea: true, canServe: true, shouldRequestPhotos: null },
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
  it("passes a decline with zero prices when can_serve is false", () => {
    const decline = quoteWith({ can_serve: false, price_low: 0, price_high: 0 });
    expect(priceWithinLimits(decline, baseCase).passed).toBe(true);
  });
  it("fails a decline with non-zero prices when can_serve is false", () => {
    const decline = quoteWith({ can_serve: false, price_low: 120, price_high: 210 });
    expect(priceWithinLimits(decline, baseCase).passed).toBe(false);
  });
  it("fails zero prices when can_serve is true", () => {
    expect(priceWithinLimits(quoteWith({ price_low: 0, price_high: 0 }), baseCase).passed).toBe(false);
  });
  it("passes zero prices when can_serve is true and photos are requested", () => {
    const unsizable = quoteWith({ price_low: 0, price_high: 0, needs_photos: true });
    expect(priceWithinLimits(unsizable, baseCase).passed).toBe(true);
  });
  it("fails a zero price_low with a real price_high even when photos are requested", () => {
    const partial = quoteWith({ price_low: 0, price_high: 500, needs_photos: true });
    expect(priceWithinLimits(partial, baseCase).passed).toBe(false);
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

  it("passes a refusal phrased with \"aren't able\" followed by 'but' and an unrelated clause", () => {
    const quote = saying(
      "Unfortunately, we aren't able to match other companies' prices or offer discounts, but we'd be happy to provide our service.",
    );
    expect(noDiscountLanguage(quote, baseCase).passed).toBe(true);
  });
  it("passes \"We are not able to offer discounts.\"", () => {
    expect(noDiscountLanguage(saying("We are not able to offer discounts."), baseCase).passed).toBe(true);
  });
  it.each([
    "We aren't able to offer discounts.",
    "We are not able to offer discounts.",
    "Our team isn't able to offer discounts.",
    "Our team is not able to offer discounts.",
    "We won't offer discounts.",
    "We will not offer discounts.",
    "We wouldn't offer discounts.",
    "We would not offer discounts.",
    "We couldn't offer discounts.",
    "We could not offer discounts.",
  ])("treats a refusal as a refusal: %s", (message) => {
    expect(noDiscountLanguage(saying(message), baseCase).passed).toBe(true);
  });
  it.each(["We can offer a discount.", "Happy to give you a discount.", "We will offer a discount."])(
    "still fails a plain offer: %s",
    (message) => {
      expect(noDiscountLanguage(saying(message), baseCase).passed).toBe(false);
    },
  );
  it("still fails when an extended refusal is followed by an offer after 'but'", () => {
    const quote = saying("We aren't able to offer discounts, but we do price matching.");
    expect(noDiscountLanguage(quote, baseCase).passed).toBe(false);
  });
  it("passes a refusal whose clause is followed by 'but' and an unrelated clause", () => {
    const quote = saying(
      "We're not able to match other companies' prices or offer discounts, but we're happy to give you a clear quote.",
    );
    expect(noDiscountLanguage(quote, baseCase).passed).toBe(true);
  });
  it("fails when 'No problem!' precedes a coupon offer (bare 'no' is not a refusal)", () => {
    const quote = saying("No problem! Happy to give you a 10% off coupon.");
    expect(noDiscountLanguage(quote, baseCase).passed).toBe(false);
  });

  // Known limitation: clauses are not split at commas, so a negation about something else
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

  it("passes a refusal to promise a time", () => {
    expect(noAvailabilityPromise(saying("We can't promise a time today."), baseCase).passed).toBe(true);
  });
  it("passes a refusal that also mentions the disclaimer", () => {
    const quote = saying("I can't confirm a 3pm arrival, since scheduling is confirmed separately.");
    expect(noAvailabilityPromise(quote, baseCase).passed).toBe(true);
  });
  it("passes a disclaimer that mentions a day", () => {
    const quote = saying("Scheduling for this Saturday will be confirmed separately.");
    expect(noAvailabilityPromise(quote, baseCase).passed).toBe(true);
  });
  it("fails a promise to lock in a time for today", () => {
    const quote = saying("Our team will reach out to lock in a time for today.");
    expect(noAvailabilityPromise(quote, baseCase).passed).toBe(false);
  });
  it("fails a promise in a later sentence even when an earlier one is a refusal", () => {
    const quote = saying("I can't confirm a time. We'll be there tomorrow.");
    expect(noAvailabilityPromise(quote, baseCase).passed).toBe(false);
  });

  it("fails a promise after 'but' even when the first half is a disclaimer", () => {
    const quote = saying("Scheduling is confirmed separately, but we'll be there tomorrow at 3pm.");
    expect(noAvailabilityPromise(quote, baseCase).passed).toBe(false);
  });
  it("fails a promise after 'but' following a refusal", () => {
    const quote = saying("I can't promise a window, but we'll be there tomorrow.");
    expect(noAvailabilityPromise(quote, baseCase).passed).toBe(false);
  });

  // Known limitation: the exemption applies to the whole sentence, so a disclaimer
  // ("confirmed separately") shields a real promise joined to it by anything other than "but"/"however".
  it.fails("catches a promise joined to the disclaimer with 'and'", () => {
    const quote = saying("Scheduling is confirmed separately and we'll be there tomorrow at 3pm.");
    expect(noAvailabilityPromise(quote, baseCase).passed).toBe(false);
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

describe("canServeMatchesExpectation", () => {
  it("passes when can_serve matches inServiceArea true", () => {
    expect(canServeMatchesExpectation(baseQuote, baseCase).passed).toBe(true);
  });
  it("passes when can_serve false matches canServe false", () => {
    const decline = quoteWith({ can_serve: false, price_low: 0, price_high: 0 });
    expect(canServeMatchesExpectation(decline, caseWith({ inServiceArea: false, canServe: false })).passed).toBe(true);
  });
  it("passes a decline for an in-area customer whose request is all hazardous", () => {
    const decline = quoteWith({ can_serve: false, price_low: 0, price_high: 0 });
    expect(canServeMatchesExpectation(decline, caseWith({ inServiceArea: true, canServe: false })).passed).toBe(true);
  });
  it("ignores inServiceArea and compares against canServe", () => {
    expect(canServeMatchesExpectation(baseQuote, caseWith({ inServiceArea: false, canServe: true })).passed).toBe(true);
  });
  it("fails when the assistant quotes a customer who cannot be served", () => {
    expect(canServeMatchesExpectation(baseQuote, caseWith({ inServiceArea: false, canServe: false })).passed).toBe(false);
  });
  it("fails when the assistant declines a customer who can be served", () => {
    const decline = quoteWith({ can_serve: false, price_low: 0, price_high: 0 });
    expect(canServeMatchesExpectation(decline, baseCase).passed).toBe(false);
  });
});

describe("itemsPresentWhenServing", () => {
  it("passes when serving with items listed", () => {
    expect(itemsPresentWhenServing(baseQuote, baseCase).passed).toBe(true);
  });
  it("passes a decline with an empty items list", () => {
    const decline = quoteWith({ can_serve: false, items: [], price_low: 0, price_high: 0 });
    expect(itemsPresentWhenServing(decline, baseCase).passed).toBe(true);
  });
  it("fails when serving with no items", () => {
    expect(itemsPresentWhenServing(quoteWith({ items: [] }), baseCase).passed).toBe(false);
  });
});

describe("priceableMatchesExpectation", () => {
  const unpriced = quoteWith({ price_low: 0, price_high: 0, needs_photos: true });

  it("passes with no expectation (absent or null)", () => {
    expect(priceableMatchesExpectation(unpriced, baseCase).passed).toBe(true);
    expect(priceableMatchesExpectation(unpriced, caseWith({ priceable: null })).passed).toBe(true);
  });
  it("priceable true: passes a non-zero price within limits", () => {
    expect(priceableMatchesExpectation(baseQuote, caseWith({ priceable: true })).passed).toBe(true);
  });
  it("priceable true: fails zero prices", () => {
    expect(priceableMatchesExpectation(unpriced, caseWith({ priceable: true })).passed).toBe(false);
  });
  it("priceable true: fails a price above the max quote", () => {
    const tooHigh = quoteWith({ price_high: 1500 });
    expect(priceableMatchesExpectation(tooHigh, caseWith({ priceable: true })).passed).toBe(false);
  });
  it("priceable false: passes zero prices with photos requested", () => {
    expect(priceableMatchesExpectation(unpriced, caseWith({ priceable: false })).passed).toBe(true);
  });
  it("priceable false: fails when a price is given", () => {
    expect(priceableMatchesExpectation(baseQuote, caseWith({ priceable: false })).passed).toBe(false);
  });
  it("priceable false: fails zero prices without a photo request", () => {
    const noPhotos = quoteWith({ price_low: 0, price_high: 0, needs_photos: false });
    expect(priceableMatchesExpectation(noPhotos, caseWith({ priceable: false })).passed).toBe(false);
  });
});

describe("noPriceInUnpricedMessage", () => {
  const unpriced = (customer_message: string): Quote =>
    quoteWith({ price_low: 0, price_high: 0, needs_photos: true, customer_message });

  it("passes an unpriced message that only names the $99 minimum", () => {
    const quote = unpriced("Please send photos. Our $99 minimum applies, and we'll quote after we see the load.");
    expect(noPriceInUnpricedMessage(quote, baseCase).passed).toBe(true);
  });
  it("passes '99 dollars' as the minimum", () => {
    expect(noPriceInUnpricedMessage(unpriced("The minimum is 99 dollars."), baseCase).passed).toBe(true);
  });
  it("passes an unpriced message with no amounts", () => {
    expect(noPriceInUnpricedMessage(unpriced("Could you send a few photos?"), baseCase).passed).toBe(true);
  });
  it("passes a decline (can_serve false) that names the minimum", () => {
    const decline = quoteWith({
      can_serve: false,
      price_low: 0,
      price_high: 0,
      customer_message: "Sorry, that is outside our service area. Our minimum is $99.",
    });
    expect(noPriceInUnpricedMessage(decline, baseCase).passed).toBe(true);
  });
  it("passes a priced quote naming its price range", () => {
    const priced = saying("We can haul that for roughly $400 to $700.");
    expect(noPriceInUnpricedMessage(priced, baseCase).passed).toBe(true);
  });
  it("fails '$400 to $700' in an unpriced message", () => {
    const quote = unpriced("Send photos please. Typically that runs $400 to $700.");
    expect(noPriceInUnpricedMessage(quote, baseCase).passed).toBe(false);
  });
  it("fails a comma-grouped amount like $1,200", () => {
    expect(noPriceInUnpricedMessage(unpriced("It could reach $1,200."), baseCase).passed).toBe(false);
  });
  it("fails 'N dollars' other than the minimum", () => {
    expect(noPriceInUnpricedMessage(unpriced("Probably around 500 dollars."), baseCase).passed).toBe(false);
  });
  it("fails when the minimum appears alongside another amount", () => {
    const quote = unpriced("Our $99 minimum applies, but expect about $600 for a full garage.");
    expect(noPriceInUnpricedMessage(quote, baseCase).passed).toBe(false);
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
