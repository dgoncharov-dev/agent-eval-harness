import { describe, expect, it } from "vitest";
import { QuoteSchema } from "./schema.js";

const validQuote = {
  items: ["old couch", "mattress"],
  estimated_cubic_yards: 3,
  price_low: 120,
  price_high: 210,
  needs_photos: false,
  customer_message: "We can haul both for roughly $120-$210.",
};

describe("QuoteSchema", () => {
  it("parses a valid quote", () => {
    expect(QuoteSchema.safeParse(validQuote).success).toBe(true);
  });

  it("rejects a quote with a missing price_low", () => {
    const { price_low: _omitted, ...withoutPriceLow } = validQuote;
    expect(QuoteSchema.safeParse(withoutPriceLow).success).toBe(false);
  });

  it("rejects a negative price", () => {
    expect(QuoteSchema.safeParse({ ...validQuote, price_high: -5 }).success).toBe(false);
  });
});
