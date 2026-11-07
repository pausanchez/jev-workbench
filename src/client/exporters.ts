// Code snippets for the Export step: the active questions as JSON, a full request, and
// ready-to-paste callers in Python, TypeScript and curl.

import type { DraftQuestion, JevQuestions, JsonValue } from "../shared/types.ts";

export const EXPORT_TABS = {
  json: { label: "Preguntas (JSON)", file: "jev-questions.json" },
  request: { label: "Petición completa", file: "jev-request.json" },
  typescript: { label: "TypeScript", file: "jevQuestions.ts" },
  python: { label: "Python", file: "jev_questions.py" },
  curl: { label: "curl", file: "jev-request.sh" },
} as const;
export type ExportTab = keyof typeof EXPORT_TABS;

export interface ExportInput {
  model: string;
  columns: string[];
  context: string;
  questions: DraftQuestion[];
  jevQuestions: JevQuestions;
  exampleState: JsonValue;
  exampleRow: Record<string, JsonValue>;
}

function pyLiteral(value: unknown): string {
  return JSON.stringify(value).replace(/\bnull\b/g, "None").replace(/\btrue\b/g, "True").replace(/\bfalse\b/g, "False");
}

function readAnswer(q: DraftQuestion, lang: "ts" | "py"): string {
  const a = `answers["${q.id}"]`;
  const field = (f: string) => (lang === "ts" ? `${a}.${f}` : `${a}["${f}"]`);
  if (q.type === "choice") return `${field("choice")}, ${field("probabilities")}`;
  return field(q.type === "score" ? "score" : "noul");
}

export function exportText(tab: ExportTab, x: ExportInput): string {
  const qJson = JSON.stringify(x.jevQuestions, null, 2);
  const ctx = x.context.trim() || null;
  const request = JSON.stringify({ model: x.model, state: x.exampleState, questions: x.jevQuestions }, null, 2);

  if (tab === "json") return qJson;
  if (tab === "request") return request;

  if (tab === "typescript") return `// npm install @typesafe-ai/sdk   (reads TYPESAFE_API_KEY; server-side only)
import { TypeSafeClient, type JsonValue, type Questions } from "@typesafe-ai/sdk";

const COLUMNS = ${JSON.stringify(x.columns)};
const CONTEXT: string | null = ${JSON.stringify(ctx)};
const QUESTIONS = ${qJson} satisfies Questions;

type Row = Record<string, JsonValue>;

function stateFor(row: Row): Record<string, JsonValue> {
  const record = Object.fromEntries(COLUMNS.filter((c) => row[c] != null && row[c] !== "").map((c) => [c, row[c]]));
  return CONTEXT ? { context: CONTEXT, record } : { record };
}

const client = new TypeSafeClient();

/** One Jev request for one row. Throws on failure: an error is never an answer. */
export async function ask(row: Row, model = "${x.model}") {
  const { answers } = await client.systemOne({ model, state: stateFor(row), questions: QUESTIONS });
  return answers;
}

const answers = await ask(${JSON.stringify(x.exampleRow)});
${x.questions.map((q) => `console.log("${q.id}", ${readAnswer(q, "ts")});`).join("\n")}
`;

  if (tab === "python") return `import json
import os
import urllib.request

COLUMNS = ${JSON.stringify(x.columns)}
CONTEXT = ${ctx === null ? "None" : JSON.stringify(ctx)}
QUESTIONS = json.loads(r"""
${qJson}
""")


def state_for(row: dict) -> dict:
    record = {c: row[c] for c in COLUMNS if row.get(c) not in (None, "")}
    return {"context": CONTEXT, "record": record} if CONTEXT else {"record": record}


def ask(row: dict, model: str = "${x.model}") -> dict:
    """One Jev request for one row. Raises on failure: an error is never an answer."""
    body = json.dumps({"model": model, "state": state_for(row), "questions": QUESTIONS}).encode()
    req = urllib.request.Request(
        "https://api.typesafe.ai/v1/systemone", data=body, method="POST",
        headers={"Content-Type": "application/json",
                 "Authorization": f"Bearer {os.environ['TYPESAFE_API_KEY']}"},
    )
    with urllib.request.urlopen(req, timeout=60) as resp:
        return json.load(resp)["answers"]


if __name__ == "__main__":
    answers = ask(${pyLiteral(x.exampleRow)})
${x.questions.map((q) => `    print("${q.id}", ${readAnswer(q, "py")})`).join("\n")}
`;

  return `curl https://api.typesafe.ai/v1/systemone \\
  -H "Authorization: Bearer $TYPESAFE_API_KEY" \\
  -H "Content-Type: application/json" \\
  -d @- <<'JSON'
${request}
JSON`;
}
