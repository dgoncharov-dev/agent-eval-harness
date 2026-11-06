import { describe, expect, it } from "vitest";
import { parseBaselineRunFile, parseRunFile } from "./reportFile.js";

const outcomes = { passed: 1, failed_checks: 0, format_error: 0, refusal: 0, api_error: 0 };

// Shape written by run-eval before the judge existed.
const oldReport = {
  timestamp: "2026-11-05T18:21:09.166Z",
  model: "claude-haiku-5-5",
  repeats: 5,
  maxTokens: 200000,
  cases: [
    {
      id: "clear-small-load",
      attempts: [{ id: "clear-small-load", outcome: "passed", checks: [], usage: { inputTokens: 1, outputTokens: 1 } }],
      passRate: 1,
      outcomes,
    },
  ],
  aborted: false,
  skipped: [],
  summary: { attempts: 1, outcomes, failedChecks: {}, passRate: 1, totalInputTokens: 1, totalOutputTokens: 1 },
};

describe("parseRunFile", () => {
  it("loads a report written before the judge existed", () => {
    const run = parseRunFile(oldReport, "old.json");
    expect(run.cases[0]?.id).toBe("clear-small-load");
    expect(run.summary.outcomes.passed).toBe(1);
  });

  it("loads a report that has judge fields", () => {
    const withJudge = {
      ...oldReport,
      judgeModel: "claude-sonnet-5-5",
      judgeMaxTokens: 5000,
      cases: [
        {
          ...oldReport.cases[0],
          attempts: [{ ...oldReport.cases[0]?.attempts[0], notJudged: true, judgeUsage: { inputTokens: 5, outputTokens: 1 } }],
        },
      ],
      summary: { ...oldReport.summary, judge: { judged: 0, allGatesPassed: 0, notJudged: 1 } },
    };
    const run = parseRunFile(withJudge, "new.json");
    expect(run.cases).toHaveLength(1);
    expect(run.summary.attempts).toBe(1);
  });

  it("rejects a malformed report with the file label in the message", () => {
    const { cases: _omitted, ...withoutCases } = oldReport;
    expect(() => parseRunFile(withoutCases, "bad.json")).toThrow(/Invalid results file bad\.json/);
  });
});

describe("parseBaselineRunFile", () => {
  it("loads a report without an aborted flag or judgments", () => {
    const { aborted: _aborted, ...withoutAborted } = oldReport;
    const run = parseBaselineRunFile(withoutAborted, "old.json");
    expect(run.aborted).toBeUndefined();
    expect(run.cases[0]?.attempts[0]?.outcome).toBe("passed");
  });

  it("reads the abort flag", () => {
    expect(parseBaselineRunFile({ ...oldReport, aborted: true }, "a.json").aborted).toBe(true);
  });

  it("rejects an attempt with an unknown outcome or a malformed judgment", () => {
    const attempt = oldReport.cases[0]?.attempts[0];
    const withAttempt = (a: unknown) => ({ ...oldReport, cases: [{ ...oldReport.cases[0], attempts: [a] }] });
    expect(() => parseBaselineRunFile(withAttempt({ ...attempt, outcome: "weird" }), "bad.json")).toThrow(/Invalid results file bad\.json/);
    expect(() => parseBaselineRunFile(withAttempt({ ...attempt, judgment: { gates: {} } }), "bad.json")).toThrow(/Invalid results file/);
  });
});
