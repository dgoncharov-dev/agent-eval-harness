import { readFile } from "node:fs/promises";
import { z } from "zod";

const RunFileSchema = z.object({
  results: z.array(
    z.object({
      id: z.string(),
      status: z.enum(["completed", "format_error"]),
      checks: z.array(z.object({ name: z.string(), passed: z.boolean() })),
      quote: z.object({ customer_message: z.string() }).optional(),
    }),
  ),
});
type RunResult = z.infer<typeof RunFileSchema>["results"][number];

async function loadRun(path: string): Promise<Map<string, RunResult>> {
  const parsed = RunFileSchema.safeParse(JSON.parse(await readFile(path, "utf8")));
  if (!parsed.success) throw new Error(`Invalid results file ${path}:\n${z.prettifyError(parsed.error)}`);
  return new Map(parsed.data.results.map((r) => [r.id, r]));
}

function describeResult(result: RunResult | undefined): string {
  if (!result) return "(missing)";
  const failed = result.checks.filter((c) => !c.passed).map((c) => c.name);
  return failed.length > 0 ? `${result.status}: ${failed.join(", ")}` : `${result.status}: ok`;
}

const [pathA, pathB] = process.argv.slice(2);
if (!pathA || !pathB) {
  console.error("Usage: npm run compare -- <results-a.json> <results-b.json>");
  process.exit(1);
}

const [runA, runB] = await Promise.all([loadRun(pathA), loadRun(pathB)]);
const ids = [...new Set([...runA.keys(), ...runB.keys()])];

const rows = ids.map((id) => ({ id, a: describeResult(runA.get(id)), b: describeResult(runB.get(id)) }));
const idWidth = Math.max("case".length, ...rows.map((r) => r.id.length));
const aWidth = Math.max("run A".length, ...rows.map((r) => r.a.length));

console.log(`${"case".padEnd(idWidth)}  ${"run A".padEnd(aWidth)}  run B`);
for (const row of rows) console.log(`${row.id.padEnd(idWidth)}  ${row.a.padEnd(aWidth)}  ${row.b}`);

const inBoth = ids.filter((id) => runA.has(id) && runB.has(id));
const identical = inBoth.filter((id) => {
  const a = runA.get(id)?.quote?.customer_message;
  const b = runB.get(id)?.quote?.customer_message;
  return a !== undefined && a === b;
});
console.log("");
console.log(`Identical customer_message: ${identical.length} of ${inBoth.length} cases present in both runs`);
