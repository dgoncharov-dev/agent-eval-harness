import { z } from "zod";
import { judgmentPassed } from "../judge/schema.js";
import type { BaselineRun } from "./reportFile.js";

const Rate = z.number().min(0).max(1);

export const BaselineSchema = z.strictObject({
  defaultMinPassRate: Rate,
  perCase: z.record(z.string(), Rate),
  maxFormatErrors: z.number().int().nonnegative(),
  judgeMinAllGatesRate: Rate,
});

export type Baseline = z.infer<typeof BaselineSchema>;

export function parseBaseline(raw: unknown, label: string): Baseline {
  const parsed = BaselineSchema.safeParse(raw);
  if (!parsed.success) throw new Error(`Invalid baseline file ${label}:\n${z.prettifyError(parsed.error)}`);
  return parsed.data;
}

export type BaselineStatus = "ok" | "below" | "improved";

export type BaselineRow = {
  caseId: string;
  attempts: number;
  passed: number;
  passRate: number;
  minPassRate: number;
  judged: number;
  // Share of judged attempts that passed all three gates; null when the case has no judgments.
  judgeAllGatesRate: number | null;
  judgeMinRate: number;
  status: BaselineStatus;
};

export type Violation = {
  kind: "case_below_minimum" | "judge_below_minimum" | "format_errors" | "aborted";
  message: string;
};

// Rates are k/n against a decimal minimum, so compare with a tolerance (3/5 must meet 0.6).
const EPSILON = 1e-9;
const below = (rate: number, minimum: number) => rate < minimum - EPSILON;

const percent = (rate: number) => `${(rate * 100).toFixed(0)}%`;

export function checkBaseline(report: BaselineRun, baseline: Baseline): { rows: BaselineRow[]; violations: Violation[] } {
  const violations: Violation[] = [];
  let formatErrors = 0;

  const rows = report.cases.map((testCase): BaselineRow => {
    const override = baseline.perCase[testCase.id];
    const minPassRate = override ?? baseline.defaultMinPassRate;
    // A per-case minimum also replaces the judge minimum, so a known-failing case is tolerated on both sides.
    const judgeMinRate = override ?? baseline.judgeMinAllGatesRate;

    const attempts = testCase.attempts.length;
    const passed = testCase.attempts.filter((a) => a.outcome === "passed").length;
    formatErrors += testCase.attempts.filter((a) => a.outcome === "format_error").length;
    const passRate = attempts === 0 ? 0 : passed / attempts;

    const judgments = testCase.attempts.flatMap((a) => (a.judgment ? [a.judgment] : []));
    const judgeAllGatesRate =
      judgments.length === 0 ? null : judgments.filter(judgmentPassed).length / judgments.length;

    const detBelow = below(passRate, minPassRate);
    const judgeBelow = judgeAllGatesRate !== null && below(judgeAllGatesRate, judgeMinRate);
    if (detBelow) {
      violations.push({
        kind: "case_below_minimum",
        message: `${testCase.id}: pass rate ${passed}/${attempts} (${percent(passRate)}) is below the minimum ${percent(minPassRate)}`,
      });
    }
    if (judgeBelow) {
      violations.push({
        kind: "judge_below_minimum",
        message: `${testCase.id}: judge all-gates rate ${percent(judgeAllGatesRate)} is below the minimum ${percent(judgeMinRate)}`,
      });
    }

    const status: BaselineStatus =
      detBelow || judgeBelow
        ? "below"
        : override !== undefined && !below(passRate, baseline.defaultMinPassRate)
          ? "improved"
          : "ok";

    return {
      caseId: testCase.id,
      attempts,
      passed,
      passRate,
      minPassRate,
      judged: judgments.length,
      judgeAllGatesRate,
      judgeMinRate,
      status,
    };
  });

  if (formatErrors > baseline.maxFormatErrors) {
    violations.push({
      kind: "format_errors",
      message: `${formatErrors} format errors exceed the maximum ${baseline.maxFormatErrors}`,
    });
  }
  if (report.aborted === true) {
    violations.push({ kind: "aborted", message: "the run was aborted (token budget exceeded), so some cases were not run" });
  }

  return { rows, violations };
}
