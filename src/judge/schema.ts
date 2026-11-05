import { z } from "zod";

const GateSchema = z.object({
  pass: z.boolean(),
  reason: z.string().describe("One sentence explaining the verdict"),
});

const QualitySchema = z.object({
  score: z.literal([1, 2, 3]).describe("3 good, 2 acceptable, 1 poor"),
  reason: z.string().describe("One sentence explaining the score"),
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
