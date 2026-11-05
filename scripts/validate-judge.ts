import "dotenv/config";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { z } from "zod";
import { JudgeNoToolUseError, JudgeValidationError, judgeQuote } from "../src/judge/judge.js";
import { QuoteSchema } from "../src/sut/schema.js";

const RUNS_PER_FIXTURE = 3;
const GATES = ["load_size", "commitments", "hazardous"] as const;

const Verdict = z.enum(["pass", "fail"]);
const FixtureSchema = z.strictObject({
  id: z.string().min(1),
  message: z.string().min(1),
  quote: QuoteSchema,
  expected: z.strictObject({ load_size: Verdict, commitments: Verdict, hazardous: Verdict }),
});

const fixturesPath = fileURLToPath(new URL("../judge-fixtures/fixtures.json", import.meta.url));
const parsed = z.array(FixtureSchema).safeParse(JSON.parse(await readFile(fixturesPath, "utf8")));
if (!parsed.success) {
  console.error(`Invalid fixtures file:\n${z.prettifyError(parsed.error)}`);
  process.exit(1);
}

let runs = 0;
let formatFailures = 0;
// Gate verdicts are only counted for runs that returned a valid judgment.
let verdicts = 0;
let matches = 0;
let inputTokens = 0;
let outputTokens = 0;

for (const fixture of parsed.data) {
  console.log(`\n${fixture.id}`);
  for (let run = 1; run <= RUNS_PER_FIXTURE; run++) {
    runs++;
    try {
      const { judgment, usage } = await judgeQuote({ message: fixture.message }, fixture.quote);
      inputTokens += usage.inputTokens;
      outputTokens += usage.outputTokens;
      const cells = GATES.map((gate) => {
        const got = judgment.gates[gate].pass ? "pass" : "fail";
        const expected = fixture.expected[gate];
        verdicts++;
        if (got === expected) matches++;
        return `${gate}: expected ${expected}, got ${got}${got === expected ? "" : "  <-- MISMATCH"}`;
      });
      console.log(`  run ${run}: ${cells.join(" | ")}`);
    } catch (err) {
      // A malformed judge reply is its own outcome, not a gate mismatch; anything else (e.g. a bad key) stops the run.
      if (err instanceof JudgeNoToolUseError || err instanceof JudgeValidationError) {
        inputTokens += err.usage.inputTokens;
        outputTokens += err.usage.outputTokens;
        formatFailures++;
        const outcome = err instanceof JudgeNoToolUseError ? "no_tool" : "invalid_shape";
        console.log(`  run ${run}: ${outcome} (${err.message.split("\n")[0]})`);
      } else {
        throw err;
      }
    }
  }
}

console.log("");
const agreement = verdicts === 0 ? "n/a" : `${((matches / verdicts) * 100).toFixed(1)}%`;
console.log(`Agreement: ${matches}/${verdicts} gate verdicts from valid runs (${agreement})`);
console.log(`format failures: ${formatFailures} of ${runs} runs`);
console.log(`Tokens: input=${inputTokens} output=${outputTokens}`);
if (matches !== verdicts || formatFailures > 0) process.exitCode = 1;
