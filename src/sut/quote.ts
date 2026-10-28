import Anthropic from "@anthropic-ai/sdk";
import { z } from "zod";
import { MODELS } from "../config.js";
import { buildSystemPrompt } from "./prompt.js";
import { QuoteSchema, type Quote } from "./schema.js";

const TOOL_NAME = "submit_quote";
const MAX_TOKENS = 1024;

export class NoToolUseError extends Error {
  constructor(readonly stopReason: string | null) {
    super(`Model response had no ${TOOL_NAME} tool_use block (stop_reason: ${stopReason ?? "null"})`);
    this.name = "NoToolUseError";
  }
}

export class QuoteValidationError extends Error {
  constructor(
    readonly issues: z.core.$ZodIssue[],
    readonly rawInput: unknown,
  ) {
    super(`Tool input failed QuoteSchema validation: ${z.prettifyError(new z.ZodError(issues))}`);
    this.name = "QuoteValidationError";
  }
}

export type QuoteUsage = { inputTokens: number; outputTokens: number };

const { $schema: _dropped, ...quoteJsonSchema } = z.toJSONSchema(QuoteSchema);

const submitQuoteTool: Anthropic.Tool = {
  name: TOOL_NAME,
  description:
    "Submit the final quote for the customer's junk-removal request. Use it for every request: " +
    "list the items, estimate the volume, give a price range within the allowed limits, " +
    "say whether photos are needed, and write the short reply the customer will see.",
  input_schema: { ...quoteJsonSchema, type: "object" },
};

export async function runQuote(customerMessage: string): Promise<{ quote: Quote; usage: QuoteUsage }> {
  const client = new Anthropic();

  const response = await client.messages.create({
    model: MODELS.sut,
    max_tokens: MAX_TOKENS,
    system: buildSystemPrompt(),
    tools: [submitQuoteTool],
    tool_choice: { type: "tool", name: TOOL_NAME },
    messages: [{ role: "user", content: customerMessage }],
  });

  const usage: QuoteUsage = {
    inputTokens: response.usage.input_tokens,
    outputTokens: response.usage.output_tokens,
  };
  console.log(`[usage] model=${MODELS.sut} input=${usage.inputTokens} output=${usage.outputTokens}`);

  const toolUse = response.content.find(
    (block): block is Anthropic.ToolUseBlock => block.type === "tool_use" && block.name === TOOL_NAME,
  );
  if (!toolUse) throw new NoToolUseError(response.stop_reason);

  const parsed = QuoteSchema.safeParse(toolUse.input);
  if (!parsed.success) throw new QuoteValidationError(parsed.error.issues, toolUse.input);

  return { quote: parsed.data, usage };
}
