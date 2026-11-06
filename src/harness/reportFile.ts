import { z } from "zod";
import { JudgmentSchema } from "../judge/schema.js";

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
