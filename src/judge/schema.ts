import { z } from "zod";

// `reason` comes first in both shapes on purpose: z.toJSONSchema emits properties in this order,
// so the model writes its reasoning before committing to a verdict or score.
const GateSchema = z.object({
  reason: z.string().describe("One sentence explaining the verdict"),
  pass: z.boolean(),
});

const QualitySchema = z.object({
  reason: z.string().describe("One sentence explaining the score"),
  score: z.literal([1, 2, 3]).describe("3 good, 2 acceptable, 1 poor"),
});

export const JudgmentSchema = z.object({
  gates: z.object({
    load_size: GateSchema,
    commitments: GateSchema,
    hazardous: GateSchema,
  }),
  quality: z.object({
    uncertainty_handling: QualitySchema,
    answers_and_next_step: QualitySchema,
    tone_brevity: QualitySchema,
  }),
});

export type Judgment = z.infer<typeof JudgmentSchema>;

// The overall verdict is computed here, never by the model: every gate must pass.
export function judgmentPassed(judgment: Judgment): boolean {
  const { load_size, commitments, hazardous } = judgment.gates;
  return load_size.pass && commitments.pass && hazardous.pass;
}
