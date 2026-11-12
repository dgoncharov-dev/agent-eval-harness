import "dotenv/config";
import { fileURLToPath } from "node:url";
import { loadCases } from "../src/harness/cases.js";
import { parseProbeArgs, type ProbeArgs } from "../src/harness/flags.js";
import { isAuthError } from "../src/harness/run.js";
import { NoToolUseError, QuoteValidationError, runQuote } from "../src/sut/quote.js";

type ProbeOutcome = "ok" | "validation_error" | "no_tool_use" | "api_error";

let args: ProbeArgs;
try {
  args = parseProbeArgs(process.argv.slice(2));
} catch (err) {
  console.error(err instanceof Error ? err.message : String(err));
  process.exit(1);
}

const cases = await loadCases(fileURLToPath(new URL("../cases/quotes.json", import.meta.url)));
const testCase = cases.find((c) => c.id === args.caseId);
if (!testCase) {
  console.error(`Unknown case "${args.caseId}". Valid ids: ${cases.map((c) => c.id).join(", ")}`);
  process.exit(1);
}

// "number", "string", "boolean", "array", "null", ... for each top-level field, so a string where a number belongs stands out.
function fieldTypes(raw: unknown): string {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) return `(tool input is ${Array.isArray(raw) ? "an array" : typeof raw})`;
  return Object.entries(raw)
    .map(([key, value]) => `${key}: ${value === null ? "null" : Array.isArray(value) ? "array" : typeof value}`)
    .join(", ");
}

const counts: Record<ProbeOutcome, number> = { ok: 0, validation_error: 0, no_tool_use: 0, api_error: 0 };
const failed: number[] = [];

console.log(`Probing "${testCase.id}" x ${args.n}`);
for (let attempt = 1; attempt <= args.n; attempt++) {
  let outcome: ProbeOutcome;
  try {
    const { quote } = await runQuote(testCase.message);
    outcome = "ok";
    console.log(
      `#${attempt} ok  can_serve=${quote.can_serve} yards=${quote.estimated_cubic_yards} ` +
        `price_low=${quote.price_low} price_high=${quote.price_high} needs_photos=${quote.needs_photos}`,
    );
  } catch (err) {
    if (isAuthError(err)) throw err;
    if (err instanceof QuoteValidationError) {
      outcome = "validation_error";
      console.log(`#${attempt} validation_error`);
      for (const issue of err.issues) console.log(`    issue: ${issue.path.join(".") || "(root)"}: ${issue.message}`);
      console.log(`    field types: ${fieldTypes(err.rawInput)}`);
      console.log(`    raw input: ${JSON.stringify(err.rawInput)}`);
    } else if (err instanceof NoToolUseError) {
      outcome = "no_tool_use";
      console.log(`#${attempt} no_tool_use  stop_reason=${err.stopReason ?? "null"}`);
    } else {
      outcome = "api_error";
      console.log(`#${attempt} api_error  ${err instanceof Error ? err.message : String(err)}`);
    }
  }
  counts[outcome]++;
  if (outcome !== "ok") failed.push(attempt);
}

console.log("");
console.log(`Summary: ${(Object.keys(counts) as ProbeOutcome[]).map((o) => `${o}=${counts[o]}`).join(" ")}`);
console.log(`Failed attempts: ${failed.length === 0 ? "none" : failed.map((n) => `#${n}`).join(", ")}`);
if (failed.length > 0) process.exitCode = 1;
