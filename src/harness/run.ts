import Anthropic from "@anthropic-ai/sdk";
import { runAllChecks } from "../checks/index.js";
import type { Case, CheckResult } from "../checks/types.js";
import { JudgeNoToolUseError, JudgeValidationError, judgeQuote } from "../judge/judge.js";
import type { Judgment } from "../judge/schema.js";
import { NoToolUseError, QuoteValidationError, runQuote, type QuoteUsage } from "../sut/quote.js";
import type { Quote } from "../sut/schema.js";
import { summarizeJudge, type JudgeSummary } from "./judgeStats.js";

export type QuoteFn = (message: string) => Promise<{ quote: Quote; usage: QuoteUsage }>;
export type JudgeFn = (testCase: Case, quote: Quote) => Promise<{ judgment: Judgment; usage: QuoteUsage }>;

// A judge call that failed without producing a judgment; it never changes the deterministic outcome.
export type JudgeError = { kind: "no_tool" | "invalid_shape" | "api_error"; message: string };

export const OUTCOMES = ["passed", "failed_checks", "format_error", "refusal", "api_error"] as const;
export type Outcome = (typeof OUTCOMES)[number];

// One attempt at one case.
export type CaseResult = {
  id: string;
  outcome: Outcome;
  quote?: Quote;
  checks: CheckResult[];
  error?: string;
  // SUT usage only; judge usage is kept apart in judgeUsage.
  usage: QuoteUsage;
  judgment?: Judgment;
  judgeError?: JudgeError;
  judgeUsage?: QuoteUsage;
  // Set when the attempt had a quote but the judge token budget was already used up.
  notJudged?: true;
};

export type CaseAggregate = {
  id: string;
  // The customer message of the case, so a report file is readable without cases/quotes.json.
  message: string;
  attempts: CaseResult[];
  passRate: number;
  outcomes: Record<Outcome, number>;
};

export type RunOptions = {
  repeats?: number;
  maxTotalTokens?: number;
  quoteFn?: QuoteFn;
  // Opt-in: off by default so plain runs make no judge calls.
  judge?: boolean;
  judgeFn?: JudgeFn;
  maxJudgeTokens?: number;
};

export type RunReport = {
  cases: CaseAggregate[];
  aborted: boolean;
  // Ids of cases that were never started because the token budget was exceeded.
  skipped: string[];
  // Judge token budget in effect; present only when judging was on.
  judgeMaxTokens?: number;
};

export type Summary = {
  attempts: number;
  outcomes: Record<Outcome, number>;
  failedChecks: Record<string, number>;
  passRate: number;
  totalInputTokens: number;
  totalOutputTokens: number;
  // Present only when judging was on.
  judge?: JudgeSummary;
};

const DEFAULT_MAX_TOTAL_TOKENS = 150_000;
const JUDGE_TOKENS_PER_ATTEMPT = 5000;
const NO_USAGE: QuoteUsage = { inputTokens: 0, outputTokens: 0 };

function emptyOutcomes(): Record<Outcome, number> {
  return { passed: 0, failed_checks: 0, format_error: 0, refusal: 0, api_error: 0 };
}

// A bad or unauthorized key should stop the whole run, not be recorded as one more api_error.
export function isAuthError(err: unknown): boolean {
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

async function judgeAttempt(
  testCase: Case,
  quote: Quote,
  judgeFn: JudgeFn,
): Promise<Pick<CaseResult, "judgment" | "judgeError" | "judgeUsage">> {
  try {
    const { judgment, usage } = await judgeFn(testCase, quote);
    return { judgment, judgeUsage: usage };
  } catch (err) {
    if (isAuthError(err)) throw err;
    if (err instanceof JudgeNoToolUseError) {
      return { judgeError: { kind: "no_tool", message: err.message }, judgeUsage: err.usage };
    }
    if (err instanceof JudgeValidationError) {
      return { judgeError: { kind: "invalid_shape", message: err.message }, judgeUsage: err.usage };
    }
    const message = err instanceof Error ? err.message : String(err);
    return { judgeError: { kind: "api_error", message }, judgeUsage: NO_USAGE };
  }
}

function aggregate({ id, message }: Case, attempts: CaseResult[]): CaseAggregate {
  const outcomes = emptyOutcomes();
  for (const attempt of attempts) outcomes[attempt.outcome]++;
  return { id, message, attempts, passRate: outcomes.passed / attempts.length, outcomes };
}

export async function runAll(cases: Case[], options: RunOptions = {}): Promise<RunReport> {
  const {
    repeats = 1,
    maxTotalTokens = DEFAULT_MAX_TOTAL_TOKENS,
    quoteFn = runQuote,
    judge = false,
    judgeFn = judgeQuote,
  } = options;
  if (!Number.isInteger(repeats) || repeats < 1) {
    throw new RangeError(`repeats must be a positive integer, got ${repeats}`);
  }
  const maxJudgeTokens = options.maxJudgeTokens ?? cases.length * repeats * JUDGE_TOKENS_PER_ATTEMPT;
  if (!Number.isInteger(maxJudgeTokens) || maxJudgeTokens < 1) {
    throw new RangeError(`maxJudgeTokens must be a positive integer, got ${maxJudgeTokens}`);
  }
  const judgeInfo = judge ? { judgeMaxTokens: maxJudgeTokens } : {};

  const aggregates: CaseAggregate[] = [];
  let totalTokens = 0;
  let judgeTokens = 0;

  for (const [caseIndex, testCase] of cases.entries()) {
    const attempts: CaseResult[] = [];
    for (let attempt = 0; attempt < repeats; attempt++) {
      let result = await runCase(testCase, quoteFn);
      totalTokens += result.usage.inputTokens + result.usage.outputTokens;

      // The judge only sees attempts that produced a quote, and has its own budget separate from the SUT's.
      if (judge && result.quote) {
        if (judgeTokens > maxJudgeTokens) {
          result = { ...result, notJudged: true };
        } else {
          const judged = await judgeAttempt(testCase, result.quote, judgeFn);
          result = { ...result, ...judged };
          judgeTokens += (judged.judgeUsage?.inputTokens ?? 0) + (judged.judgeUsage?.outputTokens ?? 0);
        }
      }
      attempts.push(result);

      const moreWork = attempt < repeats - 1 || caseIndex < cases.length - 1;
      if (totalTokens > maxTotalTokens && moreWork) {
        aggregates.push(aggregate(testCase, attempts));
        return { cases: aggregates, aborted: true, skipped: cases.slice(caseIndex + 1).map((c) => c.id), ...judgeInfo };
      }
    }
    aggregates.push(aggregate(testCase, attempts));
  }

  return { cases: aggregates, aborted: false, skipped: [], ...judgeInfo };
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
  if (report.judgeMaxTokens !== undefined) summary.judge = summarizeJudge(report);
  return summary;
}
