"""Draft Jev questions for a dataset with a reasoning model (Opus 5.5).

Opus sees the user's goal, the column names, and a small sample of rows, and returns
questions in an editable list form (see SCHEMA). The page turns that list into the
Jev `questions` dict, so what you edit is exactly what gets sent.
"""

import json

from clients import claude

MODEL = "claude-opus-5-5"
EFFORT = "medium"
PRICE_PER_MTOK = (4.00, 20.00)  # USD input, output
MAX_SAMPLE_ROWS = 25
MAX_VALUE_CHARS = 600

SYSTEM = """You design questions for Jev, TypeSafe's System One model. Jev answers typed questions
about a JSON `state` with calibrated probabilities. It is fast and cheap but does not reason step by
step: each question must be a snap judgment that a smart person, shown only the state and the
question, could answer at a glance.

Question types:
- noul: "Is this true?" Returns the probability (0-1) that the statement is true. Optional criteria
  describe what true and false mean; write `false_criterion` as a concrete situation ("the package
  arrived on time"), not as "not X".
- choice: "Which of these options?" Returns one option plus a probability per option. Options have
  no order. A choice always picks something, so when the options may not cover every row, add a
  companion noul that asks whether any option fits (e.g. "Does `record.text` mention any of our
  products?"); do not add an "other"/"none" option.
- score: "Which level?" on an ordered scale you define (3-5 levels, lowest first). Each level is a
  situation that makes sense read on its own ("The customer mentions a minor inconvenience"), not
  relative wording ("more upset than the previous level").

Each row of the dataset becomes the state `{"context": ..., "record": {<column>: <value>, ...}}`.
`context` holds shared facts the user typed (may be absent). Refer to fields by their exact path in
backticks, e.g. `record.message`. Only columns the user selected are present; empty values are
dropped.

Rules that make Jev integrations work:
- Jev makes judgments; code makes decisions. Do not ask "Should we escalate this?". Ask the atomic,
  observable inputs the decision depends on ("Does the customer threaten to cancel?") and describe
  the decision logic separately, in `decision_sketch`, as rules or a small truth table over the
  answers (Noul thresholds: >=0.7 yes, <=0.3 no, in between unsettled - give that band an outcome).
- One judgment per question. A question with "or"/"and" joining two conditions is usually two
  questions. When several labels can be true at once, use one noul per label, not a choice.
- Ask the concrete thing a person could point to, and name the subject directly.
- Phrase so that true means yes. Avoid double negatives and presuppositions.
- Write plainly: no preambles, no "consider X, Y, Z" lists, no output-format instructions. Option
  descriptions go in the options, not in the question.
- Option names are sent to the model; question ids are not. Use descriptive snake_case option
  names (`refund_request`, not `A`). Keep options distinct and concrete; split an option that covers
  several meanings. Separate direction from magnitude.
- When two options are easy to confuse, say in their descriptions what separates them, using the
  specific case.
- Questions are answered independently and cannot see each other.
- Do not ask Jev for what code does exactly: arithmetic, dates, counts, lengths, string matching,
  lookups, thresholds on numeric columns. List those under `code_notes` instead.
- Recommend in `state_columns` only the columns the questions need; irrelevant fields reduce
  accuracy. Drop raw ids unless a question needs them.
- Mix the question types the goal actually needs; do not force all three.

Return the requested number of questions (fewer if the goal needs fewer). `id` is snake_case and
unique. `tags` are 1-3 short labels grouping the question by purpose (e.g. "routing", "risk").
Fill only the fields that apply to the type: `options` for choice, `levels` for score,
`true_criterion`/`false_criterion` for noul (both may be empty strings). `why` is one sentence on
what decision the question feeds. Write question text in the language of the dataset."""

SCHEMA = {
    "type": "object",
    "properties": {
        "questions": {
            "type": "array",
            "items": {
                "type": "object",
                "properties": {
                    "id": {"type": "string"},
                    "type": {"type": "string", "enum": ["noul", "choice", "score"]},
                    "instructions": {"type": "string"},
                    "options": {
                        "type": "array",
                        "items": {
                            "type": "object",
                            "properties": {"name": {"type": "string"}, "description": {"type": "string"}},
                            "required": ["name", "description"],
                            "additionalProperties": False,
                        },
                    },
                    "levels": {"type": "array", "items": {"type": "string"}},
                    "true_criterion": {"type": "string"},
                    "false_criterion": {"type": "string"},
                    "tags": {"type": "array", "items": {"type": "string"}},
                    "why": {"type": "string"},
                },
                "required": ["id", "type", "instructions", "options", "levels",
                             "true_criterion", "false_criterion", "tags", "why"],
                "additionalProperties": False,
            },
        },
        "state_columns": {"type": "array", "items": {"type": "string"}},
        "decision_sketch": {"type": "string"},
        "code_notes": {"type": "array", "items": {"type": "string"}},
    },
    "required": ["questions", "state_columns", "decision_sketch", "code_notes"],
    "additionalProperties": False,
}


def _clip(value):
    if isinstance(value, str) and len(value) > MAX_VALUE_CHARS:
        return value[:MAX_VALUE_CHARS] + "…"
    return value


def build_prompt(goal: str, context: str, columns: list, sample: list, n_questions: int) -> str:
    rows = [{k: _clip(v) for k, v in row.items()} for row in sample[:MAX_SAMPLE_ROWS]]
    return json.dumps({
        "goal": goal,
        "shared_context": context or None,
        "columns_available": columns,
        "sample_rows": rows,
        "number_of_questions": n_questions,
    }, ensure_ascii=False, indent=1)


def generate(goal: str, context: str, columns: list, sample: list, n_questions: int) -> dict:
    message, seconds = claude(
        model=MODEL,
        max_tokens=16000,
        system=SYSTEM,
        output_config={"effort": EFFORT, "format": {"type": "json_schema", "schema": SCHEMA}},
        messages=[{"role": "user", "content": build_prompt(goal, context, columns, sample, n_questions)}],
    )
    usage = {"input_tokens": message.usage.input_tokens, "output_tokens": message.usage.output_tokens}
    cost = (usage["input_tokens"] * PRICE_PER_MTOK[0] + usage["output_tokens"] * PRICE_PER_MTOK[1]) / 1e6
    if message.stop_reason != "end_turn":
        raise RuntimeError(f"Opus stopped with stop_reason={message.stop_reason}")
    text = next(b.text for b in message.content if b.type == "text")
    out = json.loads(text)
    out["state_columns"] = [c for c in out["state_columns"] if c in columns]
    return {**out, "usage": usage, "cost_usd": cost, "seconds": seconds, "model": message.model}
