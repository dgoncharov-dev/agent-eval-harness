import { checkBaseline, type Baseline, type BaselineRow } from "../harness/baseline.js";
import {
  findDisagreements,
  gateCounts,
  GATE_NAMES,
  judgeCrossTable,
  QUALITY_NAMES,
  summarizeJudge,
} from "../harness/judgeStats.js";
import type { ReportRun } from "../harness/reportFile.js";

type Attempt = ReportRun["cases"][number]["attempts"][number];

// Every piece of model, customer or file text goes through this before it is placed in the page.
export function escapeHtml(text: string): string {
  return text.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;").replaceAll("'", "&#39;");
}

const e = escapeHtml;
const pct = (rate: number) => `${(rate * 100).toFixed(0)}%`;
const ratio = (pass: number, total: number) => (total === 0 ? "-" : `${pass}/${total}`);
const tokens = (n: number) => n.toLocaleString("en-US");

const CSS = `
:root{--bg:#fbfbfa;--fg:#1d1d1b;--muted:#5f5f5a;--card:#ffffff;--line:#d9d9d4;--ok:#1a7f37;--bad:#b42318;--info:#0b5cad;--bar:#e4e4df;--code:#f0f0ec}
@media (prefers-color-scheme:dark){:root{--bg:#161615;--fg:#ececea;--muted:#a3a39d;--card:#1f1f1d;--line:#3a3a36;--ok:#4ac26b;--bad:#ff7b72;--info:#6cb2ff;--bar:#3a3a36;--code:#262624}}
*{box-sizing:border-box}
html{color-scheme:light dark}
body{margin:0;background:var(--bg);color:var(--fg);font:16px/1.5 system-ui,-apple-system,"Segoe UI",Roboto,sans-serif}
main{max-width:960px;margin:0 auto;padding:16px}
h1{font-size:1.5rem;margin:0 0 4px}
h2{font-size:1.15rem;margin:28px 0 8px}
p,li{overflow-wrap:anywhere}
.muted{color:var(--muted)}
.stats{display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:8px;margin:12px 0}
.stat{background:var(--card);border:1px solid var(--line);border-radius:6px;padding:8px 10px}
.stat b{display:block;font-size:1.15rem}
.scroll{overflow-x:auto;border:1px solid var(--line);border-radius:6px;background:var(--card)}
table{border-collapse:collapse;width:100%;font-size:.92rem}
th,td{text-align:left;padding:6px 10px;border-bottom:1px solid var(--line);white-space:nowrap}
tr:last-child td{border-bottom:0}
th{color:var(--muted);font-weight:600}
.bar{display:inline-block;width:64px;height:8px;background:var(--bar);border-radius:4px;vertical-align:middle;margin-left:6px;overflow:hidden}
.fill{display:block;height:100%;background:var(--ok)}
.ok{color:var(--ok)}.below{color:var(--bad);font-weight:600}.improved{color:var(--info)}
details{background:var(--card);border:1px solid var(--line);border-radius:6px;margin:8px 0;padding:8px 10px}
summary{cursor:pointer;overflow-wrap:anywhere}
pre{background:var(--code);border-radius:6px;padding:8px 10px;margin:8px 0 0;white-space:pre-wrap;overflow-wrap:anywhere}
ul{padding-left:20px;margin:6px 0}
`;

const statCell = (label: string, value: string) => `<div class="stat"><span class="muted">${e(label)}</span><b>${e(value)}</b></div>`;

function hasJudgeData(report: ReportRun): boolean {
  return report.cases.some((c) => c.attempts.some((a) => a.judgment || a.judgeError || a.notJudged));
}

function header(report: ReportRun, judged: boolean): string {
  const all = report.cases.flatMap((c) => c.attempts);
  const passed = all.filter((a) => a.outcome === "passed").length;
  const sutIn = all.reduce((sum, a) => sum + a.usage.inputTokens, 0);
  const sutOut = all.reduce((sum, a) => sum + a.usage.outputTokens, 0);
  const cells = [
    statCell("Run", report.timestamp),
    statCell("SUT model", report.model),
    statCell("Repeats", String(report.repeats)),
    statCell("Attempts", String(all.length)),
    statCell("Deterministic pass rate", all.length === 0 ? "-" : `${passed}/${all.length} (${pct(passed / all.length)})`),
    statCell("SUT tokens", `${tokens(sutIn)} in / ${tokens(sutOut)} out`),
  ];
  if (judged) {
    const judge = summarizeJudge(report);
    cells.splice(2, 0, statCell("Judge model", report.judgeModel ?? "unknown"));
    cells.push(
      statCell("Judge all-gates rate", judge.judged === 0 ? "-" : `${judge.allGatesPassed}/${judge.judged} (${pct(judge.allGatesPassed / judge.judged)})`),
      statCell("Judge tokens", `${tokens(judge.usage.inputTokens)} in / ${tokens(judge.usage.outputTokens)} out`),
    );
  }
  const aborted = report.aborted === true ? `<p class="below">This run was aborted: the token budget was exceeded.</p>` : "";
  return `<h1>Eval report</h1>${aborted}<div class="stats">${cells.join("")}</div>`;
}

function caseTable(report: ReportRun, judged: boolean, baseline: Baseline | undefined): string {
  const rows = new Map<string, BaselineRow>(
    baseline ? checkBaseline(report, baseline).rows.map((row) => [row.caseId, row]) : [],
  );
  const head = [
    "<th>Case</th>",
    "<th>Pass</th>",
    ...(judged ? GATE_NAMES.map((g) => `<th>${e(g)}</th>`) : []),
    ...(baseline ? ["<th>Min</th>", "<th>Status</th>"] : []),
  ].join("");

  const body = report.cases
    .map((c) => {
      const passed = c.attempts.filter((a) => a.outcome === "passed").length;
      const width = c.attempts.length === 0 ? 0 : Math.round((passed / c.attempts.length) * 100);
      const cells = [
        `<td>${e(c.id)}</td>`,
        `<td>${passed}/${c.attempts.length}<span class="bar"><span class="fill" style="width:${width}%"></span></span></td>`,
      ];
      if (judged) {
        const counts = gateCounts(c.attempts);
        for (const gate of GATE_NAMES) cells.push(`<td>${ratio(counts[gate].pass, counts[gate].total)}</td>`);
      }
      if (baseline) {
        const row = rows.get(c.id);
        cells.push(`<td>${row ? pct(row.minPassRate) : "-"}</td>`);
        cells.push(row ? `<td class="${row.status}">${row.status}</td>` : "<td>-</td>");
      }
      return `<tr>${cells.join("")}</tr>`;
    })
    .join("");

  return `<h2>Cases</h2><div class="scroll"><table><thead><tr>${head}</tr></thead><tbody>${body}</tbody></table></div>`;
}

function judgeSections(report: ReportRun): string {
  const table = judgeCrossTable(report);
  const disagreements = findDisagreements(report);
  const judge = summarizeJudge(report);

  const cross = `<h2>Checks vs judge</h2><div class="scroll"><table><thead><tr><th></th><th>Judge pass</th><th>Judge fail</th></tr></thead><tbody>
<tr><td>Checks pass</td><td>${table.checksPass.judgePass}</td><td>${table.checksPass.judgeFail}</td></tr>
<tr><td>Checks fail</td><td>${table.checksFail.judgePass}</td><td>${table.checksFail.judgeFail}</td></tr></tbody></table></div>
<p class="muted">Judged attempts: ${judge.judged}. Judge errors: ${judge.judgeErrors}. Not judged: ${judge.notJudged}.</p>`;

  const items = disagreements.map((d) => {
    const checks = d.checksPassed ? "checks passed" : `checks failed (${d.failedChecks.map(e).join(", ")})`;
    const gates =
      d.failedGates.length > 0
        ? `judge failed ${d.failedGates.map((g) => `${e(g.gate)}: ${e(g.reason)}`).join(" | ")}`
        : "judge passed all gates";
    return `<li>${e(d.caseId)} #${d.attempt}: ${checks}; ${gates}</li>`;
  });
  const disagreementList = `<h3>Disagreements (${disagreements.length})</h3>${items.length === 0 ? '<p class="muted">None.</p>' : `<ul>${items.join("")}</ul>`}`;

  const quality = `<h2>Quality (mean score, 1-3)</h2><div class="scroll"><table><thead><tr>${QUALITY_NAMES.map((q) => `<th>${e(q)}</th>`).join("")}</tr></thead><tbody><tr>${QUALITY_NAMES.map((q) => {
    const mean = judge.quality[q];
    return `<td>${mean === null ? "n/a" : mean.toFixed(2)}</td>`;
  }).join("")}</tr></tbody></table></div>`;

  return cross + disagreementList + quality;
}

function failureBlock(caseId: string, message: string | undefined, attemptNumber: number, attempt: Attempt): string | undefined {
  const failedChecks = attempt.checks.filter((c) => !c.passed);
  const failedGates = attempt.judgment ? GATE_NAMES.filter((g) => !attempt.judgment?.gates[g].pass) : [];
  if (attempt.outcome === "passed" && failedGates.length === 0) return undefined;

  const parts: string[] = [];
  if (failedChecks.length > 0) {
    parts.push(`<p>Failed checks</p><ul>${failedChecks.map((c) => `<li>${e(c.name)}: ${e(c.detail)}</li>`).join("")}</ul>`);
  }
  if (attempt.error !== undefined) parts.push(`<p>Error</p><pre>${e(attempt.error)}</pre>`);
  if (attempt.judgment && failedGates.length > 0) {
    const judgment = attempt.judgment;
    parts.push(`<p>Judge failed gates</p><ul>${failedGates.map((g) => `<li>${e(g)}: ${e(judgment.gates[g].reason)}</li>`).join("")}</ul>`);
  }
  if (attempt.judgeError) parts.push(`<p>Judge error (${e(attempt.judgeError.kind)})</p><pre>${e(attempt.judgeError.message)}</pre>`);
  if (message !== undefined) parts.push(`<p>Customer message</p><pre>${e(message)}</pre>`);
  parts.push(`<p>Reply</p><pre>${attempt.quote ? e(attempt.quote.customer_message) : "(no reply)"}</pre>`);

  const reasons = [attempt.outcome !== "passed" ? attempt.outcome : undefined, failedGates.length > 0 ? "judge gate" : undefined]
    .filter((r): r is string => r !== undefined)
    .join(", ");
  return `<details><summary>${e(caseId)} #${attemptNumber} (${e(reasons)})</summary>${parts.join("")}</details>`;
}

function failures(report: ReportRun): string {
  const blocks = report.cases.flatMap((c) =>
    c.attempts.flatMap((attempt, index) => failureBlock(c.id, c.message, index + 1, attempt) ?? []),
  );
  return `<h2>Failures (${blocks.length})</h2>${blocks.length === 0 ? '<p class="muted">No failing attempts.</p>' : blocks.join("")}`;
}

export function renderReportHtml(report: ReportRun, baseline?: Baseline): string {
  const judged = hasJudgeData(report);
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Eval report</title>
<style>${CSS}</style>
</head>
<body>
<main>
${header(report, judged)}
${caseTable(report, judged, baseline)}
${judged ? judgeSections(report) : ""}
${failures(report)}
</main>
</body>
</html>
`;
}
