# Findings

Preliminary results from running this harness against its system under test (SUT), a fictional junk-removal quoting assistant. Date: 2026-11-04.

**Read these with care.** The samples are small (a handful of runs, one reply per case per run), and the prompt changed between some of the runs. They show what the harness can surface. They are not statistics.

## Setup

- **SUT:** "Evergreen Haul-Away" (fictional), `claude-haiku-5-5`, forced `submit_quote` tool call, output validated with zod.
- **Cases:** 15 hand-written customer messages: clear and vague loads, discount and price-match requests, same-day and guaranteed-window demands, two out-of-area cities, hazardous items, hazardous items mixed with furniture, and a hoarder garage.
- **Checks:** 10 deterministic checks (price order, price limits, discount language, availability promises, service-area handling, photos requested, `can_serve` matches expectation, items present when serving, priceable matches expectation, no price in an unpriced message). For the unit test count, see `npm test`; 5 tests are marked expected-fail to document known limits.
- **Built:** LLM judge (see Update 2026-11-05). **Not built yet:** CI baseline and HTML report. Repeated runs with per-case pass rates exist (`--repeats N`).

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

### A rule the model kept breaking, and what fixed it (model failure)
`hoarder-garage` returned $0-$0 with `can_serve: true` in 3 of 4 runs, despite an explicit rule against zero prices (and 4 of 5 in a later 5-repeat run). Rewriting one prompt rule took it to 5 of 5. But the replies collapsed to one constant quote, so the improvement is real only as far as the checks can see. Both prompts, the data and the caveats are in [docs/hoarder-garage-prompt-change.md](docs/hoarder-garage-prompt-change.md).

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
- `price-match-ask` was flagged for "discounts" inside a correct refusal ("not able to match other companies' prices or offer discounts"). A fixed 40-character refusal window was too short for the list. Scoping the negation to the clause fixed it (4/5 to 5/5).

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

## Latest results (15 cases x 5 repeats)

74 of 75 attempts passed, with no format errors, refusals or API errors. The earlier 13-case run with the same runner passed 58 of 65.

| Case | 13-case run | 15-case run |
|---|---|---|
| `hoarder-garage` | 1/5 | 5/5 (see the case study: the replies are nearly constant) |
| `price-match-ask` | 4/5 | 5/5 (check fix, not a model change) |
| `vague-load` | 4/5 | 5/5 |
| `guaranteed-window-ask` | 4/5 | 5/5 (borderline reply: "reach out to confirm your Saturday timing") |
| `same-day-demand` | 5/5 | 4/5 (real slip: "lock in a time for today") |

With 5 repeats, 4/5 and 5/5 are not meaningfully different. Only big gaps, such as 1/5 against 5/5, are signals. The one failing attempt this time is a true positive, with the same phrasing as in the very first run. The Console showed $0.03 spent after the first 65-attempt run; the dashboard lags, so treat that as approximate.

## Next

1. CI with a known-failures baseline.
2. HTML report.
3. README with architecture diagram and results.
4. Calibrate the judge against ~10 hand-labelled real replies.
5. Polish list: next-step rule in the SUT prompt, strict SUT tool, same-day wording fix.

## Update 2026-11-05: spec change, LLM judge, first judged run

- **Spec change:** an unsizable load (e.g. a garage "packed floor to ceiling") now gets no price: `can_serve` true, `needs_photos` true, prices 0, photos requested. Reason: the owner's domain knowledge says such a garage is at least 20 cubic yards and up to 40, i.e. roughly $800-$2,800 at $40-$70 per yard, above the $1,200 cap. Version B's "assume 10 yards, $400-$700" passed every check but was the wrong answer, so the earlier `hoarder-garage` 1/5 to 5/5 gain was real but the check was rewarding the wrong behavior (a spec gap). Added the `priceable` case expectation and the `noPriceInUnpricedMessage` check.
- **Hazard reminder decision:** one short sentence asking the customer to leave out paint, chemicals, propane tanks, batteries and asbestos is allowed only when photos are requested because the load cannot be sized, and is a failure otherwise. Reason: an unseen garage or storage unit is where hidden hazardous items are most likely. Before this decision the judge flagged the unprompted reminder on 5 of 75 attempts, which no deterministic check could see.
- **LLM judge:** Claude Sonnet 5.5 with a written rubric (`rubric/quote-rubric.md`): three critical gates (`load_size`, `commitments`, `hazardous`; pass/fail) and three quality criteria (scored 1-3). The overall verdict is computed in code. The judge uses `tool_choice` auto with a strict tool because Sonnet 5.5 rejects a forced `tool_choice`. It sees only the customer message and the reply, never the check results.
- **Judge validation:** 14 hand-labelled fixtures x 3 runs, 126/126 gate verdicts match. Caveats: the labels were written by us, and the rubric was adjusted after earlier mismatches, so this shows the rubric is consistent, not that the judge is accurate on unseen replies. Calibration against hand-labelled real replies is still to do.
- **What the validation found:** the first run was 103/108. The judge read "we'll give you a firm price" as a guarantee (rubric ambiguity, now clarified); the same fixture flipped between runs (unstable); and one verdict contradicted its own reasoning because the schema put the verdict before the reason (reason now comes first).
- **First judged run** (15 cases x 5, Haiku 5.5 SUT, Sonnet 5.5 judge): checks 71/75 (3 failed checks, 1 format error); the judge judged 74 attempts, all gates passed on 72; hazardous 74/74. `same-day-demand` is 3/5 and checks and judge agree on both failures ("lock in today's pickup" style wording after a no-promise sentence), so it is a stable real model weakness (5/5, 4/5, 3/5, 4/5, 3/5 across runs).
- **Check vs judge disagreement:** `price-match-ask` #4 was a check bug ("aren't able to ... offer discounts" was not read as a refusal); the judge was right. Fixed with regression tests.
- **Format error 1 of 75:** Haiku returned `price_low` as a string. The SUT tool is not strict. Parked for the polish week.
- **Quality (mean 1-3):** `uncertainty_handling` 2.97, `answers_and_next_step` 2.49, `tone_brevity` 2.59. The most common low score is a price with no next step (all 5 `clear-small-load` replies). Not tuned yet. The judge's quality taste is not calibrated against human labels.
- **Cost:** a judged run is about 180k input and 32k output Sonnet tokens plus about 130k input and 22k output Haiku tokens, roughly $1 by estimate; check the Console for the real figure.
