// Jev Workbench: draft Jev questions for a dataset with Opus, edit them, export them, run them.
//
//     npm start            # http://127.0.0.1:8791
//
// Keys stay on this server (.env or environment). The page sends rows to /api/run in small
// batches, so a large dataset shows progress and a failure only affects its own rows. Every Jev
// request and response is appended to runs/calls.jsonl so any result can be rerun. The server
// stops calling a model once its spend cap for the life of the process is reached.

import { existsSync } from "node:fs";
import { appendFile, mkdir, readdir, readFile } from "node:fs/promises";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { extname, join, normalize, resolve } from "node:path";
import { TypeSafeClient } from "@typesafe-ai/sdk";
import type { Answers, GenerateRequest, JevQuestions, JsonValue, RunRequest, RunResult, Spend, Status } from "../shared/types.ts";

const ROOT = resolve(import.meta.dirname, "../..");
const PUBLIC = join(ROOT, "public");
const LOG = join(ROOT, "runs", "calls.jsonl");

if (existsSync(join(ROOT, ".env"))) process.loadEnvFile(join(ROOT, ".env"));
process.env.ANTHROPIC_API_KEY ||= process.env.CLAUDE_API_KEY;

// Imported after .env is loaded so both SDKs see the keys.
const generator = await import("./generator.ts");

const PORT = Number(process.env.PORT ?? 8791);
const JEV_PRICE_PER_MTOK = 0.042; // input only; output tokens are free
const CAPS: Spend = {
  jev: Number(process.env.JEV_SPEND_CAP_USD ?? 2),
  opus: Number(process.env.OPUS_SPEND_CAP_USD ?? 2),
};
const MAX_BODY_BYTES = 30 * 1024 * 1024;
const WORKERS = 8;
const MIME: Record<string, string> = {
  ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8",
  ".map": "application/json", ".json": "application/json; charset=utf-8", ".css": "text/css; charset=utf-8", ".csv": "text/csv; charset=utf-8",
};

const spend: Spend = { jev: 0, opus: 0 };
let jevClient: TypeSafeClient | undefined;

async function log(entry: Record<string, unknown>): Promise<void> {
  await mkdir(join(ROOT, "runs"), { recursive: true });
  await appendFile(LOG, JSON.stringify({ at: new Date().toISOString(), ...entry }) + "\n");
}

async function runOne(model: string, state: JsonValue, questions: JevQuestions): Promise<RunResult> {
  if (spend.jev >= CAPS.jev) return { error: `Jev spend cap $${CAPS.jev.toFixed(2)} reached; restart with a higher JEV_SPEND_CAP_USD` };
  if (state === null || typeof state === "number" || typeof state === "boolean") return { error: "state must be an object, array or string" };
  jevClient ??= new TypeSafeClient();
  const start = performance.now();
  try {
    const r = await jevClient.systemOne({ model, state, questions });
    const tokens = r.usage.input_tokens ?? 0;
    spend.jev += (tokens * JEV_PRICE_PER_MTOK) / 1e6;
    await log({ kind: "jev", model, state, questions, response: r });
    return { answers: r.answers as Answers, model: r.model, input_tokens: tokens,
      seconds: Math.round(performance.now() - start) / 1000 };
  } catch (e) {
    // A failed call is an error, never an answer.
    const error = e instanceof Error ? `${e.name}: ${e.message}` : String(e);
    await log({ kind: "jev", model, state, questions, error });
    return { error };
  }
}

async function pool<T, R>(items: T[], size: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let next = 0;
  const worker = async () => { while (next < items.length) { const i = next++; out[i] = await fn(items[i]); } };
  await Promise.all(Array.from({ length: Math.min(size, items.length) }, worker));
  return out;
}

function sendJson(res: ServerResponse, code: number, payload: unknown): void {
  const data = Buffer.from(JSON.stringify(payload));
  res.writeHead(code, { "Content-Type": "application/json; charset=utf-8", "Content-Length": data.length });
  res.end(data);
}

async function readBody(req: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > MAX_BODY_BYTES) throw Object.assign(new Error("request too large"), { status: 413 });
    chunks.push(chunk);
  }
  try { return JSON.parse(Buffer.concat(chunks).toString("utf-8") || "{}"); }
  catch { throw Object.assign(new Error("invalid JSON"), { status: 400 }); }
}

async function serveFile(res: ServerResponse, path: string): Promise<void> {
  try {
    const data = await readFile(path);
    res.writeHead(200, { "Content-Type": MIME[extname(path)] ?? "application/octet-stream", "Content-Length": data.length });
    res.end(data);
  } catch {
    res.writeHead(404).end("not found");
  }
}

async function listExamples(): Promise<string[]> {
  return (await readdir(join(ROOT, "examples"))).filter((f) => /\.(csv|json|jsonl)$/.test(f)).sort();
}

async function handle(req: IncomingMessage, res: ServerResponse): Promise<void> {
  const path = new URL(req.url ?? "/", "http://localhost").pathname;

  if (req.method === "GET") {
    if (path === "/api/status") {
      const status: Status = {
        typesafe_key: Boolean(process.env.TYPESAFE_API_KEY), anthropic_key: Boolean(process.env.ANTHROPIC_API_KEY),
        opus_model: generator.MODEL, spend, caps: CAPS,
      };
      return sendJson(res, 200, status);
    }
    if (path === "/api/examples") return sendJson(res, 200, await listExamples());
    if (path === "/api/example") {
      const name = new URL(req.url ?? "/", "http://localhost").searchParams.get("name") ?? "";
      if (!(await listExamples()).includes(name)) return sendJson(res, 404, { error: "unknown example" });
      return serveFile(res, join(ROOT, "examples", name));
    }
    if (path === "/favicon.ico") { res.writeHead(204).end(); return; }
    const file = normalize(join(PUBLIC, path === "/" ? "index.html" : path));
    if (!file.startsWith(PUBLIC)) { res.writeHead(403).end(); return; }
    return serveFile(res, file);
  }

  if (req.method !== "POST") { res.writeHead(405).end(); return; }
  const body = await readBody(req);

  if (path === "/api/generate") {
    if (spend.opus >= CAPS.opus) return sendJson(res, 429, { error: `Opus spend cap $${CAPS.opus.toFixed(2)} reached` });
    const request = body as GenerateRequest;
    try {
      const out = await generator.generate({ ...request, n_questions: Number(request.n_questions) || 8 });
      spend.opus += out.cost_usd;
      await log({ kind: "opus", goal: request.goal, response: out });
      return sendJson(res, 200, out);
    } catch (e) {
      const error = e instanceof Error ? `${e.name}: ${e.message}` : String(e);
      await log({ kind: "opus", goal: request.goal, error });
      return sendJson(res, 502, { error });
    }
  }

  if (path === "/api/run") {
    const { states = [], questions, model = "jev-latest" } = body as Partial<RunRequest>;
    if (!questions || !Object.keys(questions).length) return sendJson(res, 400, { error: "no questions" });
    const results = await pool(states, WORKERS, (s) => runOne(model, s, questions));
    return sendJson(res, 200, { results, spend });
  }

  sendJson(res, 404, { error: "unknown endpoint" });
}

createServer((req, res) => {
  handle(req, res).catch((e: Error & { status?: number }) => sendJson(res, e.status ?? 500, { error: e.message }));
}).on("error", (e: NodeJS.ErrnoException) => {
  if (e.code !== "EADDRINUSE") throw e;
  console.error(`Port ${PORT} is already in use. Stop the other server or pick another port: PORT=${PORT + 1} npm start`);
  process.exit(1);
}).listen(PORT, "127.0.0.1", () => {
  console.log(`Jev Workbench on http://127.0.0.1:${PORT}  (caps: Jev $${CAPS.jev}, Opus $${CAPS.opus})`);
  if (!existsSync(join(PUBLIC, "app.js"))) console.warn("public/app.js is missing: run `npm run build` first");
});
