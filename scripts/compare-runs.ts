import { readFile } from "node:fs/promises";
import { z } from "zod";

const RunFileSchema = z.object({
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
type RunFile = z.infer<typeof RunFileSchema>;

async function loadRun(path: string): Promise<RunFile> {
  const parsed = RunFileSchema.safeParse(JSON.parse(await readFile(path, "utf8")));
  if (!parsed.success) throw new Error(`Invalid results file ${path}:\n${z.prettifyError(parsed.error)}`);
  return parsed.data;
}

function rate(passed: number | undefined, attempts: number | undefined): string {
  return attempts === undefined ? "(missing)" : `${passed ?? 0}/${attempts}`;
}

function caseRate(run: RunFile, id: string): string {
  const found = run.cases.find((c) => c.id === id);
  return found ? rate(found.outcomes.passed, found.attempts.length) : "(missing)";
}

const [pathA, pathB] = process.argv.slice(2);
if (!pathA || !pathB) {
  console.error("Usage: npm run compare -- <run-a.json> <run-b.json>");
  process.exit(1);
}

const [runA, runB] = await Promise.all([loadRun(pathA), loadRun(pathB)]);
for (const [label, run] of [["A", runA], ["B", runB]] as const) {
  console.log(`Run ${label}: ${run.timestamp}  model=${run.model}  repeats=${run.repeats}`);
}
console.log("");

const ids = [...new Set([...runA.cases.map((c) => c.id), ...runB.cases.map((c) => c.id)])];
const idWidth = Math.max("case".length, "OVERALL".length, ...ids.map((id) => id.length));
const colWidth = 9;
const row = (label: string, a: string, b: string) => `${label.padEnd(idWidth)}  ${a.padEnd(colWidth)}  ${b}`;

console.log(row("case", "run A", "run B"));
for (const id of ids) console.log(row(id, caseRate(runA, id), caseRate(runB, id)));
console.log(
  row(
    "OVERALL",
    rate(runA.summary.outcomes.passed, runA.summary.attempts),
    rate(runB.summary.outcomes.passed, runB.summary.attempts),
  ),
);
