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
