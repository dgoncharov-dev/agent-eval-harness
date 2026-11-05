export type EvalFlags = { repeats: number; maxTokens: number };

const DEFAULT_REPEATS = 3;
const TOKENS_PER_REPEAT = 40_000;

function parsePositiveInt(flag: string, value: string | undefined): number {
  if (value === undefined) throw new Error(`${flag} needs a value`);
  if (!/^[1-9]\d*$/.test(value) || !Number.isSafeInteger(Number(value))) {
    throw new Error(`${flag} must be a positive integer, got "${value}"`);
  }
  return Number(value);
}

// Accepts "--repeats 5" and "--repeats=5" (same for --max-tokens).
export function parseEvalFlags(argv: readonly string[]): EvalFlags {
  let repeats: number | undefined;
  let maxTokens: number | undefined;

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
    else throw new Error(`Unknown argument "${arg}". Supported: --repeats N, --max-tokens N`);
  }

  const resolvedRepeats = repeats ?? DEFAULT_REPEATS;
  return { repeats: resolvedRepeats, maxTokens: maxTokens ?? resolvedRepeats * TOKENS_PER_REPEAT };
}
