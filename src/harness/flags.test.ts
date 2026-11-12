import { describe, expect, it } from "vitest";
import { parseEvalFlags, parseProbeArgs } from "./flags.js";

describe("parseEvalFlags", () => {
  it("defaults to 3 repeats, repeats * 40000 tokens, and no judge", () => {
    expect(parseEvalFlags([])).toEqual({ repeats: 3, maxTokens: 120_000, judge: false, maxJudgeTokens: undefined });
  });

  it("derives the default token budget from --repeats", () => {
    expect(parseEvalFlags(["--repeats", "5"])).toMatchObject({ repeats: 5, maxTokens: 200_000 });
  });

  it("lets --max-tokens override the derived budget", () => {
    expect(parseEvalFlags(["--repeats", "2", "--max-tokens", "1000"])).toMatchObject({ repeats: 2, maxTokens: 1000 });
  });

  it("accepts the --flag=value form", () => {
    expect(parseEvalFlags(["--repeats=4", "--max-tokens=500"])).toMatchObject({ repeats: 4, maxTokens: 500 });
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

describe("parseEvalFlags: judge flags", () => {
  it("turns the judge on with a bare --judge", () => {
    expect(parseEvalFlags(["--judge"])).toMatchObject({ judge: true, maxJudgeTokens: undefined });
  });

  it("accepts --max-judge-tokens with --judge, in either value form", () => {
    expect(parseEvalFlags(["--judge", "--max-judge-tokens", "20000"])).toMatchObject({
      judge: true,
      maxJudgeTokens: 20_000,
    });
    expect(parseEvalFlags(["--max-judge-tokens=7000", "--judge"])).toMatchObject({ maxJudgeTokens: 7000 });
  });

  it.each(["0", "-5", "1.5", "abc", "1e3", ""])("rejects --max-judge-tokens %j", (value) => {
    expect(() => parseEvalFlags(["--judge", "--max-judge-tokens", value])).toThrow(
      /--max-judge-tokens must be a positive integer/,
    );
  });

  it("rejects --max-judge-tokens with no value", () => {
    expect(() => parseEvalFlags(["--judge", "--max-judge-tokens"])).toThrow(/--max-judge-tokens needs a value/);
  });

  it("rejects --max-judge-tokens without --judge", () => {
    expect(() => parseEvalFlags(["--max-judge-tokens", "5000"])).toThrow(/requires --judge/);
  });

  it("rejects a value on the bare --judge switch", () => {
    expect(() => parseEvalFlags(["--judge=true"])).toThrow(/--judge does not take a value/);
  });

  it("does not let the judge flags change the SUT defaults", () => {
    expect(parseEvalFlags(["--judge"])).toMatchObject({ repeats: 3, maxTokens: 120_000 });
  });
});

describe("parseProbeArgs", () => {
  it("defaults to 20 attempts", () => {
    expect(parseProbeArgs(["same-day-demand"])).toEqual({ caseId: "same-day-demand", n: 20 });
  });

  it("accepts --n in both forms, before or after the case id", () => {
    expect(parseProbeArgs(["a", "--n", "5"])).toEqual({ caseId: "a", n: 5 });
    expect(parseProbeArgs(["--n=7", "a"])).toEqual({ caseId: "a", n: 7 });
  });

  it("accepts the maximum of 50 and rejects 51", () => {
    expect(parseProbeArgs(["a", "--n", "50"]).n).toBe(50);
    expect(() => parseProbeArgs(["a", "--n", "51"])).toThrow(/--n must be at most 50/);
  });

  it.each(["0", "-3", "2.5", "abc", "1e1", ""])("rejects --n %j", (value) => {
    expect(() => parseProbeArgs(["a", "--n", value])).toThrow(/--n must be a positive integer/);
  });

  it("rejects --n with no value", () => {
    expect(() => parseProbeArgs(["a", "--n"])).toThrow(/--n needs a value/);
  });

  it("rejects a missing case id, extra positionals and unknown flags", () => {
    expect(() => parseProbeArgs([])).toThrow(/Missing case id/);
    expect(() => parseProbeArgs(["--n", "3"])).toThrow(/Missing case id/);
    expect(() => parseProbeArgs(["a", "b"])).toThrow(/Unexpected extra argument "b"/);
    expect(() => parseProbeArgs(["a", "--count", "3"])).toThrow(/Unknown argument "--count"/);
  });
});
