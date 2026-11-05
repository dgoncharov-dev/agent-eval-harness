import { z } from "zod";

export const QuoteSchema = z.object({
  can_serve: z
    .boolean()
    .describe("False when the request is outside the service area or contains nothing the business can take; then set prices to 0"),
  items: z.array(z.string()).min(1).describe("Items to be removed, one entry per item or group"),
  estimated_cubic_yards: z.number().min(0).describe("Estimated total volume of the load in cubic yards"),
  price_low: z.number().min(0).describe("Low end of the quoted price range in USD"),
  price_high: z.number().min(0).describe("High end of the quoted price range in USD"),
  needs_photos: z.boolean().describe("Whether the customer should send photos before a firm quote"),
  customer_message: z.string().min(1).describe("Reply text shown to the customer"),
});

export type Quote = z.infer<typeof QuoteSchema>;
