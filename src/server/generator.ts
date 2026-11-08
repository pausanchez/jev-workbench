// Draft Jev questions for a dataset with a reasoning model (Opus 5.5).
//
// Opus sees the user's goal (or none), the column names and a small sample of rows, and returns
// questions in the editable DraftQuestion form. The page turns them into Jev questions.

import Anthropic from "@anthropic-ai/sdk";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import { z } from "zod";
import { OPUS_MAX_SAMPLE_ROWS, OPUS_MAX_VALUE_CHARS } from "../shared/types.ts";
import type { GenerateRequest, GenerateResponse, Row } from "../shared/types.ts";

export const MODEL = "claude-opus-5-5";
const EFFORT = "medium";
const PRICE_PER_MTOK = { input: 4.0, output: 20.0 }; // USD

const SYSTEM = `You design questions for Jev, TypeSafe's System One model. Jev answers typed questions
about a JSON \`state\` with calibrated probabilities. It is fast and cheap but does not reason step by
step: each question must be a snap judgment that a smart person, shown only the state and the
question, could answer at a glance.

Question types:
- noul: "Is this true?" Returns the probability (0-1) that the statement is true. Optional criteria
  describe what true and false mean; write \`false_criterion\` as a concrete situation ("the package
  arrived on time"), not as "not X".
- choice: "Which of these options?" Returns one option plus a probability per option. Options have
  no order. A choice always picks something, even when nothing fits. So for every choice, add a
  companion noul with id \`<choice id>_encaja\` that asks whether any of its options fits the row
  (e.g. "Does \`record.text\` mention any of our products?"), placed right after the choice. Code
  reads the choice only when the companion says yes. Skip the companion only when the options
  cover every possible row by construction. Never add an "other"/"none" option: it competes with
  the real options for probability.
- score: "Which level?" on an ordered scale you define (3-5 levels, lowest first). Each level is a
  situation that makes sense read on its own ("The customer mentions a minor inconvenience"), not
  relative wording ("more upset than the previous level").

Each row of the dataset becomes the state \`{"context": ..., "record": {<column>: <value>, ...}}\`.
\`context\` holds shared facts the user typed (may be absent). Refer to fields by their exact path in
backticks, e.g. \`record.message\`. Only columns the user selected are present; empty values are
dropped.

Rules that make Jev integrations work:
- Jev makes judgments; code makes decisions. Do not ask "Should we escalate this?". Ask the atomic,
  observable inputs the decision depends on ("Does the customer threaten to cancel?") and describe
  the decision logic separately, in \`decision_sketch\`, as rules or a small truth table over the
  answers (Noul thresholds: >=0.7 yes, <=0.3 no, in between unsettled - give that band an outcome).
- One judgment per question. A question with "or"/"and" joining two conditions is usually two
  questions. When several labels can be true at once, use one noul per label, not a choice.
- Ask the concrete thing a person could point to, and name the subject directly.
- Phrase so that true means yes. Avoid double negatives and presuppositions.
- Write plainly: no preambles, no "consider X, Y, Z" lists, no output-format instructions. Option
  descriptions go in the options, not in the question.
- Option names are sent to the model; question ids are not. Use descriptive snake_case option
  names (\`refund_request\`, not \`A\`). Keep options distinct and concrete; split an option that covers
  several meanings. Separate direction from magnitude.
- When two options are easy to confuse, say in their descriptions what separates them, using the
  specific case.
- Questions are answered independently and cannot see each other.
- Do not ask Jev for what code does exactly: arithmetic, dates, counts, lengths, string matching,
  lookups, thresholds on numeric columns. List those under \`code_notes\` instead.
- Recommend in \`state_columns\` only the columns the questions need; irrelevant fields reduce
  accuracy. Drop raw ids unless a question needs them.
- Mix the question types the goal actually needs; do not force all three.

Return the requested number of questions (fewer if the goal needs fewer). \`id\` is snake_case and
unique. \`tags\` are 1-3 short labels grouping the question by purpose (e.g. "routing", "risk").
Fill only the fields that apply to the type: \`options\` for choice, \`levels\` for score,
\`true_criterion\`/\`false_criterion\` for noul (both may be empty strings). \`why\` is one sentence on
what decision the question feeds. Write question text in the language of the dataset.

\`suggested_goals\`: 3-5 other concrete things an application could decide with this data (one
sentence each, in the language of the dataset), different from the goal you used, so the user can
pick one and generate again. \`goal_used\` restates in one sentence the goal the questions serve.

When \`goal\` is empty, the user has no goal yet. Read the sample and work out what the data is and
what an application handling it would most plausibly need to decide (route it, prioritise it,
filter it, flag risks, extract a category...). Pick the single most useful goal, state it in
\`goal_used\`, and write the questions for it.`;

const DraftSchema = z.object({
  questions: z.array(z.object({
    id: z.string(),
    type: z.enum(["noul", "choice", "score"]),
    instructions: z.string(),
    options: z.array(z.object({ name: z.string(), description: z.string() })),
    levels: z.array(z.string()),
    true_criterion: z.string(),
    false_criterion: z.string(),
    tags: z.array(z.string()),
    why: z.string(),
  })),
  state_columns: z.array(z.string()),
  decision_sketch: z.string(),
  code_notes: z.array(z.string()),
  goal_used: z.string(),
  suggested_goals: z.array(z.string()),
});

let client: Anthropic | undefined;

function clip(row: Row): Row {
  return Object.fromEntries(Object.entries(row).map(([k, v]) =>
    [k, typeof v === "string" && v.length > OPUS_MAX_VALUE_CHARS ? v.slice(0, OPUS_MAX_VALUE_CHARS) + "…" : v]));
}

export function buildPrompt(req: GenerateRequest): string {
  return JSON.stringify({
    goal: req.goal.trim() || null,
    shared_context: req.context || null,
    columns_available: req.columns,
    sample_rows: req.sample.slice(0, OPUS_MAX_SAMPLE_ROWS).map(clip),
    number_of_questions: req.n_questions,
  }, null, 1);
}

export async function generate(req: GenerateRequest): Promise<GenerateResponse> {
  client ??= new Anthropic();
  const start = performance.now();
  const message = await client.beta.messages.parse({
    model: MODEL,
    max_tokens: 16000,
    system: SYSTEM,
    output_config: { effort: EFFORT, format: zodOutputFormat(DraftSchema) },
    // On a safety decline, re-run on the fallback model the API picks for that category.
    betas: ["server-side-fallback-2026-07-01"],
    fallbacks: "default",
    messages: [{ role: "user", content: buildPrompt(req) }],
  });
  const seconds = (performance.now() - start) / 1000;
  const usage = { input_tokens: message.usage.input_tokens, output_tokens: message.usage.output_tokens };
  if (message.stop_reason !== "end_turn") throw new Error(`Opus stopped with stop_reason=${message.stop_reason}`);
  const out = message.parsed_output;
  if (!out) throw new Error("Opus returned output that does not match the schema");
  return {
    ...out,
    state_columns: out.state_columns.filter((c) => req.columns.includes(c)),
    usage,
    cost_usd: (usage.input_tokens * PRICE_PER_MTOK.input + usage.output_tokens * PRICE_PER_MTOK.output) / 1e6,
    seconds,
    model: message.model,
  };
}
