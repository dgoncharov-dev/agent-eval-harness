import { readFile } from "node:fs/promises";
import { z } from "zod";
import type { Case } from "../checks/types.js";

export const CaseSchema = z.strictObject({
  id: z.string().min(1),
  message: z.string().min(1),
  expect: z.strictObject({
    inServiceArea: z.boolean(),
    shouldRequestPhotos: z.boolean().nullable(),
  }),
}) satisfies z.ZodType<Case>;

const CasesSchema = z.array(CaseSchema);

export async function loadCases(path: string): Promise<Case[]> {
  const raw: unknown = JSON.parse(await readFile(path, "utf8"));
  const parsed = CasesSchema.safeParse(raw);
  if (!parsed.success) {
    throw new Error(`Invalid cases file ${path}:\n${z.prettifyError(parsed.error)}`);
  }

  const seen = new Set<string>();
  const duplicates = new Set<string>();
  for (const { id } of parsed.data) {
    if (seen.has(id)) duplicates.add(id);
    seen.add(id);
  }
  if (duplicates.size > 0) {
    throw new Error(`Duplicate case ids in ${path}: ${[...duplicates].join(", ")}`);
  }

  return parsed.data;
}
