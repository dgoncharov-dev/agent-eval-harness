import { describe, expect, it } from "vitest";
import { ALL_CHECKS } from "../checks/index.js";
import type { Case } from "../checks/types.js";
import { NoToolUseError, QuoteValidationError, type QuoteUsage } from "../sut/quote.js";
import { QuoteSchema, type Quote } from "../sut/schema.js";
import { runAll, runCase, summarize, type QuoteFn } from "./run.js";

const quote: Quote = {
  items: ["old couch"],
  estimated_cubic_yards: 3,
  price_low: 120,
  price_high: 210,
  needs_photos: false,
  customer_message: "We can haul that for roughly $120-$210.",
};
const usage: QuoteUsage = { inputTokens: 60, outputTokens: 40 };

const makeCase = (id: string): Case => ({
  id,
  message: `message for ${id}`,
  expect: { inServiceArea: true, shouldRequestPhotos: null },
});

const okFn: QuoteFn = async () => ({ quote, usage });

function validationError(): QuoteValidationError {
  const result = QuoteSchema.safeParse({});
  if (result.success) throw new Error("expected empty object to fail QuoteSchema");
  return new QuoteValidationError(result.error.issues, {}, usage);
}

describe("runCase", () => {
  it("returns a completed result with check results and usage", async () => {
    const result = await runCase(makeCase("ok"), okFn);
    expect(result.status).toBe("completed");
    expect(result.quote).toEqual(quote);
    expect(result.checks).toHaveLength(ALL_CHECKS.length);
    expect(result.usage).toEqual(usage);
  });

  it("passes the case message to the quote function", async () => {
    let received = "";
    await runCase(makeCase("ok"), async (message) => {
      received = message;
      return { quote, usage };
    });
    expect(received).toBe("message for ok");
  });

  it("turns NoToolUseError into a format_error that keeps usage", async () => {
    const result = await runCase(makeCase("no-tool"), async () => {
      throw new NoToolUseError("end_turn", usage);
    });
    expect(result.status).toBe("format_error");
    expect(result.checks).toEqual([]);
    expect(result.error).toContain("tool_use");
    expect(result.usage).toEqual(usage);
  });

  it("turns QuoteValidationError into a format_error that keeps usage", async () => {
    const result = await runCase(makeCase("bad-shape"), async () => {
      throw validationError();
    });
    expect(result.status).toBe("format_error");
    expect(result.checks).toEqual([]);
    expect(result.error).toContain("QuoteSchema");
    expect(result.usage).toEqual(usage);
  });

  it("rethrows unexpected errors", async () => {
    await expect(
      runCase(makeCase("boom"), async () => {
        throw new Error("network down");
      }),
    ).rejects.toThrow("network down");
  });
});

describe("runAll", () => {
  it("runs every case when under budget", async () => {
    const report = await runAll([makeCase("a"), makeCase("b")], { quoteFn: okFn });
    expect(report.aborted).toBe(false);
    expect(report.skipped).toEqual([]);
    expect(report.results.map((r) => r.id)).toEqual(["a", "b"]);
  });

  it("runs cases one at a time", async () => {
    let inFlight = 0;
    let maxInFlight = 0;
    const quoteFn: QuoteFn = async () => {
      inFlight++;
      maxInFlight = Math.max(maxInFlight, inFlight);
      await new Promise((resolve) => setTimeout(resolve, 1));
      inFlight--;
      return { quote, usage };
    };
    await runAll([makeCase("a"), makeCase("b"), makeCase("c")], { quoteFn });
    expect(maxInFlight).toBe(1);
  });

  it("aborts and lists skipped cases once the token budget is exceeded", async () => {
    // Each call uses 100 tokens, so the budget of 150 is exceeded after the second case.
    const report = await runAll([makeCase("a"), makeCase("b"), makeCase("c"), makeCase("d")], {
      maxTotalTokens: 150,
      quoteFn: okFn,
    });
    expect(report.aborted).toBe(true);
    expect(report.results.map((r) => r.id)).toEqual(["a", "b"]);
    expect(report.skipped).toEqual(["c", "d"]);
  });

  it("counts tokens from format errors toward the budget", async () => {
    const quoteFn: QuoteFn = async () => {
      throw new NoToolUseError("end_turn", usage);
    };
    const report = await runAll([makeCase("a"), makeCase("b"), makeCase("c")], { maxTotalTokens: 150, quoteFn });
    expect(report.aborted).toBe(true);
    expect(report.results).toHaveLength(2);
  });
});

describe("summarize", () => {
  it("counts statuses, failed checks per name and token totals", async () => {
    const badQuote: Quote = { ...quote, price_low: 300, price_high: 200 };
    const results = [
      await runCase(makeCase("ok"), okFn),
      await runCase(makeCase("bad-price"), async () => ({ quote: badQuote, usage })),
      await runCase(makeCase("no-tool"), async () => {
        throw new NoToolUseError(null, usage);
      }),
    ];

    expect(summarize(results)).toEqual({
      completed: 2,
      formatErrors: 1,
      failedChecks: { priceOrder: 1 },
      totalInputTokens: 180,
      totalOutputTokens: 120,
    });
  });

  it("returns zeros for no results", () => {
    expect(summarize([])).toEqual({
      completed: 0,
      formatErrors: 0,
      failedChecks: {},
      totalInputTokens: 0,
      totalOutputTokens: 0,
    });
  });
});
