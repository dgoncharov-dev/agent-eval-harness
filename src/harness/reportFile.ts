import { z } from "zod";
import { JudgmentSchema } from "../judge/schema.js";
import { QuoteSchema } from "../sut/schema.js";

// The parts of a run report that compare-runs needs. Judge fields (attempt judgments, summary.judge,
// judgeMaxTokens) are not listed: unknown keys are ignored, so old and new report files both load.
export const RunFileSchema = z.object({
  timestamp: z.string(),
  model: z.string(),
  repeats: z.number(),
  cases: z.array(
    z.object({
      id: z.string(),
      attempts: z.array(z.unknown()),
      outcomes: z.record(z.string(), z.number()),
    }),
  ),
  summary: z.object({ attempts: z.number(), outcomes: z.record(z.string(), z.number()) }),
});

export type RunFile = z.infer<typeof RunFileSchema>;

export function parseRunFile(raw: unknown, label: string): RunFile {
  const parsed = RunFileSchema.safeParse(raw);
  if (!parsed.success) throw new Error(`Invalid results file ${label}:\n${z.prettifyError(parsed.error)}`);
  return parsed.data;
}

// What the baseline check needs on top of RunFileSchema: the abort flag (absent in old files, read as false)
// and each attempt's outcome and optional judgment.
export const BaselineRunSchema = RunFileSchema.extend({
  aborted: z.boolean().optional(),
  cases: z.array(
    z.object({
      id: z.string(),
      attempts: z.array(
        z.object({
          outcome: z.enum(["passed", "failed_checks", "format_error", "refusal", "api_error"]),
          judgment: JudgmentSchema.optional(),
        }),
      ),
      outcomes: z.record(z.string(), z.number()),
    }),
  ),
});

export type BaselineRun = z.infer<typeof BaselineRunSchema>;

export function parseBaselineRunFile(raw: unknown, label: string): BaselineRun {
  const parsed = BaselineRunSchema.safeParse(raw);
  if (!parsed.success) throw new Error(`Invalid results file ${label}:\n${z.prettifyError(parsed.error)}`);
  return parsed.data;
}

const UsageSchema = z.object({ inputTokens: z.number(), outputTokens: z.number() });

// Everything the HTML report shows: full attempts (reply, checks, errors, usage) on top of the baseline fields.
export const ReportRunSchema = BaselineRunSchema.extend({
  judgeModel: z.string().optional(),
  cases: z.array(
    z.object({
      id: z.string(),
      // Absent in report files written before cases carried their message.
      message: z.string().optional(),
      attempts: z.array(
        z.object({
          outcome: z.enum(["passed", "failed_checks", "format_error", "refusal", "api_error"]),
          quote: QuoteSchema.optional(),
          checks: z.array(z.object({ name: z.string(), passed: z.boolean(), detail: z.string() })),
          error: z.string().optional(),
          usage: UsageSchema,
          judgment: JudgmentSchema.optional(),
          judgeError: z
            .object({ kind: z.enum(["no_tool", "invalid_shape", "api_error"]), message: z.string() })
            .optional(),
          judgeUsage: UsageSchema.optional(),
          notJudged: z.boolean().optional(),
        }),
      ),
      outcomes: z.record(z.string(), z.number()),
    }),
  ),
});

export type ReportRun = z.infer<typeof ReportRunSchema>;

export function parseReportRunFile(raw: unknown, label: string): ReportRun {
  const parsed = ReportRunSchema.safeParse(raw);
  if (!parsed.success) throw new Error(`Invalid results file ${label}:\n${z.prettifyError(parsed.error)}`);
  return parsed.data;
}
