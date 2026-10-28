import "dotenv/config";
import { NoToolUseError, QuoteValidationError, runQuote } from "../src/sut/quote.js";

const message = "Hi, I have an old couch and a queen mattress in my garage in Kirkland. How much to haul them away?";

try {
  const { quote, usage } = await runQuote(message);
  console.log(JSON.stringify(quote, null, 2));
  console.log(`Tokens: input=${usage.inputTokens} output=${usage.outputTokens}`);
} catch (err) {
  if (err instanceof NoToolUseError || err instanceof QuoteValidationError) {
    console.error(err.message);
  } else if (err instanceof Error) {
    console.error(`Request failed: ${err.message}`);
  } else {
    console.error("Request failed with a non-Error value");
  }
  process.exitCode = 1;
}
