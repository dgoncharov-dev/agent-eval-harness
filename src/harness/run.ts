import Anthropic from "@anthropic-ai/sdk";
import { runAllChecks } from "../checks/index.js";
import type { Case, CheckResult } from "../checks/types.js";
import { NoToolUseError, QuoteValidationError, runQuote, type QuoteUsage } from "../sut/quote.js";
import type { Quote } from "../sut/schema.js";

export type QuoteFn = (message: string) => Promise<{ quote: Quote; usage: QuoteUsage }>;

export const OUTCOMES = ["passed", "failed_checks", "format_error", "refusal", "api_error"] as const;
export type Outcome = (typeof OUTCOMES)[number];

// One attempt at one case.
export type CaseResult = {
  id: string;
  outcome: Outcome;
  quote?: Quote;
  checks: CheckResult[];
  error?: string;
  usage: QuoteUsage;
};

export type CaseAggregate = {
  id: string;
  attempts: CaseResult[];
  passRate: number;
  outcomes: Record<Outcome, number>;
};

export type RunOptions = { repeats?: number; maxTotalTokens?: number; quoteFn?: QuoteFn };

export type RunReport = {
  cases: CaseAggregate[];
  aborted: boolean;
  // Ids of cases that were never started because the token budget was exceeded.
  skipped: string[];
};

export type Summary = {
  attempts: number;
  outcomes: Record<Outcome, number>;
  failedChecks: Record<string, number>;
  passRate: number;
  totalInputTokens: number;
  totalOutputTokens: number;
};

const DEFAULT_MAX_TOTAL_TOKENS = 150_000;
const NO_USAGE: QuoteUsage = { inputTokens: 0, outputTokens: 0 };

function emptyOutcomes(): Record<Outcome, number> {
  return { passed: 0, failed_checks: 0, format_error: 0, refusal: 0, api_error: 0 };
}

// A bad or unauthorized key should stop the whole run, not be recorded as one more api_error.
function isAuthError(err: unknown): boolean {
  if (err instanceof Anthropic.AuthenticationError) return true;
  return typeof err === "object" && err !== null && "status" in err && (err.status === 401 || err.status === 403);
}

export async function runCase(testCase: Case, quoteFn: QuoteFn = runQuote): Promise<CaseResult> {
  try {
    const { quote, usage } = await quoteFn(testCase.message);
    const checks = runAllChecks(quote, testCase);
    const outcome = checks.every((check) => check.passed) ? "passed" : "failed_checks";
    return { id: testCase.id, outcome, quote, checks, usage };
  } catch (err) {
    if (isAuthError(err)) throw err;
    if (err instanceof NoToolUseError) {
      const outcome = err.stopReason === "refusal" ? "refusal" : "format_error";
      return { id: testCase.id, outcome, checks: [], error: err.message, usage: err.usage };
    }
    if (err instanceof QuoteValidationError) {
      return { id: testCase.id, outcome: "format_error", checks: [], error: err.message, usage: err.usage };
    }
    const message = err instanceof Error ? err.message : String(err);
    return { id: testCase.id, outcome: "api_error", checks: [], error: message, usage: NO_USAGE };
  }
}

function aggregate(id: string, attempts: CaseResult[]): CaseAggregate {
  const outcomes = emptyOutcomes();
  for (const attempt of attempts) outcomes[attempt.outcome]++;
  return { id, attempts, passRate: outcomes.passed / attempts.length, outcomes };
}

export async function runAll(cases: Case[], options: RunOptions = {}): Promise<RunReport> {
  const { repeats = 1, maxTotalTokens = DEFAULT_MAX_TOTAL_TOKENS, quoteFn = runQuote } = options;
  if (!Number.isInteger(repeats) || repeats < 1) {
    throw new RangeError(`repeats must be a positive integer, got ${repeats}`);
  }

  const aggregates: CaseAggregate[] = [];
  let totalTokens = 0;

  for (const [caseIndex, testCase] of cases.entries()) {
    const attempts: CaseResult[] = [];
    for (let attempt = 0; attempt < repeats; attempt++) {
      const result = await runCase(testCase, quoteFn);
      attempts.push(result);
      totalTokens += result.usage.inputTokens + result.usage.outputTokens;

      const moreWork = attempt < repeats - 1 || caseIndex < cases.length - 1;
      if (totalTokens > maxTotalTokens && moreWork) {
        aggregates.push(aggregate(testCase.id, attempts));
        return { cases: aggregates, aborted: true, skipped: cases.slice(caseIndex + 1).map((c) => c.id) };
      }
    }
    aggregates.push(aggregate(testCase.id, attempts));
  }

  return { cases: aggregates, aborted: false, skipped: [] };
}

export function summarize(report: RunReport): Summary {
  const summary: Summary = {
    attempts: 0,
    outcomes: emptyOutcomes(),
    failedChecks: {},
    passRate: 0,
    totalInputTokens: 0,
    totalOutputTokens: 0,
  };

  for (const { attempts } of report.cases) {
    for (const attempt of attempts) {
      summary.attempts++;
      summary.outcomes[attempt.outcome]++;
      for (const check of attempt.checks) {
        if (!check.passed) summary.failedChecks[check.name] = (summary.failedChecks[check.name] ?? 0) + 1;
      }
      summary.totalInputTokens += attempt.usage.inputTokens;
      summary.totalOutputTokens += attempt.usage.outputTokens;
    }
  }

  summary.passRate = summary.attempts === 0 ? 0 : summary.outcomes.passed / summary.attempts;
  return summary;
}
