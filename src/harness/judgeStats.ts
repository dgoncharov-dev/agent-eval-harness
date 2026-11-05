import { judgmentPassed, type Judgment } from "../judge/schema.js";
import type { QuoteUsage } from "../sut/quote.js";
import type { CaseResult, RunReport } from "./run.js";

export const GATE_NAMES = ["load_size", "commitments", "hazardous"] as const;
export type GateName = (typeof GATE_NAMES)[number];

export const QUALITY_NAMES = ["uncertainty_handling", "answers_and_next_step", "tone_brevity"] as const;
export type QualityName = (typeof QUALITY_NAMES)[number];

export type GateCount = { pass: number; total: number };

export type JudgeSummary = {
  judged: number;
  allGatesPassed: number;
  gates: Record<GateName, GateCount & { rate: number }>;
  // Mean score 1-3 over judged attempts; null when nothing was judged.
  quality: Record<QualityName, number | null>;
  judgeErrors: number;
  notJudged: number;
  usage: QuoteUsage;
};

export type CrossTable = {
  checksPass: { judgePass: number; judgeFail: number };
  checksFail: { judgePass: number; judgeFail: number };
};

export type Disagreement = {
  caseId: string;
  // 1-based position of the attempt within its case.
  attempt: number;
  checksPassed: boolean;
  failedChecks: string[];
  failedGates: { gate: GateName; reason: string }[];
};

type JudgedAttempt = { caseId: string; attempt: number; result: CaseResult; judgment: Judgment };

function judgedAttempts(report: RunReport): JudgedAttempt[] {
  return report.cases.flatMap(({ id, attempts }) =>
    attempts.flatMap((result, index) =>
      result.judgment ? [{ caseId: id, attempt: index + 1, result, judgment: result.judgment }] : [],
    ),
  );
}

// Per-gate pass counts over the judged attempts in the given list.
export function gateCounts(attempts: readonly CaseResult[]): Record<GateName, GateCount> {
  const counts: Record<GateName, GateCount> = {
    load_size: { pass: 0, total: 0 },
    commitments: { pass: 0, total: 0 },
    hazardous: { pass: 0, total: 0 },
  };
  for (const { judgment } of attempts) {
    if (!judgment) continue;
    for (const gate of GATE_NAMES) {
      counts[gate].total++;
      if (judgment.gates[gate].pass) counts[gate].pass++;
    }
  }
  return counts;
}

export function summarizeJudge(report: RunReport): JudgeSummary {
  const all = report.cases.flatMap((c) => c.attempts);
  const judged = judgedAttempts(report);
  const counts = gateCounts(all);

  const qualitySums: Record<QualityName, number> = { uncertainty_handling: 0, answers_and_next_step: 0, tone_brevity: 0 };
  for (const { judgment } of judged) {
    for (const name of QUALITY_NAMES) qualitySums[name] += judgment.quality[name].score;
  }
  const mean = (name: QualityName): number | null => (judged.length === 0 ? null : qualitySums[name] / judged.length);

  const usage: QuoteUsage = { inputTokens: 0, outputTokens: 0 };
  for (const attempt of all) {
    usage.inputTokens += attempt.judgeUsage?.inputTokens ?? 0;
    usage.outputTokens += attempt.judgeUsage?.outputTokens ?? 0;
  }

  const rated = (gate: GateName) => ({
    ...counts[gate],
    rate: counts[gate].total === 0 ? 0 : counts[gate].pass / counts[gate].total,
  });

  return {
    judged: judged.length,
    allGatesPassed: judged.filter(({ judgment }) => judgmentPassed(judgment)).length,
    gates: { load_size: rated("load_size"), commitments: rated("commitments"), hazardous: rated("hazardous") },
    quality: {
      uncertainty_handling: mean("uncertainty_handling"),
      answers_and_next_step: mean("answers_and_next_step"),
      tone_brevity: mean("tone_brevity"),
    },
    judgeErrors: all.filter((a) => a.judgeError !== undefined).length,
    notJudged: all.filter((a) => a.notJudged === true).length,
    usage,
  };
}

// Deterministic verdict (rows) x judge all-gates verdict (columns), over judged attempts only.
export function judgeCrossTable(report: RunReport): CrossTable {
  const table: CrossTable = {
    checksPass: { judgePass: 0, judgeFail: 0 },
    checksFail: { judgePass: 0, judgeFail: 0 },
  };
  for (const { result, judgment } of judgedAttempts(report)) {
    const row = result.outcome === "passed" ? table.checksPass : table.checksFail;
    if (judgmentPassed(judgment)) row.judgePass++;
    else row.judgeFail++;
  }
  return table;
}

export function findDisagreements(report: RunReport): Disagreement[] {
  return judgedAttempts(report).flatMap(({ caseId, attempt, result, judgment }) => {
    const checksPassed = result.outcome === "passed";
    if (checksPassed === judgmentPassed(judgment)) return [];
    return [
      {
        caseId,
        attempt,
        checksPassed,
        failedChecks: result.checks.filter((c) => !c.passed).map((c) => c.name),
        failedGates: GATE_NAMES.filter((gate) => !judgment.gates[gate].pass).map((gate) => ({
          gate,
          reason: judgment.gates[gate].reason,
        })),
      },
    ];
  });
}
