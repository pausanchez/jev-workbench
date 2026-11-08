// Types shared by the server and the page, plus the one place a draft question becomes the
// question Jev receives. What you edit in the page is exactly what gets sent.

import type { JsonValue, Question as JevQuestion, Questions as JevQuestions, ScoreCriteria } from "@typesafe-ai/sdk";

export type { JevQuestions, JsonValue };

/** What Opus sees when drafting questions: at most this many sample rows, each value cut to this
 * many characters. Long enough for a sales-call transcript; Jev always gets the full row. */
export const OPUS_MAX_SAMPLE_ROWS = 25;
export const OPUS_MAX_VALUE_CHARS = 4000;

export type QuestionType = "noul" | "choice" | "score";

export interface ChoiceOption {
  name: string;
  description: string;
}

/** A question in the editable form Opus drafts and the page edits. */
export interface DraftQuestion {
  id: string;
  type: QuestionType;
  instructions: string;
  options: ChoiceOption[];
  levels: string[];
  true_criterion: string;
  false_criterion: string;
  tags: string[];
  why: string;
  active?: boolean;
}

export function toJev(q: DraftQuestion): JevQuestion {
  if (q.type === "choice") {
    return { type: "choice", instructions: q.instructions, criteria: Object.fromEntries(q.options.map((o) => [o.name, o.description])) };
  }
  if (q.type === "score") {
    return { type: "score", instructions: q.instructions, criteria: q.levels.slice() as unknown as ScoreCriteria };
  }
  const criteria: { true?: string; false?: string } = {};
  if (q.true_criterion.trim()) criteria.true = q.true_criterion;
  if (q.false_criterion.trim()) criteria.false = q.false_criterion;
  return Object.keys(criteria).length ? { type: "noul", instructions: q.instructions, criteria } : { type: "noul", instructions: q.instructions };
}

export function toJevQuestions(questions: DraftQuestion[]): JevQuestions {
  return Object.fromEntries(questions.map((q) => [q.id, toJev(q)]));
}

export type Row = Record<string, JsonValue>;

export interface GenerateRequest {
  goal: string;
  context: string;
  columns: string[];
  sample: Row[];
  n_questions: number;
}

export interface GenerateResponse {
  questions: DraftQuestion[];
  state_columns: string[];
  decision_sketch: string;
  code_notes: string[];
  goal_used: string;
  suggested_goals: string[];
  usage: { input_tokens: number; output_tokens: number };
  cost_usd: number;
  seconds: number;
  model: string;
}

export interface RunRequest {
  model: string;
  states: JsonValue[];
  questions: JevQuestions;
}

/** Jev answers as the API returns them, keyed by question id. */
export type Answers = Record<string, {
  type: string;
  noul?: number;
  choice?: string;
  score?: number;
  probabilities?: Record<string, number>;
  confidence?: number | null;
}>;

export type RunResult =
  | { answers: Answers; model: string; input_tokens: number; seconds: number; error?: undefined }
  | { error: string; answers?: undefined; model?: undefined; input_tokens?: undefined; seconds?: undefined };

export interface RunResponse {
  results: RunResult[];
  spend: Spend;
}

export interface Spend {
  jev: number;
  opus: number;
}

export interface Status {
  typesafe_key: boolean;
  anthropic_key: boolean;
  opus_model: string;
  spend: Spend;
  caps: Spend;
}
