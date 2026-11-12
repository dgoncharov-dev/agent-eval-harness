import { fileURLToPath } from "node:url";
import { checkBaseline, parseBaseline } from "../src/harness/baseline.js";
import { readJsonFile } from "../src/harness/readJsonFile.js";
import { parseBaselineRunFile } from "../src/harness/reportFile.js";

const [reportPath, baselinePathArg] = process.argv.slice(2);
if (!reportPath) {
  console.error("Usage: tsx scripts/check-baseline.ts <report.json> [baseline.json]");
  process.exit(1);
}
const baselinePath = baselinePathArg ?? fileURLToPath(new URL("../baseline/baseline.json", import.meta.url));

try {
  const report = parseBaselineRunFile(await readJsonFile(reportPath, "report"), reportPath);
  const baseline = parseBaseline(await readJsonFile(baselinePath, "baseline"), baselinePath);
  const { rows, violations } = checkBaseline(report, baseline);

  const pct = (rate: number) => `${(rate * 100).toFixed(0)}%`;
  const idWidth = Math.max("case".length, ...rows.map((r) => r.caseId.length));
  const line = (...cells: string[]) => [cells[0]?.padEnd(idWidth), ...cells.slice(1).map((c, i) => c.padEnd([7, 7, 12, 8][i] ?? 0))].join("  ").trimEnd();

  console.log(`Report: ${reportPath}  (${report.timestamp}, repeats=${report.repeats})`);
  console.log(line("case", "pass", "min", "judge/min", "status"));
  for (const row of rows) {
    const judge = row.judgeAllGatesRate === null ? "-" : `${pct(row.judgeAllGatesRate)}/${pct(row.judgeMinRate)}`;
    console.log(line(row.caseId, `${row.passed}/${row.attempts}`, pct(row.minPassRate), judge, row.status));
  }

  console.log("");
  if (violations.length === 0) {
    console.log("Baseline OK");
  } else {
    console.log(`Baseline violations: ${violations.length}`);
    for (const violation of violations) console.log(`  - ${violation.message}`);
    process.exitCode = 1;
  }
} catch (err) {
  console.error(err instanceof Error ? err.message : String(err));
  process.exitCode = 1;
}
