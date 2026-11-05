import { describe, expect, it } from "vitest";
import { parseEvalFlags } from "./flags.js";

describe("parseEvalFlags", () => {
  it("defaults to 3 repeats and repeats * 40000 tokens", () => {
    expect(parseEvalFlags([])).toEqual({ repeats: 3, maxTokens: 120_000 });
  });

  it("derives the default token budget from --repeats", () => {
    expect(parseEvalFlags(["--repeats", "5"])).toEqual({ repeats: 5, maxTokens: 200_000 });
  });

  it("lets --max-tokens override the derived budget", () => {
    expect(parseEvalFlags(["--repeats", "2", "--max-tokens", "1000"])).toEqual({ repeats: 2, maxTokens: 1000 });
  });

  it("accepts the --flag=value form", () => {
    expect(parseEvalFlags(["--repeats=4", "--max-tokens=500"])).toEqual({ repeats: 4, maxTokens: 500 });
  });

  it.each(["0", "-2", "1.5", "abc", "1e3", ""])("rejects --repeats %j", (value) => {
    expect(() => parseEvalFlags(["--repeats", value])).toThrow(/--repeats must be a positive integer/);
  });

  it.each(["0", "-1", "2.5", "lots"])("rejects --max-tokens %j", (value) => {
    expect(() => parseEvalFlags(["--max-tokens", value])).toThrow(/--max-tokens must be a positive integer/);
  });

  it("rejects a flag with no value", () => {
    expect(() => parseEvalFlags(["--repeats"])).toThrow(/--repeats needs a value/);
  });

  it("rejects unknown arguments", () => {
    expect(() => parseEvalFlags(["--repeat", "3"])).toThrow(/Unknown argument/);
  });
});
