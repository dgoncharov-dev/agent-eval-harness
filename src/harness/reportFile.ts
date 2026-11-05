import { z } from "zod";

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
