import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { loadCases } from "./cases.js";

const validCase = {
  id: "a",
  message: "I have an old couch in Kirkland.",
  expect: { inServiceArea: true, canServe: true, shouldRequestPhotos: null },
};

describe("loadCases", () => {
  let dir: string;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "cases-test-"));
  });
  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  async function writeCases(value: unknown): Promise<string> {
    const path = join(dir, "cases.json");
    await writeFile(path, JSON.stringify(value));
    return path;
  }

  it("loads a valid file", async () => {
    const path = await writeCases([validCase, { ...validCase, id: "b" }]);
    expect(await loadCases(path)).toHaveLength(2);
  });

  it("rejects duplicate ids with a clear error", async () => {
    const path = await writeCases([validCase, { ...validCase, message: "different" }]);
    await expect(loadCases(path)).rejects.toThrow(/Duplicate case ids.*: a/);
  });

  it("rejects a case with the wrong shape", async () => {
    const path = await writeCases([{ ...validCase, expect: { inServiceArea: true, shouldRequestPhotos: null } }]);
    await expect(loadCases(path)).rejects.toThrow(/Invalid cases file/);
  });

  it("loads the real cases/quotes.json", async () => {
    const path = fileURLToPath(new URL("../../cases/quotes.json", import.meta.url));
    expect(await loadCases(path)).toHaveLength(13);
  });
});
