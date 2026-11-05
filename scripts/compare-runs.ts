import { readFile } from "node:fs/promises";
import { parseRunFile, type RunFile } from "../src/harness/reportFile.js";

async function loadRun(path: string): Promise<RunFile> {
  return parseRunFile(JSON.parse(await readFile(path, "utf8")), path);
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
