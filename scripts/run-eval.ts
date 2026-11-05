import "dotenv/config";
import { copyFile, mkdir, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { MODELS } from "../src/config.js";
import { loadCases } from "../src/harness/cases.js";
import { parseEvalFlags, type EvalFlags } from "../src/harness/flags.js";
import {
  findDisagreements,
  gateCounts,
  GATE_NAMES,
  judgeCrossTable,
  QUALITY_NAMES,
} from "../src/harness/judgeStats.js";
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
const run = await runAll(cases, {
  repeats: flags.repeats,
  maxTotalTokens: flags.maxTokens,
  judge: flags.judge,
  ...(flags.maxJudgeTokens !== undefined ? { maxJudgeTokens: flags.maxJudgeTokens } : {}),
});
const summary = summarize(run);

console.log("");
for (const aggregate of run.cases) {
  const rate = `${aggregate.outcomes.passed}/${aggregate.attempts.length}`;
  const notPassed = OUTCOMES.filter((o) => o !== "passed" && aggregate.outcomes[o] > 0)
    .map((o) => `${o}=${aggregate.outcomes[o]}`)
    .join(" ");
  let line = `${aggregate.id.padEnd(26)} ${rate.padEnd(5)} ${notPassed.padEnd(24)}`;
  if (flags.judge) {
    const counts = gateCounts(aggregate.attempts);
    line += ` judge: ${GATE_NAMES.map((g) => `${g} ${counts[g].pass}/${counts[g].total}`).join("  ")}`;
  }
  console.log(line.trimEnd());
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

const judgeSummary = summary.judge;
if (judgeSummary) {
  const pct = (rate: number) => `${(rate * 100).toFixed(1)}%`;
  console.log("");
  console.log(
    `Judge: judged=${judgeSummary.judged} all-gates-pass=${judgeSummary.allGatesPassed}/${judgeSummary.judged}` +
      `  judge_error=${judgeSummary.judgeErrors}  not_judged=${judgeSummary.notJudged}`,
  );
  console.log(
    `Judge gates: ${GATE_NAMES.map((g) => {
      const gate = judgeSummary.gates[g];
      return `${g} ${gate.pass}/${gate.total} (${pct(gate.rate)})`;
    }).join("  ")}`,
  );
  console.log(
    `Judge quality (mean 1-3): ${QUALITY_NAMES.map((q) => {
      const mean = judgeSummary.quality[q];
      return `${q}=${mean === null ? "n/a" : mean.toFixed(2)}`;
    }).join("  ")}`,
  );
  console.log(`Judge tokens: input=${judgeSummary.usage.inputTokens} output=${judgeSummary.usage.outputTokens}`);

  const table = judgeCrossTable(run);
  console.log("");
  console.log("Checks vs judge (judged attempts):");
  console.log(`  ${"".padEnd(13)} ${"judge pass".padEnd(11)} judge fail`);
  console.log(`  ${"checks pass".padEnd(13)} ${String(table.checksPass.judgePass).padEnd(11)} ${table.checksPass.judgeFail}`);
  console.log(`  ${"checks fail".padEnd(13)} ${String(table.checksFail.judgePass).padEnd(11)} ${table.checksFail.judgeFail}`);

  const disagreements = findDisagreements(run);
  console.log("");
  console.log(`Disagreements: ${disagreements.length}`);
  for (const d of disagreements) {
    const checks = d.checksPassed ? "checks passed" : `checks failed (${d.failedChecks.join(", ")})`;
    const judge = d.failedGates.length > 0
      ? `judge failed ${d.failedGates.map((g) => `${g.gate}: ${g.reason}`).join(" | ")}`
      : "judge passed all gates";
    console.log(`  ${d.caseId} #${d.attempt}: ${checks}; ${judge}`);
  }
}

await mkdir(reportsDir, { recursive: true });
const reportPath = `${reportsDir}/run-${timestamp.replaceAll(":", "-")}.json`;
const report = {
  timestamp,
  model: MODELS.sut,
  ...(flags.judge ? { judgeModel: MODELS.judge } : {}),
  repeats: flags.repeats,
  maxTokens: flags.maxTokens,
  ...run,
  summary,
};
await writeFile(reportPath, JSON.stringify(report, null, 2));
await copyFile(reportPath, `${reportsDir}/latest.json`);

// Judge gate failures fail the run like deterministic failures; judge errors and not-judged attempts are only reported.
const judgeFailed = judgeSummary !== undefined && judgeSummary.allGatesPassed < judgeSummary.judged;
if (run.aborted || run.cases.some((c) => c.passRate < 1) || judgeFailed) process.exitCode = 1;
