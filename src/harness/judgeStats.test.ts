import { describe, expect, it } from "vitest";
import type { Judgment } from "../judge/schema.js";
import { findDisagreements, gateCounts, judgeCrossTable, summarizeJudge } from "./judgeStats.js";
import type { CaseAggregate, CaseResult, Outcome, RunReport } from "./run.js";

const sutUsage = { inputTokens: 60, outputTokens: 40 };

function judgmentOf(
  failedGate: "load_size" | "commitments" | "hazardous" | null,
  reason: string,
  quality: [1 | 2 | 3, 1 | 2 | 3, 1 | 2 | 3],
): Judgment {
  const gate = (name: "load_size" | "commitments" | "hazardous") =>
    name === failedGate ? { pass: false, reason } : { pass: true, reason: "fine" };
  return {
    gates: { load_size: gate("load_size"), commitments: gate("commitments"), hazardous: gate("hazardous") },
    quality: {
      uncertainty_handling: { score: quality[0], reason: "x" },
      answers_and_next_step: { score: quality[1], reason: "x" },
      tone_brevity: { score: quality[2], reason: "x" },
    },
  };
}

function attempt(id: string, outcome: Outcome, extra: Partial<CaseResult> = {}): CaseResult {
  return { id, outcome, checks: [], usage: sutUsage, ...extra };
}

const judged = { judgeUsage: { inputTokens: 100, outputTokens: 10 } };

const caseA: CaseAggregate = {
  id: "case-a",
  passRate: 2 / 3,
  outcomes: { passed: 2, failed_checks: 1, format_error: 0, refusal: 0, api_error: 0 },
  attempts: [
    // A1: checks pass, judge passes everything.
    attempt("case-a", "passed", { ...judged, judgment: judgmentOf(null, "", [3, 2, 3]) }),
    // A2: checks fail, judge fails commitments: they agree.
    attempt("case-a", "failed_checks", {
      ...judged,
      checks: [{ name: "noAvailabilityPromise", passed: false, detail: "promised today" }],
      judgment: judgmentOf("commitments", "promised same-day pickup", [1, 2, 3]),
    }),
    // A3: checks pass, judge fails load_size: disagreement.
    attempt("case-a", "passed", { ...judged, judgment: judgmentOf("load_size", "underpriced for a full garage", [2, 2, 3]) }),
  ],
};

const caseB: CaseAggregate = {
  id: "case-b",
  passRate: 0.5,
  outcomes: { passed: 2, failed_checks: 1, format_error: 1, refusal: 0, api_error: 0 },
  attempts: [
    // B1: checks fail, judge passes everything: disagreement.
    attempt("case-b", "failed_checks", {
      ...judged,
      checks: [
        { name: "priceOrder", passed: false, detail: "low above high" },
        { name: "noDiscountLanguage", passed: true, detail: "ok" },
      ],
      judgment: judgmentOf(null, "", [2, 2, 1]),
    }),
    // B2: no quote, so never judged.
    attempt("case-b", "format_error"),
    // B3: judge call failed.
    attempt("case-b", "passed", {
      judgeUsage: { inputTokens: 50, outputTokens: 5 },
      judgeError: { kind: "no_tool", message: "no tool" },
    }),
    // B4: judge budget was used up.
    attempt("case-b", "passed", { notJudged: true }),
  ],
};

const report: RunReport = { cases: [caseA, caseB], aborted: false, skipped: [], judgeMaxTokens: 1000 };

describe("gateCounts", () => {
  it("counts gate passes over judged attempts only", () => {
    expect(gateCounts(caseA.attempts)).toEqual({
      load_size: { pass: 2, total: 3 },
      commitments: { pass: 2, total: 3 },
      hazardous: { pass: 3, total: 3 },
    });
    expect(gateCounts(caseB.attempts).load_size).toEqual({ pass: 1, total: 1 });
  });
});

describe("summarizeJudge", () => {
  const summary = summarizeJudge(report);

  it("counts judged attempts and attempts where every gate passed", () => {
    expect(summary.judged).toBe(4);
    expect(summary.allGatesPassed).toBe(2);
  });

  it("computes per-gate pass counts and rates", () => {
    expect(summary.gates.load_size).toEqual({ pass: 3, total: 4, rate: 0.75 });
    expect(summary.gates.commitments).toEqual({ pass: 3, total: 4, rate: 0.75 });
    expect(summary.gates.hazardous).toEqual({ pass: 4, total: 4, rate: 1 });
  });

  it("computes the mean quality score per criterion over judged attempts", () => {
    expect(summary.quality).toEqual({
      uncertainty_handling: (3 + 1 + 2 + 2) / 4,
      answers_and_next_step: 2,
      tone_brevity: (3 + 3 + 3 + 1) / 4,
    });
  });

  it("counts judge errors and not-judged attempts, and sums judge usage including errors", () => {
    expect(summary.judgeErrors).toBe(1);
    expect(summary.notJudged).toBe(1);
    expect(summary.usage).toEqual({ inputTokens: 450, outputTokens: 45 });
  });

  it("returns null quality means and zero rates when nothing was judged", () => {
    const empty = summarizeJudge({ cases: [{ ...caseB, attempts: [attempt("case-b", "format_error")] }], aborted: false, skipped: [] });
    expect(empty.judged).toBe(0);
    expect(empty.quality).toEqual({ uncertainty_handling: null, answers_and_next_step: null, tone_brevity: null });
    expect(empty.gates.load_size).toEqual({ pass: 0, total: 0, rate: 0 });
  });
});

describe("judgeCrossTable", () => {
  it("cross-tabulates deterministic verdict by judge verdict over judged attempts", () => {
    expect(judgeCrossTable(report)).toEqual({
      checksPass: { judgePass: 1, judgeFail: 1 },
      checksFail: { judgePass: 1, judgeFail: 1 },
    });
  });
});

describe("findDisagreements", () => {
  it("lists attempts where checks and judge differ, in case and attempt order", () => {
    expect(findDisagreements(report)).toEqual([
      {
        caseId: "case-a",
        attempt: 3,
        checksPassed: true,
        failedChecks: [],
        failedGates: [{ gate: "load_size", reason: "underpriced for a full garage" }],
      },
      {
        caseId: "case-b",
        attempt: 1,
        checksPassed: false,
        failedChecks: ["priceOrder"],
        failedGates: [],
      },
    ]);
  });

  it("is empty when every judged attempt agrees", () => {
    expect(findDisagreements({ cases: [{ ...caseA, attempts: caseA.attempts.slice(0, 2) }], aborted: false, skipped: [] })).toEqual([]);
  });
});
