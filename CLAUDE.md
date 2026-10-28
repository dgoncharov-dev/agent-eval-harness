# agent-eval-harness
Eval harness for a Claude-powered junk-removal quoting assistant.
Stack: TypeScript (strict), Vitest, Anthropic SDK, zod. Playwright is used later for the HTML report.
Rules: no `any`; every check is a pure function (QuoteResult, Case) => CheckResult; never hardcode keys;
never read or print the contents of .env; SUT uses a small/cheap model, judge uses a stronger one, both set in src/config.ts; log token usage per call.
