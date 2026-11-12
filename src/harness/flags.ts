export type EvalFlags = {
  repeats: number;
  maxTokens: number;
  judge: boolean;
  // undefined means "use the default", which runAll derives from the attempt count.
  maxJudgeTokens: number | undefined;
};

const DEFAULT_REPEATS = 3;
const TOKENS_PER_REPEAT = 40_000;
const SUPPORTED = "--repeats N, --max-tokens N, --judge, --max-judge-tokens N";

function parsePositiveInt(flag: string, value: string | undefined): number {
  if (value === undefined) throw new Error(`${flag} needs a value`);
  if (!/^[1-9]\d*$/.test(value) || !Number.isSafeInteger(Number(value))) {
    throw new Error(`${flag} must be a positive integer, got "${value}"`);
  }
  return Number(value);
}

// Accepts "--repeats 5" and "--repeats=5" (same for --max-tokens and --max-judge-tokens); --judge is a bare switch.
export function parseEvalFlags(argv: readonly string[]): EvalFlags {
  let repeats: number | undefined;
  let maxTokens: number | undefined;
  let judge = false;
  let maxJudgeTokens: number | undefined;

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i] ?? "";
    const [flag = "", inlineValue] = arg.split("=", 2);
    const takeValue = (): string | undefined => {
      if (inlineValue !== undefined) return inlineValue;
      i++;
      return argv[i];
    };

    if (flag === "--repeats") repeats = parsePositiveInt(flag, takeValue());
    else if (flag === "--max-tokens") maxTokens = parsePositiveInt(flag, takeValue());
    else if (flag === "--max-judge-tokens") maxJudgeTokens = parsePositiveInt(flag, takeValue());
    else if (flag === "--judge") {
      if (inlineValue !== undefined) throw new Error("--judge does not take a value");
      judge = true;
    } else throw new Error(`Unknown argument "${arg}". Supported: ${SUPPORTED}`);
  }

  if (maxJudgeTokens !== undefined && !judge) throw new Error("--max-judge-tokens requires --judge");

  const resolvedRepeats = repeats ?? DEFAULT_REPEATS;
  return {
    repeats: resolvedRepeats,
    maxTokens: maxTokens ?? resolvedRepeats * TOKENS_PER_REPEAT,
    judge,
    maxJudgeTokens,
  };
}

export type ProbeArgs = { caseId: string; n: number };

const DEFAULT_PROBE_N = 20;
const MAX_PROBE_N = 50;

// probe-case.ts <case-id> [--n N]; N is a positive integer up to 50. Accepts "--n 5" and "--n=5".
export function parseProbeArgs(argv: readonly string[]): ProbeArgs {
  let caseId: string | undefined;
  let n = DEFAULT_PROBE_N;

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i] ?? "";
    const [flag = "", inlineValue] = arg.split("=", 2);
    if (flag === "--n") {
      const value = inlineValue ?? argv[++i];
      n = parsePositiveInt(flag, value);
      if (n > MAX_PROBE_N) throw new Error(`--n must be at most ${MAX_PROBE_N}, got "${value}"`);
    } else if (arg.startsWith("-")) {
      throw new Error(`Unknown argument "${arg}". Usage: probe-case.ts <case-id> [--n N]`);
    } else if (caseId === undefined) {
      caseId = arg;
    } else {
      throw new Error(`Unexpected extra argument "${arg}". Usage: probe-case.ts <case-id> [--n N]`);
    }
  }

  if (caseId === undefined) throw new Error("Missing case id. Usage: probe-case.ts <case-id> [--n N]");
  return { caseId, n };
}
