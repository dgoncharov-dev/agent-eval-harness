import { describe, expect, it } from "vitest";
import type { Case } from "../checks/types.js";
import { JudgeNoToolUseError, JudgeValidationError } from "../judge/judge.js";
import { JudgmentSchema, type Judgment } from "../judge/schema.js";
import { NoToolUseError, type QuoteUsage } from "../sut/quote.js";
import type { Quote } from "../sut/schema.js";
import { runAll, summarize, type JudgeFn, type QuoteFn } from "./run.js";

const quote: Quote = {
  can_serve: true,
  items: ["old couch"],
  estimated_cubic_yards: 3,
  price_low: 120,
  price_high: 210,
  needs_photos: false,
  customer_message: "We can haul that for roughly $120-$210.",
};
const sutUsage: QuoteUsage = { inputTokens: 60, outputTokens: 40 };
const judgeUsage: QuoteUsage = { inputTokens: 100, outputTokens: 20 };

const judgment: Judgment = {
  gates: {
    load_size: { pass: true, reason: "ok" },
    commitments: { pass: true, reason: "ok" },
    hazardous: { pass: true, reason: "ok" },
  },
  quality: {
    uncertainty_handling: { score: 3, reason: "ok" },
    answers_and_next_step: { score: 3, reason: "ok" },
    tone_brevity: { score: 3, reason: "ok" },
  },
};

const makeCase = (id: string): Case => ({
  id,
  message: `message for ${id}`,
  expect: { inServiceArea: true, canServe: true, shouldRequestPhotos: null },
});

const okQuote: QuoteFn = async () => ({ quote, usage: sutUsage });
const okJudge: JudgeFn = async () => ({ judgment, usage: judgeUsage });
const authError = (status: number) => Object.assign(new Error(`HTTP ${status}`), { status });

// Wraps a function so tests can see how many times, and with what, it was called.
function spy<A extends unknown[], R>(fn: (...args: A) => R) {
  const calls: A[] = [];
  return {
    calls,
    fn: (...args: A): R => {
      calls.push(args);
      return fn(...args);
    },
  };
}

function validationError(): JudgeValidationError {
  const result = JudgmentSchema.safeParse({});
  if (result.success) throw new Error("expected an empty object to fail JudgmentSchema");
  return new JudgeValidationError(result.error.issues, {}, { inputTokens: 90, outputTokens: 10 });
}

describe("runAll with the judge off", () => {
  it("makes zero judge calls even when a judgeFn is supplied", async () => {
    const judge = spy(okJudge);
    const report = await runAll([makeCase("a"), makeCase("b")], { repeats: 2, quoteFn: okQuote, judgeFn: judge.fn });
    expect(judge.calls).toHaveLength(0);
    expect(report.cases.flatMap((c) => c.attempts).every((a) => a.judgment === undefined && !a.notJudged)).toBe(true);
    expect(report.judgeMaxTokens).toBeUndefined();
    expect("judge" in summarize(report)).toBe(false);
  });
});

describe("runAll with the judge on", () => {
  it("judges each attempt that has a quote, passing the case and the quote", async () => {
    const judge = spy(okJudge);
    const quoteFn: QuoteFn = async (message) => {
      if (message === "message for broken") throw new NoToolUseError("end_turn", sutUsage);
      return { quote, usage: sutUsage };
    };
    const report = await runAll([makeCase("a"), makeCase("broken")], {
      repeats: 2,
      quoteFn,
      judge: true,
      judgeFn: judge.fn,
    });
    expect(judge.calls).toHaveLength(2);
    expect(judge.calls[0]?.[0].id).toBe("a");
    expect(judge.calls[0]?.[1]).toEqual(quote);

    const [a, broken] = report.cases;
    expect(a?.attempts.every((x) => x.judgment !== undefined)).toBe(true);
    expect(broken?.attempts.every((x) => x.judgment === undefined && x.notJudged === undefined)).toBe(true);
  });

  it("keeps judge usage in its own totals, separate from SUT totals", async () => {
    const report = await runAll([makeCase("a"), makeCase("b")], {
      repeats: 2,
      quoteFn: okQuote,
      judge: true,
      judgeFn: okJudge,
    });
    const summary = summarize(report);
    expect(summary.totalInputTokens).toBe(240);
    expect(summary.totalOutputTokens).toBe(160);
    expect(summary.judge?.usage).toEqual({ inputTokens: 400, outputTokens: 80 });
    expect(report.cases[0]?.attempts[0]?.usage).toEqual(sutUsage);
  });

  it.each([
    ["no_tool", () => new JudgeNoToolUseError("end_turn", { inputTokens: 90, outputTokens: 10 })],
    ["invalid_shape", validationError],
    ["api_error", () => new Error("overloaded")],
  ] as const)("records a %s judge error without changing the deterministic result", async (kind, makeError) => {
    const judgeFn: JudgeFn = async () => {
      throw makeError();
    };
    const plain = await runAll([makeCase("a")], { repeats: 2, quoteFn: okQuote });
    const judged = await runAll([makeCase("a")], { repeats: 2, quoteFn: okQuote, judge: true, judgeFn });

    const [attempt] = judged.cases[0]?.attempts ?? [];
    expect(attempt?.judgeError?.kind).toBe(kind);
    expect(attempt?.judgment).toBeUndefined();
    expect(attempt?.outcome).toBe("passed");
    expect(attempt?.checks).toEqual(plain.cases[0]?.attempts[0]?.checks);
    expect(judged.cases[0]?.passRate).toBe(plain.cases[0]?.passRate);
    expect(summarize(judged).judge?.judgeErrors).toBe(2);
  });

  it("counts the usage of typed judge errors, and none for an untyped one", async () => {
    const typed = await runAll([makeCase("a")], {
      quoteFn: okQuote,
      judge: true,
      judgeFn: async () => {
        throw validationError();
      },
    });
    const untyped = await runAll([makeCase("a")], {
      quoteFn: okQuote,
      judge: true,
      judgeFn: async () => {
        throw new Error("overloaded");
      },
    });
    expect(summarize(typed).judge?.usage).toEqual({ inputTokens: 90, outputTokens: 10 });
    expect(summarize(untyped).judge?.usage).toEqual({ inputTokens: 0, outputTokens: 0 });
  });

  it.each([401, 403])("rethrows a judge authentication error (status %i)", async (status) => {
    const judgeFn: JudgeFn = async () => {
      throw authError(status);
    };
    await expect(runAll([makeCase("a")], { quoteFn: okQuote, judge: true, judgeFn })).rejects.toThrow(`HTTP ${status}`);
  });

  it("stops judge calls, not SUT calls, once the judge budget is exceeded", async () => {
    const sut = spy(okQuote);
    const judge = spy(okJudge); // 120 tokens per call
    const report = await runAll([makeCase("a"), makeCase("b"), makeCase("c"), makeCase("d")], {
      quoteFn: sut.fn,
      judge: true,
      judgeFn: judge.fn,
      maxJudgeTokens: 150,
    });

    // 120 <= 150 so the second call still happens; 240 > 150 so the third and fourth are skipped.
    expect(judge.calls).toHaveLength(2);
    expect(sut.calls).toHaveLength(4);
    expect(report.aborted).toBe(false);
    expect(report.cases.map((c) => c.attempts[0]?.notJudged ?? false)).toEqual([false, false, true, true]);
    expect(report.cases[2]?.attempts[0]?.judgment).toBeUndefined();
    expect(report.cases[2]?.attempts[0]?.outcome).toBe("passed");
    expect(summarize(report).judge).toMatchObject({ judged: 2, notJudged: 2 });
  });

  it("defaults the judge budget to attempts x 5000", async () => {
    const report = await runAll([makeCase("a"), makeCase("b")], {
      repeats: 3,
      quoteFn: okQuote,
      judge: true,
      judgeFn: okJudge,
    });
    expect(report.judgeMaxTokens).toBe(2 * 3 * 5000);
  });

  it("uses an explicit maxJudgeTokens and rejects a non-positive one", async () => {
    const report = await runAll([makeCase("a")], { quoteFn: okQuote, judge: true, judgeFn: okJudge, maxJudgeTokens: 777 });
    expect(report.judgeMaxTokens).toBe(777);
    await expect(
      runAll([makeCase("a")], { quoteFn: okQuote, judge: true, judgeFn: okJudge, maxJudgeTokens: 0 }),
    ).rejects.toThrow(RangeError);
  });
});
