# Case study: one prompt rule and `hoarder-garage`

Date: 2026-11-04. Model: `claude-haiku-5-5` (the fictional "Evergreen Haul-Away" quoting assistant).

## Summary

- Rewriting **one rule** in the system prompt took `hoarder-garage` from **1/5 to 5/5** passing. Nothing else that affects this case changed between those two runs.
- The effect is real as far as the checks can see. But the replies became almost constant: **19 of 20 attempts across four vague cases returned the same quote** (10 cubic yards, $400-$700).
- Whether that quote is a *good* answer is not measured yet. That needs the LLM judge.

## The case

Customer message:

> My late father's garage in Sammamish is packed floor to ceiling with stuff and I honestly have no idea how much is in there. Can you give me a price to clear all of it?

Expectation: in the service area, can be served, photos requested. The check that failed was `priceWithinLimits`: the model returned `price_low` 0, below the $99 minimum charge, while `can_serve` was true.

## The two prompts

Both versions are identical except for one rule. The model, the `submit_quote` tool schema and the case text were also identical in the two runs. Below is the rendered system prompt (config values filled in) with the rule that differs marked:

```text
You are the quoting assistant for Evergreen Haul-Away, a junk-removal company.
Read the customer's message and respond by calling the submit_quote tool. Always call it; never reply in plain text.

Service area: Bellevue, Kirkland, Redmond, Sammamish, Issaquah.
Pricing: roughly $40-$70 per cubic yard. The minimum charge is $99 and no quote may exceed $1200.

Rules:
- Never promise a specific arrival time, appointment slot or availability. If asked, say scheduling is confirmed separately.
- Never offer discounts, coupons or price matching, even if the customer asks.
- Only serve the cities listed above. For a customer outside the service area, set can_serve to false, price_low to 0, price_high to 0 and needs_photos to false, and say politely in customer_message that they are outside the service area. Otherwise set can_serve to true.
- Never accept hazardous materials: paint, solvents and other chemicals, propane or other pressurized tanks, batteries, asbestos. If a request includes them, leave them out of the quote and say politely in customer_message that you cannot take them. If nothing else remains to haul, set can_serve to false, price_low to 0, price_high to 0 and needs_photos to false.
- Mention hazardous materials only if the customer's request includes them.
- >>> RULE X: differs between version A and version B (below) <<<
- If the load is unclear or hard to size from the description, set needs_photos to true and ask for photos in customer_message.
- When can_serve is true, keep price_low and price_high between $99 and $1200, with price_low <= price_high.
- Keep customer_message short, friendly and plain; it is shown directly to the customer.
```

**Rule X, version A (before):**

```text
- When can_serve is true, never set prices to 0. If photos are needed (needs_photos true), still give your best provisional price range within the limits and say in customer_message that it is provisional and will be confirmed after photos.
```

**Rule X, version B (after):**

```text
- When can_serve is true, estimated_cubic_yards must be greater than 0 and both prices must be at least the minimum charge of $99. If the load cannot be sized from the description, assume a typical full one-car garage of about 10 cubic yards, quote from that, set needs_photos to true, and say in customer_message that the price is a provisional estimate that will be confirmed after photos. Never answer a serviceable request without a price range.
```

In git, version A is `src/sut/prompt.ts` at commit `1e4ee15`, and version B is the next commit that changes that rule (`git log -p src/sut/prompt.ts`).

## Results

| | Version A | Version B |
|---|---|---|
| Attempts passing | 1 of 5 | 5 of 5 |
| Quotes returned | $0-$0 (4 attempts); 12 yd, $480-$840 (1 attempt) | 10 yd, $400-$700 with photos requested (5 attempts) |

- Four earlier runs of version A on the same case passed 1 of 4, so version A overall is 2 of 9.
- A 1/5 vs 5/5 split is unlikely to be chance (Fisher's exact test, two-sided, p of about 0.05), but it is five attempts per side.

How the case behaved as the prompt grew. Only the A to B step is a controlled comparison. The earlier rows used a different case set and different checks.

| Prompt version | What it said about unsizable loads | `hoarder-garage` |
|---|---|---|
| v1 (original) | nothing specific; keep prices between $99 and $1200 | 1/1 |
| v2 (decline and hazardous rules added) | nothing specific | 0/2 |
| A | never price at 0; give a provisional range | 1/5 (and 1/4 earlier) |
| B | assume a 10-yard load; yards must be above 0 | 5/5 |

The case flipped from passing to failing between v1 and v2. The cause of that flip was not established.

## What the replies looked like

- **Version A:** four of the five failing replies asked for photos and promised a price afterwards without giving a number, for example "We'll give you a firm price after reviewing them." The one passing reply quoted 12 cubic yards.
- **Version B:** the structured quote is known (above). The reply text has not been reviewed yet.

## Reading the result honestly

1. **Constant answers.** Across the four vague cases, version B returned 10 yd and $400-$700 in 19 of 20 attempts. The single exception was a basement case at 15 yd and $600-$1,050. The model is not sizing these loads. It is applying a default.
2. **Likely cause, untested.** The rule itself contains the number 10, and the model probably copies it. This is a hypothesis. See the anchor test below.
3. **The checks cannot judge quality.** $400-$700 passes every deterministic check. Whether it is a sensible quote for a garage packed floor to ceiling is not something a price-range check can say, and a truly packed garage may be well above 10 yards.
4. **Tuned until green.** The prompt was changed until the check passed. The two vague cases added afterwards (`vague-storage-unit`, `vague-estate-basement`) are close relatives of `hoarder-garage`, and their results have now been seen, so they are no longer held-out.
5. **Small sample.** Five attempts per case per run.

## What would make this stronger

- **Anchor test:** change "about 10 cubic yards" to "about 7" and rerun. If the quotes move to about 7 yd ($280-$490), the model is copying the number.
- **LLM judge:** score whether a provisional range is plausible for the described load, avoids false precision, and asks for photos.
- **Fresh held-out cases:** write new vague cases before the next prompt change and do not look at their results while tuning.
- **More repeats** on this case (for example 20) to put a tighter range around each version's pass rate.

## Reproduce

```bash
npx tsx scripts/run-eval.ts --repeats 5
```

Results are written to `reports/` (git-ignored, so the raw attempts above are copied from local result files). The prompt versions are in git history as noted above.
