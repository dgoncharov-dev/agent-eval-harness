import "dotenv/config";
import { mkdir, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { loadCases } from "../src/harness/cases.js";
import { runAll, summarize } from "../src/harness/run.js";

const casesPath = fileURLToPath(new URL("../cases/quotes.json", import.meta.url));
const reportsDir = fileURLToPath(new URL("../reports", import.meta.url));

const cases = await loadCases(casesPath);
const report = await runAll(cases);
const summary = summarize(report.results);

console.log("");
for (const result of report.results) {
  const failed = result.checks.filter((c) => !c.passed).map((c) => c.name);
  console.log(`${result.id.padEnd(24)} ${result.status.padEnd(13)} ${failed.length > 0 ? failed.join(", ") : "-"}`);
}

console.log("");
console.log(`Completed: ${summary.completed}  Format errors: ${summary.formatErrors}`);
const failedEntries = Object.entries(summary.failedChecks);
console.log(
  failedEntries.length > 0
    ? `Failed checks: ${failedEntries.map(([name, count]) => `${name}=${count}`).join(", ")}`
    : "Failed checks: none",
);
console.log(`Tokens: input=${summary.totalInputTokens} output=${summary.totalOutputTokens}`);
if (report.aborted) {
  console.log(`ABORTED: token budget exceeded, skipped ${report.skipped.length} case(s): ${report.skipped.join(", ")}`);
}

await mkdir(reportsDir, { recursive: true });
await writeFile(`${reportsDir}/results.json`, JSON.stringify({ ...report, summary }, null, 2));

const hasProblems = summary.formatErrors > 0 || Object.keys(summary.failedChecks).length > 0 || report.aborted;
if (hasProblems) process.exitCode = 1;
