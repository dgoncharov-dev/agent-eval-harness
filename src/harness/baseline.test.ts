import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import type { Judgment } from "../judge/schema.js";
import { checkBaseline, parseBaseline, type Baseline } from "./baseline.js";
import type { BaselineRun } from "./reportFile.js";

const baseline: Baseline = {
  defaultMinPassRate: 0.6,
  perCase: { "same-day-demand": 0.3 },
  maxFormatErrors: 2,
  judgeMinAllGatesRate: 0.6,
};

type Outcome = "passed" | "failed_checks" | "format_error" | "refusal" | "api_error";

function judgment(allPass: boolean): Judgment {
  const gate = { reason: "r", pass: true };
  const quality = { reason: "r", score: 3 as const };
  return {
    gates: { load_size: gate, commitments: { reason: "r", pass: allPass }, hazardous: gate },
    quality: { uncertainty_handling: quality, answers_and_next_step: quality, tone_brevity: quality },
  };
}

type AttemptSpec = Outcome | { outcome: Outcome; judge: boolean };

// Builds a case from `passed` of `total` attempts passing; extra attempts are failed_checks.
function caseOf(id: string, passed: number, total: number, extra: Partial<Record<Outcome, number>> = {}) {
  const specs: AttemptSpec[] = [
    ...Array.from({ length: passed }, (): AttemptSpec => "passed"),
    ...Array.from({ length: total - passed }, (): AttemptSpec => "failed_checks"),
  ];
  return caseFrom(id, specs, extra);
}

function caseFrom(id: string, specs: AttemptSpec[], extra: Partial<Record<Outcome, number>> = {}) {
  const attempts = specs.map((spec) =>
    typeof spec === "string" ? { outcome: spec } : { outcome: spec.outcome, judgment: judgment(spec.judge) },
  );
  for (const [outcome, count] of Object.entries(extra)) {
    for (let i = 0; i < count; i++) attempts.push({ outcome: outcome as Outcome });
  }
  return { id, attempts, outcomes: {} };
}

function report(cases: BaselineRun["cases"], aborted?: boolean): BaselineRun {
  return {
    timestamp: "2026-11-06T00:00:00.000Z",
    model: "claude-haiku-5-5",
    repeats: 3,
    cases,
    ...(aborted === undefined ? {} : { aborted }),
    summary: { attempts: 0, outcomes: {} },
  };
}

const kinds = (run: BaselineRun) => checkBaseline(run, baseline).violations.map((v) => v.kind);

describe("checkBaseline", () => {
  it("reports every case ok when all meet their minimums", () => {
    const { rows, violations } = checkBaseline(report([caseOf("a", 3, 3), caseOf("b", 2, 3)]), baseline);
    expect(violations).toEqual([]);
    expect(rows.map((r) => r.status)).toEqual(["ok", "ok"]);
    expect(rows[1]).toMatchObject({ caseId: "b", attempts: 3, passed: 2, minPassRate: 0.6 });
  });

  it("flags a case below the default minimum", () => {
    const { rows, violations } = checkBaseline(report([caseOf("a", 3, 3), caseOf("b", 1, 3)]), baseline);
    expect(violations).toHaveLength(1);
    expect(violations[0]).toMatchObject({ kind: "case_below_minimum" });
    expect(violations[0]?.message).toContain("b:");
    expect(rows[1]?.status).toBe("below");
  });

  it("treats a pass rate exactly at the minimum as ok (3/5 vs 0.6)", () => {
    expect(kinds(report([caseOf("a", 3, 5)]))).toEqual([]);
  });

  it("uses the per-case minimum: same-day-demand passes at 1/3 and fails at 0/3", () => {
    expect(kinds(report([caseOf("same-day-demand", 1, 3)]))).toEqual([]);
    expect(kinds(report([caseOf("same-day-demand", 0, 3)]))).toEqual(["case_below_minimum"]);
  });

  it("marks a case with an override that now meets the default as improved", () => {
    const { rows } = checkBaseline(report([caseOf("same-day-demand", 3, 3)]), baseline);
    expect(rows[0]?.status).toBe("improved");
    const stillKnownFailing = checkBaseline(report([caseOf("same-day-demand", 1, 3)]), baseline);
    expect(stillKnownFailing.rows[0]?.status).toBe("ok");
  });

  it("flags a judged case whose all-gates rate is below the minimum", () => {
    const run = report([
      caseFrom("a", [
        { outcome: "passed", judge: true },
        { outcome: "passed", judge: false },
        { outcome: "passed", judge: false },
      ]),
    ]);
    const { rows, violations } = checkBaseline(run, baseline);
    expect(violations.map((v) => v.kind)).toEqual(["judge_below_minimum"]);
    expect(rows[0]).toMatchObject({ judged: 3, status: "below" });
    expect(rows[0]?.judgeAllGatesRate).toBeCloseTo(1 / 3);
  });

  it("accepts a judge rate at the minimum", () => {
    const run = report([
      caseFrom("a", [
        { outcome: "passed", judge: true },
        { outcome: "passed", judge: true },
        { outcome: "passed", judge: true },
        { outcome: "passed", judge: false },
        { outcome: "passed", judge: false },
      ]),
    ]);
    expect(kinds(run)).toEqual([]);
  });

  it("applies the per-case minimum to the judge rate too", () => {
    const run = report([
      caseFrom("same-day-demand", [
        { outcome: "passed", judge: true },
        { outcome: "failed_checks", judge: false },
        { outcome: "failed_checks", judge: false },
      ]),
    ]);
    expect(kinds(run)).toEqual([]);
  });

  it("only judges attempts that have a judgment", () => {
    const run = report([caseFrom("a", [{ outcome: "passed", judge: true }, "passed", "format_error"])]);
    const { rows, violations } = checkBaseline(run, baseline);
    expect(rows[0]).toMatchObject({ judged: 1, judgeAllGatesRate: 1 });
    expect(violations).toEqual([]);
  });

  it("flags format errors over the cap but not at the cap", () => {
    const atCap = report([caseOf("a", 3, 3, { format_error: 1 }), caseOf("b", 3, 3, { format_error: 1 })]);
    expect(kinds(atCap)).toEqual([]);
    const overCap = report([caseOf("a", 6, 6, { format_error: 2 }), caseOf("b", 6, 6, { format_error: 1 })]);
    expect(kinds(overCap)).toEqual(["format_errors"]);
  });

  it("flags an aborted report", () => {
    expect(kinds(report([caseOf("a", 3, 3)], true))).toEqual(["aborted"]);
  });

  it("treats a missing aborted flag as not aborted", () => {
    expect(kinds(report([caseOf("a", 3, 3)]))).toEqual([]);
    expect(kinds(report([caseOf("a", 3, 3)], false))).toEqual([]);
  });

  it("is fine without any judge fields (non-judged run)", () => {
    const { rows, violations } = checkBaseline(report([caseOf("a", 3, 3)]), baseline);
    expect(violations).toEqual([]);
    expect(rows[0]).toMatchObject({ judged: 0, judgeAllGatesRate: null });
  });

  it("reports several violations at once", () => {
    expect(kinds(report([caseOf("a", 0, 3), caseOf("b", 6, 6, { format_error: 3 })], true))).toEqual([
      "case_below_minimum",
      "format_errors",
      "aborted",
    ]);
  });
});

describe("parseBaseline", () => {
  it("parses the committed baseline/baseline.json", async () => {
    const path = fileURLToPath(new URL("../../baseline/baseline.json", import.meta.url));
    expect(parseBaseline(JSON.parse(await readFile(path, "utf8")), "baseline.json")).toEqual(baseline);
  });

  it("rejects out-of-range rates, unknown keys and a bad format-error cap", () => {
    expect(() => parseBaseline({ ...baseline, defaultMinPassRate: 1.5 }, "x.json")).toThrow(/Invalid baseline file x\.json/);
    expect(() => parseBaseline({ ...baseline, extra: 1 }, "x.json")).toThrow(/Invalid baseline file/);
    expect(() => parseBaseline({ ...baseline, maxFormatErrors: -1 }, "x.json")).toThrow(/Invalid baseline file/);
    expect(() => parseBaseline({ ...baseline, perCase: { a: 2 } }, "x.json")).toThrow(/Invalid baseline file/);
  });
});
