# Findings

Preliminary results from running this harness against its system under test (SUT), a fictional junk-removal quoting assistant. Date: 2026-11-04.

**Read these with care.** The samples are small (a handful of runs, one reply per case per run), and the prompt changed between some of the runs. They show what the harness can surface. They are not statistics.

## Setup

- **SUT:** "Evergreen Haul-Away" (fictional), `claude-haiku-5-5`, forced `submit_quote` tool call, output validated with zod.
- **Cases:** 13 hand-written customer messages: clear and vague loads, discount and price-match requests, same-day and guaranteed-window demands, two out-of-area cities, hazardous items, hazardous items mixed with furniture, and a hoarder garage.
- **Checks:** 8 deterministic checks (price order, price limits, discount language, availability promises, service-area handling, photos requested, `can_serve` matches expectation, items present when serving). The 89 unit tests pass, and 5 more tests are marked expected-fail to document known limits.
- **Not built yet:** the LLM judge, repeated runs with pass rates, and the CI baseline.

## 1. Measurement

### A single run hides flakiness
Run 1 reported no failures. Over the next four runs of the same 13 cases, `hoarder-garage` failed 3 times and `vague-load` failed once. A one-shot pass tells you very little with a sampled model.

### The same message produced different estimates
"Old couch and queen mattress" came back as 3, 4 and 5 cubic yards ($120-210, $160-280, $200-350) across separate calls. The prompt changed between some of them, so this is suggestive, not proof. Every price matched its own volume estimate (yards x $40-70), so all deterministic checks passed while the quote moved by nearly 2x.

### Wording almost never repeats
Across paired runs, 0 of 13 customer messages were word-for-word identical. The checks passed or failed consistently anyway, because they look for phrases and not exact text.

## 2. System under test

### A passing check is not a good answer (spec gap)
`vague-load` ("a bunch of stuff in my garage") passed with 0 cubic yards and a flat $99-$99 quote. The rule said "never price at 0 when serving", and the model satisfied the letter with a meaningless number. This is the gap an LLM judge is meant to cover.

### A rule the model keeps breaking (model failure)
`hoarder-garage` returned $0-$0 with `can_serve: true` in 3 of 4 runs, despite an explicit rule against zero prices. The cause was not investigated. It is kept as a known failure so a later prompt change can be measured against it.

### Prompt changes spread (side effect)
After a rule about hazardous materials was added, unrelated replies (vague load, hoarder garage) started telling customers to leave out paint and propane. A "mention only if the customer's request includes them" rule fixed it. One rule can change cases it was not written for, which is what a regression suite is for.

## 3. Design bugs the harness exposed

- **No way to decline.** The out-of-area cases (Tacoma, Everett) failed the price check on correct replies, because the schema forced a price even when declining. Fix: a `can_serve` field, prices of 0 only when it is false, and a check that `can_serve` matches the case.
- **Prompt and schema disagreed.** The prompt said to leave hazardous items out of the quote, and the schema required at least one item. For a request that was only paint and a propane tank, the model followed the prompt, returned an empty list, and failed validation (a format error in 2 of 2 runs). Fix: allow an empty list when declining and enforce "items present when serving" as a separate behavior check.
- **"In the service area" is not "can be served".** A request can be in the area and still unservable (all hazardous). The case expectations now carry both fields.

## 4. Checks: bugs and limits

### The first failures were mostly check bugs
- `guaranteed-window-ask` was flagged for "Saturday", the customer's own word, inside a correct refusal.
- `same-day-demand` was flagged for "3pm" inside a refusal ("I can't confirm a 3pm arrival"), but the same reply also said the team would "lock in a time for today", a real slip. The check failed it for a half-wrong reason. Moving to sentence-level evaluation cleared the false positives. Later runs passed, probably because the replies stopped containing the slip, so this is not proof that the check catches it.

### Code review found bugs the green tests did not
- A bare "no" counted as a refusal, so "No problem! Happy to give you a 10% off coupon." would have passed the discount check.
- "We don't cover hazardous waste" was read as "outside our service area".

Both were fixed and now have tests. Tests written by the same author as the code share its blind spots, so the checks themselves need review.

### Known limits (5 expected-fail tests)
- A coupon offered after an unrelated negation across a comma.
- "Happy to knock a bit off" (discount without a keyword).
- "We'll swing by after lunch" (a promise without a time pattern).
- "Scheduling is confirmed separately and we'll be there tomorrow at 3pm" (a disclaimer exempting a real promise in the same sentence).
- "You're not outside our service area" (misread as outside).

If a limit is later fixed, its test starts failing, which is the cue to delete the `.fails`.

## 5. Platform constraints

- **Sampling parameters are rejected.** Sending `temperature: 0` to `claude-haiku-5-5` returned HTTP 400, `temperature: Extra inputs are not permitted`. The model's migration guide says to omit `temperature`, `top_p` and `top_k`. Run-to-run variation therefore cannot be tuned down and can only be measured: repeated runs and per-case pass rates.
- **More tokens for the same text.** The same migration guide says this model's tokenizer counts roughly 30% more tokens than Haiku 4.5. A 13-case run is about 20k input and 4k output tokens, guarded by a token budget in the runner. The dollar cost has not yet been checked against the Console.

## Next

1. Runner: N repeats per case, pass rate per case, timestamped result files, and `stop_reason: "refusal"` counted as its own outcome.
2. LLM judge with a written rubric (sensible provisional prices, hazardous handling, tone).
3. CI with a baseline of known failures, then the HTML report.
