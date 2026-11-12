import { mkdir, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { parseBaseline } from "../src/harness/baseline.js";
import { readJsonFile } from "../src/harness/readJsonFile.js";
import { parseReportRunFile } from "../src/harness/reportFile.js";
import { renderReportHtml } from "../src/report/renderHtml.js";

const [reportPath, outArg, baselinePath] = process.argv.slice(2);
if (!reportPath) {
  console.error("Usage: npm run report -- <report.json> [out.html] [baseline.json]");
  process.exit(1);
}
const outPath = outArg ?? fileURLToPath(new URL("../reports/report.html", import.meta.url));

try {
  const report = parseReportRunFile(await readJsonFile(reportPath, "report"), reportPath);
  const baseline = baselinePath ? parseBaseline(await readJsonFile(baselinePath, "baseline"), baselinePath) : undefined;
  await mkdir(dirname(outPath), { recursive: true });
  await writeFile(outPath, renderReportHtml(report, baseline));
  console.log(outPath);
} catch (err) {
  console.error(err instanceof Error ? err.message : String(err));
  process.exitCode = 1;
}
