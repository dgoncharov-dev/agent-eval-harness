import "dotenv/config";
import { copyFile, mkdir, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { MODELS } from "../src/config.js";
import { loadCases } from "../src/harness/cases.js";
import { parseEvalFlags, type EvalFlags } from "../src/harness/flags.js";
import { OUTCOMES, runAll, summarize } from "../src/harness/run.js";

let flags: EvalFlags;
try {
  flags = parseEvalFlags(process.argv.slice(2));
} catch (err) {
  console.error(err instanceof Error ? err.message : String(err));
  process.exit(1);
}

const casesPath = fileURLToPath(new URL("../cases/quotes.json", import.meta.url));
const reportsDir = fileURLToPath(new URL("../reports", import.meta.url));

const cases = await loadCases(casesPath);
const timestamp = new Date().toISOString();
const run = await runAll(cases, { repeats: flags.repeats, maxTotalTokens: flags.maxTokens });
const summary = summarize(run);

console.log("");
for (const aggregate of run.cases) {
  const rate = `${aggregate.outcomes.passed}/${aggregate.attempts.length}`;
  const notPassed = OUTCOMES.filter((o) => o !== "passed" && aggregate.outcomes[o] > 0)
    .map((o) => `${o}=${aggregate.outcomes[o]}`)
    .join(" ");
  console.log(`${aggregate.id.padEnd(26)} ${rate.padEnd(5)} ${notPassed}`);
}

console.log("");
console.log(`Attempts: ${summary.attempts}  Pass rate: ${summary.outcomes.passed}/${summary.attempts}`);
console.log(`Outcomes: ${OUTCOMES.map((o) => `${o}=${summary.outcomes[o]}`).join(" ")}`);
const failedEntries = Object.entries(summary.failedChecks);
console.log(
  failedEntries.length > 0
    ? `Failed checks: ${failedEntries.map(([name, count]) => `${name}=${count}`).join(", ")}`
    : "Failed checks: none",
);
console.log(`Tokens: input=${summary.totalInputTokens} output=${summary.totalOutputTokens}`);
if (run.aborted) {
  console.log(`ABORTED: token budget ${flags.maxTokens} exceeded, not started: ${run.skipped.join(", ") || "(none)"}`);
}

await mkdir(reportsDir, { recursive: true });
const reportPath = `${reportsDir}/run-${timestamp.replaceAll(":", "-")}.json`;
const report = { timestamp, model: MODELS.sut, repeats: flags.repeats, maxTokens: flags.maxTokens, ...run, summary };
await writeFile(reportPath, JSON.stringify(report, null, 2));
await copyFile(reportPath, `${reportsDir}/latest.json`);

if (run.aborted || run.cases.some((c) => c.passRate < 1)) process.exitCode = 1;
