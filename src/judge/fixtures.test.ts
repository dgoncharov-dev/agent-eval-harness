import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { z } from "zod";
import { loadCases } from "../harness/cases.js";
import { QuoteSchema } from "../sut/schema.js";

const Verdict = z.enum(["pass", "fail"]);
const FixtureSchema = z.strictObject({
  id: z.string().min(1),
  message: z.string().min(1),
  quote: QuoteSchema,
  expected: z.strictObject({ load_size: Verdict, commitments: Verdict, hazardous: Verdict }),
});

const path = (relative: string) => fileURLToPath(new URL(relative, import.meta.url));

describe("judge-fixtures/fixtures.json", () => {
  it("matches the fixture schema, has unique ids, and uses messages copied from cases/quotes.json", async () => {
    const parsed = z.array(FixtureSchema).parse(JSON.parse(await readFile(path("../../judge-fixtures/fixtures.json"), "utf8")));
    const caseMessages = new Set((await loadCases(path("../../cases/quotes.json"))).map((c) => c.message));

    expect(parsed).toHaveLength(13);
    expect(new Set(parsed.map((f) => f.id)).size).toBe(parsed.length);
    for (const fixture of parsed) {
      expect(caseMessages.has(fixture.message), `${fixture.id}: message not found in cases/quotes.json`).toBe(true);
    }
  });
});
