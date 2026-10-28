// Fictional demo values: the business, prices and service area below are made up for this harness.

export const BUSINESS = {
  name: "Evergreen Haul-Away",
  serviceArea: ["Bellevue", "Kirkland", "Redmond", "Sammamish", "Issaquah"],
} as const;

export const PRICING = {
  minimumCharge: 99,
  maxQuote: 1200,
  perCubicYard: { low: 40, high: 70 },
} as const;

export const MODELS = {
  sut: "claude-haiku-5-5",
  judge: "claude-sonnet-5-5",
} as const;
