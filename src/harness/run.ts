import { runAllChecks } from "../checks/index.js";
import type { Case, CheckResult } from "../checks/types.js";
import { NoToolUseError, QuoteValidationError, runQuote, type QuoteUsage } from "../sut/quote.js";
import type { Quote } from "../sut/schema.js";

export type QuoteFn = (message: string) => Promise<{ quote: Quote; usage: QuoteUsage }>;

export type CaseResult = {
  id: string;
  status: "completed" | "format_error";
  quote?: Quote;
  checks: CheckResult[];
  error?: string;
  usage: QuoteUsage;
};

export type RunOptions = { maxTotalTokens?: number; quoteFn?: QuoteFn };

export type RunReport = {
  results: CaseResult[];
  aborted: boolean;
  // Ids of cases that were not run because the token budget was exceeded.
  skipped: string[];
};

export type Summary = {
  completed: number;
  formatErrors: number;
  failedChecks: Record<string, number>;
  totalInputTokens: number;
  totalOutputTokens: number;
};

const DEFAULT_MAX_TOTAL_TOKENS = 150_000;

export async function runCase(testCase: Case, quoteFn: QuoteFn = runQuote): Promise<CaseResult> {
  try {
    const { quote, usage } = await quoteFn(testCase.message);
    return { id: testCase.id, status: "completed", quote, checks: runAllChecks(quote, testCase), usage };
  } catch (err) {
    if (err instanceof NoToolUseError || err instanceof QuoteValidationError) {
      return { id: testCase.id, status: "format_error", checks: [], error: err.message, usage: err.usage };
    }
    throw err;
  }
}

export async function runAll(cases: Case[], options: RunOptions = {}): Promise<RunReport> {
  const { maxTotalTokens = DEFAULT_MAX_TOTAL_TOKENS, quoteFn = runQuote } = options;
  const results: CaseResult[] = [];
  let totalTokens = 0;

  for (const [index, testCase] of cases.entries()) {
    const result = await runCase(testCase, quoteFn);
    results.push(result);
    totalTokens += result.usage.inputTokens + result.usage.outputTokens;

    const remaining = cases.slice(index + 1);
    if (totalTokens > maxTotalTokens && remaining.length > 0) {
      return { results, aborted: true, skipped: remaining.map((c) => c.id) };
    }
  }

  return { results, aborted: false, skipped: [] };
}

export function summarize(results: CaseResult[]): Summary {
  const summary: Summary = {
    completed: 0,
    formatErrors: 0,
    failedChecks: {},
    totalInputTokens: 0,
    totalOutputTokens: 0,
  };

  for (const result of results) {
    if (result.status === "completed") summary.completed++;
    else summary.formatErrors++;

    for (const check of result.checks) {
      if (!check.passed) summary.failedChecks[check.name] = (summary.failedChecks[check.name] ?? 0) + 1;
    }
    summary.totalInputTokens += result.usage.inputTokens;
    summary.totalOutputTokens += result.usage.outputTokens;
  }

  return summary;
}
