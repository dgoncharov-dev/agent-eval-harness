import { describe, expect, it } from "vitest";
import { ALL_CHECKS } from "../checks/index.js";
import type { Case } from "../checks/types.js";
import { NoToolUseError, QuoteValidationError, type QuoteUsage } from "../sut/quote.js";
import { QuoteSchema, type Quote } from "../sut/schema.js";
import { runAll, runCase, summarize, type QuoteFn } from "./run.js";

const quote: Quote = {
  can_serve: true,
  items: ["old couch"],
  estimated_cubic_yards: 3,
  price_low: 120,
  price_high: 210,
  needs_photos: false,
  customer_message: "We can haul that for roughly $120-$210.",
};
// Fails priceOrder only.
const badPriceQuote: Quote = { ...quote, price_low: 300, price_high: 200 };
const usage: QuoteUsage = { inputTokens: 60, outputTokens: 40 };

const makeCase = (id: string): Case => ({
  id,
  message: `message for ${id}`,
  expect: { inServiceArea: true, canServe: true, shouldRequestPhotos: null },
});

const okFn: QuoteFn = async () => ({ quote, usage });

function validationError(): QuoteValidationError {
  const result = QuoteSchema.safeParse({});
  if (result.success) throw new Error("expected empty object to fail QuoteSchema");
  return new QuoteValidationError(result.error.issues, {}, usage);
}

const authError = (status: number) => Object.assign(new Error(`HTTP ${status}`), { status });

describe("runCase outcomes", () => {
  it("passed: completed and every check passes", async () => {
    const result = await runCase(makeCase("ok"), okFn);
    expect(result.outcome).toBe("passed");
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

  it("failed_checks: completed with at least one failed check", async () => {
    const result = await runCase(makeCase("bad-price"), async () => ({ quote: badPriceQuote, usage }));
    expect(result.outcome).toBe("failed_checks");
    expect(result.checks.filter((c) => !c.passed).map((c) => c.name)).toEqual(["priceOrder"]);
  });

  it("format_error: NoToolUseError that is not a refusal, keeping usage", async () => {
    const result = await runCase(makeCase("no-tool"), async () => {
      throw new NoToolUseError("end_turn", usage);
    });
    expect(result.outcome).toBe("format_error");
    expect(result.checks).toEqual([]);
    expect(result.error).toContain("tool_use");
    expect(result.usage).toEqual(usage);
  });

  it("format_error: QuoteValidationError, keeping usage", async () => {
    const result = await runCase(makeCase("bad-shape"), async () => {
      throw validationError();
    });
    expect(result.outcome).toBe("format_error");
    expect(result.checks).toEqual([]);
    expect(result.error).toContain("QuoteSchema");
    expect(result.usage).toEqual(usage);
  });

  it("refusal: NoToolUseError with stopReason refusal is classified separately", async () => {
    const refused = await runCase(makeCase("refused"), async () => {
      throw new NoToolUseError("refusal", usage);
    });
    const malformed = await runCase(makeCase("malformed"), async () => {
      throw new NoToolUseError("max_tokens", usage);
    });
    expect(refused.outcome).toBe("refusal");
    expect(refused.usage).toEqual(usage);
    expect(malformed.outcome).toBe("format_error");
  });

  it("api_error: any other error, with zero usage and the message", async () => {
    const result = await runCase(makeCase("boom"), async () => {
      throw new Error("network down");
    });
    expect(result.outcome).toBe("api_error");
    expect(result.checks).toEqual([]);
    expect(result.error).toBe("network down");
    expect(result.usage).toEqual({ inputTokens: 0, outputTokens: 0 });
  });

  it.each([401, 403])("rethrows an authentication error (status %i)", async (status) => {
    await expect(
      runCase(makeCase("auth"), async () => {
        throw authError(status);
      }),
    ).rejects.toThrow(`HTTP ${status}`);
  });

  it("does not treat other HTTP statuses as authentication errors", async () => {
    const result = await runCase(makeCase("rate-limit"), async () => {
      throw authError(429);
    });
    expect(result.outcome).toBe("api_error");
  });
});

describe("runAll", () => {
  it("runs each case once by default", async () => {
    const report = await runAll([makeCase("a"), makeCase("b")], { quoteFn: okFn });
    expect(report.aborted).toBe(false);
    expect(report.skipped).toEqual([]);
    expect(report.cases.map((c) => [c.id, c.attempts.length])).toEqual([
      ["a", 1],
      ["b", 1],
    ]);
  });

  it("computes passRate across repeats", async () => {
    let calls = 0;
    const quoteFn: QuoteFn = async () => {
      calls++;
      return { quote: calls % 2 === 1 ? quote : badPriceQuote, usage };
    };
    const report = await runAll([makeCase("a")], { repeats: 4, quoteFn });
    const [only] = report.cases;
    expect(only?.attempts).toHaveLength(4);
    expect(only?.passRate).toBe(0.5);
    expect(only?.outcomes).toEqual({ passed: 2, failed_checks: 2, format_error: 0, refusal: 0, api_error: 0 });
  });

  it("runs one call at a time, case by case", async () => {
    let inFlight = 0;
    let maxInFlight = 0;
    const order: string[] = [];
    const quoteFn: QuoteFn = async (message) => {
      inFlight++;
      maxInFlight = Math.max(maxInFlight, inFlight);
      order.push(message);
      await new Promise((resolve) => setTimeout(resolve, 1));
      inFlight--;
      return { quote, usage };
    };
    await runAll([makeCase("a"), makeCase("b")], { repeats: 2, quoteFn });
    expect(maxInFlight).toBe(1);
    expect(order).toEqual(["message for a", "message for a", "message for b", "message for b"]);
  });

  it("continues to the next attempt after an api_error", async () => {
    let calls = 0;
    const quoteFn: QuoteFn = async () => {
      calls++;
      if (calls === 1) throw new Error("overloaded");
      return { quote, usage };
    };
    const report = await runAll([makeCase("a")], { repeats: 2, quoteFn });
    const [only] = report.cases;
    expect(only?.attempts.map((a) => a.outcome)).toEqual(["api_error", "passed"]);
    expect(only?.passRate).toBe(0.5);
  });

  it("rethrows an authentication error and stops calling the API", async () => {
    let calls = 0;
    const quoteFn: QuoteFn = async () => {
      calls++;
      throw authError(401);
    };
    await expect(runAll([makeCase("a"), makeCase("b")], { repeats: 3, quoteFn })).rejects.toThrow("HTTP 401");
    expect(calls).toBe(1);
  });

  it("aborts across repeats, keeping the partial case and listing unstarted cases", async () => {
    // 100 tokens per call, budget 250: exceeded on the third call (case b, attempt 1 of 2).
    const report = await runAll([makeCase("a"), makeCase("b"), makeCase("c")], {
      repeats: 2,
      maxTotalTokens: 250,
      quoteFn: okFn,
    });
    expect(report.aborted).toBe(true);
    expect(report.cases.map((c) => [c.id, c.attempts.length])).toEqual([
      ["a", 2],
      ["b", 1],
    ]);
    expect(report.cases[1]?.passRate).toBe(1);
    expect(report.skipped).toEqual(["c"]);
  });

  it("counts tokens from failed attempts toward the budget", async () => {
    const quoteFn: QuoteFn = async () => {
      throw new NoToolUseError("end_turn", usage);
    };
    const report = await runAll([makeCase("a"), makeCase("b"), makeCase("c")], { maxTotalTokens: 150, quoteFn });
    expect(report.aborted).toBe(true);
    expect(report.cases).toHaveLength(2);
    expect(report.skipped).toEqual(["c"]);
  });

  it("is not aborted when the budget is exceeded only by the last attempt", async () => {
    const report = await runAll([makeCase("a")], { repeats: 2, maxTotalTokens: 150, quoteFn: okFn });
    expect(report.aborted).toBe(false);
    expect(report.cases[0]?.attempts).toHaveLength(2);
  });

  it("rejects a non-positive or non-integer repeats", async () => {
    await expect(runAll([makeCase("a")], { repeats: 0, quoteFn: okFn })).rejects.toThrow(RangeError);
    await expect(runAll([makeCase("a")], { repeats: 1.5, quoteFn: okFn })).rejects.toThrow(RangeError);
  });
});

describe("summarize", () => {
  it("totals outcomes, failed checks, pass rate and tokens", async () => {
    const byMessage: Record<string, QuoteFn> = {
      "message for ok": okFn,
      "message for bad-price": async () => ({ quote: badPriceQuote, usage }),
      "message for no-tool": async () => {
        throw new NoToolUseError("end_turn", usage);
      },
      "message for refused": async () => {
        throw new NoToolUseError("refusal", usage);
      },
      "message for api": async () => {
        throw new Error("overloaded");
      },
    };
    const quoteFn: QuoteFn = (message) => {
      const fn = byMessage[message];
      if (!fn) throw new Error(`no stub for ${message}`);
      return fn(message);
    };
    const cases = ["ok", "bad-price", "no-tool", "refused", "api"].map(makeCase);
    const report = await runAll(cases, { quoteFn });

    expect(summarize(report)).toEqual({
      attempts: 5,
      outcomes: { passed: 1, failed_checks: 1, format_error: 1, refusal: 1, api_error: 1 },
      failedChecks: { priceOrder: 1 },
      passRate: 0.2,
      totalInputTokens: 240,
      totalOutputTokens: 160,
    });
  });

  it("returns zeros for an empty report", () => {
    expect(summarize({ cases: [], aborted: false, skipped: [] })).toEqual({
      attempts: 0,
      outcomes: { passed: 0, failed_checks: 0, format_error: 0, refusal: 0, api_error: 0 },
      failedChecks: {},
      passRate: 0,
      totalInputTokens: 0,
      totalOutputTokens: 0,
    });
  });
});
