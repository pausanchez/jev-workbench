// The Workbench page: dataset → generate with Opus → edit → export → run with Jev.

import {
  toJev, toJevQuestions,
  type Answers, type DraftQuestion, type GenerateResponse, type JsonValue, type QuestionType, type Row,
  type RunResponse, type RunResult, type Status,
} from "../shared/types.ts";
import { EXPORT_TABS, exportText, type ExportTab } from "./exporters.ts";
import { FORMAT_HELP, FormatError, isRow, parseData } from "./parse.ts";

const BATCH = 16;
const YES_AT = 0.7;
const NO_AT = 0.3;

// ---------- DOM helpers ----------
const $ = <T extends HTMLElement = HTMLInputElement>(id: string): T => document.getElementById(id) as T;
const esc = (s: unknown): string =>
  String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c] as string);
const errorText = (e: unknown): string => (e instanceof Error ? e.message : String(e));

// ---------- state ----------
interface Notes {
  decision_sketch: string;
  code_notes: string[];
  state_columns: string[];
  goal_used?: string;
  suggested_goals?: string[];
  inferred?: boolean;
}

interface QuestionMeta {
  id: string;
  type: QuestionType;
  options: string[];
  levels: string[];
}

type RunItem = RunResult & { state: JsonValue };

interface Results {
  model: string;
  qMeta: QuestionMeta[];
  items: (RunItem | null)[];
}

const app = {
  rows: [] as Row[],
  columns: [] as string[],
  selected: [] as string[],
  dropEmpty: true,
  context: "",
  sampleIdx: [] as number[],
  sampleSize: 15,
  goal: "",
  nq: 8,
  questions: [] as DraftQuestion[],
  notes: null as Notes | null,
  results: null as Results | null,
  runRows: [] as number[],
  exTab: "json" as ExportTab,
};

let toastTimer: ReturnType<typeof setTimeout> | undefined;
function toast(msg: string, ms = 1800): void {
  const t = $("toast");
  t.textContent = msg; t.classList.add("show");
  clearTimeout(toastTimer); toastTimer = setTimeout(() => t.classList.remove("show"), ms);
}

// ---------- persistence (per-viewer convenience only) ----------
const KEY = "jev-workbench-v1";
let rowsSaved = true;
function save(): void {
  const { rows, results, runRows, ...rest } = app;
  try { localStorage.setItem(KEY, JSON.stringify(rest)); } catch { /* storage unavailable */ }
  try { localStorage.setItem(KEY + "-rows", JSON.stringify(rows)); rowsSaved = true; }
  catch { rowsSaved = false; try { localStorage.removeItem(KEY + "-rows"); } catch { /* ignore */ } }
}
function load(): void {
  try { Object.assign(app, JSON.parse(localStorage.getItem(KEY) || "{}")); } catch { /* ignore */ }
  try { app.rows = JSON.parse(localStorage.getItem(KEY + "-rows") || "[]"); } catch { app.rows = []; }
  if (!(app.exTab in EXPORT_TABS)) app.exTab = "json";
  app.results = null; app.runRows = [];
}

// ---------- dataset ----------
function setRows(values: unknown[]): void {
  const rows = values.filter(isRow);
  if (!rows.length) { toast("No se encontraron filas. " + FORMAT_HELP, 5000); return; }
  const cols: string[] = [];
  for (const r of rows.slice(0, 500)) for (const k of Object.keys(r)) if (!cols.includes(k)) cols.push(k);
  // Ground-truth columns stay out of the state by default, so Jev never sees the answer.
  app.rows = rows; app.columns = cols; app.selected = cols.filter((c) => !/^label(_|$)/i.test(c)); app.results = null;
  resample(); save(); renderAll();
}
function readError(err: unknown): void {
  toast(err instanceof FormatError ? err.message : `No se pudo leer el fichero (${errorText(err)}). ${FORMAT_HELP}`, 7000);
}
function resample(): void {
  const n = Math.min(app.sampleSize, app.rows.length);
  const idx = [...app.rows.keys()];
  for (let i = idx.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [idx[i], idx[j]] = [idx[j], idx[i]]; }
  app.sampleIdx = idx.slice(0, n).sort((a, b) => a - b);
}

// ---------- state + questions in Jev format ----------
const isEmpty = (v: JsonValue | undefined): boolean => v === null || v === undefined || (typeof v === "string" && v.trim() === "");
function stateFor(row: Row): JsonValue {
  const record: Row = {};
  for (const c of app.selected) if (!(app.dropEmpty && isEmpty(row[c]))) record[c] = row[c] ?? null;
  return app.context.trim() ? { context: app.context.trim(), record } : { record };
}
// A Choice always picks an option, even when none fits. Its companion Noul says whether any does.
const companionId = (choiceId: string): string => `${choiceId}_encaja`;
function companionFor(q: DraftQuestion): DraftQuestion {
  const names = q.options.map((o) => o.name).filter(Boolean);
  return {
    id: companionId(q.id), type: "noul",
    instructions: `Para la pregunta "${q.instructions.trim()}", ¿alguna de estas opciones describe bien el caso: ${names.join(", ")}?`,
    options: [], levels: [],
    true_criterion: "Al menos una de las opciones describe bien el caso.",
    false_criterion: "Ninguna de las opciones describe el caso; haría falta otra distinta.",
    tags: q.tags.slice(), why: `Compañera de ${q.id}: lee ${q.id} solo cuando esta dice que sí.`, active: true,
  };
}
const activeQs = (): DraftQuestion[] => app.questions.filter((q) => q.active !== false);

function problems(q: DraftQuestion): string[] {
  const p: string[] = [];
  if (!/^[A-Za-z_][A-Za-z0-9_\-]*$/.test(q.id)) p.push("ID vacío o con caracteres raros");
  if (app.questions.filter((o) => o.id === q.id).length > 1) p.push("ID repetido");
  if (!q.instructions.trim()) p.push("faltan las instrucciones");
  if (q.type === "choice") {
    if (q.options.length < 2) p.push("una Choice necesita al menos 2 opciones");
    const names = q.options.map((o) => o.name.trim());
    if (names.some((n) => !n)) p.push("opción sin nombre");
    if (new Set(names).size !== names.length) p.push("nombres de opción repetidos");
  }
  if (q.type === "score" && q.levels.filter((l) => l.trim()).length < 2) p.push("un Score necesita al menos 2 niveles");
  return p;
}
function blankQ(type: QuestionType): DraftQuestion {
  let n = 1; while (app.questions.some((q) => q.id === `${type}_${n}`)) n++;
  return {
    id: `${type}_${n}`, type, instructions: "",
    options: type === "choice" ? [{ name: "", description: "" }, { name: "", description: "" }] : [],
    levels: type === "score" ? ["", "", ""] : [], true_criterion: "", false_criterion: "", tags: [], why: "", active: true,
  };
}
function normalizeQ(q: Partial<DraftQuestion>): DraftQuestion {
  return {
    id: q.id ?? "", type: q.type ?? "noul",
    instructions: typeof q.instructions === "string" ? q.instructions : JSON.stringify(q.instructions ?? ""),
    options: q.options ?? [], levels: q.levels ?? [], true_criterion: q.true_criterion ?? "", false_criterion: q.false_criterion ?? "",
    tags: q.tags ?? [], why: q.why ?? "", active: q.active !== false,
  };
}

// ---------- render: dataset ----------
const fmtCell = (v: JsonValue | undefined): string => (typeof v === "object" && v !== null ? JSON.stringify(v) : String(v ?? ""));
function renderData(): void {
  $("dataInfo").textContent = app.rows.length
    ? `${app.rows.length} filas · ${app.columns.length} columnas${rowsSaved ? "" : " · demasiado grande para recordarlo al recargar la página"}`
    : "sin datos";
  $("cols").innerHTML = app.columns.map((c) => `<span class="chip ${app.selected.includes(c) ? "on" : ""}" data-col="${esc(c)}">${esc(c)}</span>`).join("")
    || '<span class="muted">Carga un fichero para ver sus columnas.</span>';
  $("dropEmpty").checked = app.dropEmpty;
  $("context").value = app.context;
  $("sampleSize").value = String(app.sampleSize);
  $("sampleInfo").textContent = app.rows.length ? `${app.sampleIdx.length} filas en la muestra` : "";
  if (!app.rows.length) { $("preview").innerHTML = ""; return; }
  const cols = app.columns;
  $("preview").innerHTML = `<table><tr><th>#</th>${cols.map((c) => `<th>${esc(c)}</th>`).join("")}</tr>` +
    app.sampleIdx.map((i) => `<tr><td class="muted">${i}</td>${cols.map((c) =>
      `<td class="clip" title="${esc(fmtCell(app.rows[i][c]))}">${esc(fmtCell(app.rows[i][c]))}</td>`).join("")}</tr>`).join("") + "</table>";
}

// ---------- render: generator notes ----------
function updateGenBtn(): void { $("genBtn").textContent = app.goal.trim() ? "Generar" : "Sugerir a partir de la muestra"; }
function setGoal(g: string): void { app.goal = g; $("goal").value = g; updateGenBtn(); save(); $("goal").focus(); }
function renderNotes(): void {
  const n = app.notes;
  if (!n) { $("genNotes").innerHTML = ""; return; }
  $("genNotes").innerHTML =
    (n.goal_used ? `<div class="note"><h3>${n.inferred ? "Objetivo que propone Opus" : "Objetivo usado"}</h3>${esc(n.goal_used)}${n.inferred ? ' <button id="useGoal" style="margin-left:8px">Usar como objetivo</button>' : ""}</div>` : "") +
    (n.suggested_goals?.length ? `<div class="note"><h3>Otros objetivos posibles con estos datos (clic para usarlo y vuelve a generar)</h3><div class="cols">${n.suggested_goals.map((g, j) => `<span class="chip" data-goal="${j}">${esc(g)}</span>`).join("")}</div></div>` : "") +
    `<div class="note"><h3>Boceto de la lógica de decisión (va en tu código)</h3>${esc(n.decision_sketch)}</div>` +
    (n.code_notes?.length ? `<div class="note"><h3>Mejor en código que en Jev</h3>${n.code_notes.map((x) => "• " + esc(x)).join("\n")}</div>` : "") +
    (n.state_columns?.length ? `<div class="note"><h3>Columnas recomendadas para el state</h3>${n.state_columns.map(esc).join(", ")} <button id="applyCols" style="margin-left:8px">Usar estas</button></div>` : "");
  document.getElementById("useGoal")?.addEventListener("click", () => setGoal(n.goal_used ?? ""));
  $("genNotes").querySelectorAll<HTMLElement>("[data-goal]").forEach((el) =>
    el.addEventListener("click", () => setGoal(n.suggested_goals?.[Number(el.dataset.goal)] ?? "")));
  document.getElementById("applyCols")?.addEventListener("click", () => {
    app.selected = app.columns.filter((c) => n.state_columns.includes(c)); renderAll(); save(); toast("Columnas actualizadas");
  });
}

// ---------- render: questions ----------
function renderQuestions(): void {
  const tags = [...new Set(app.questions.flatMap((q) => q.tags))].sort();
  $("tagbar").innerHTML = tags.map((t) => {
    const qs = app.questions.filter((q) => q.tags.includes(t)); const on = qs.every((q) => q.active !== false);
    return `<span class="chip ${on ? "on" : ""}" data-tag="${esc(t)}">#${esc(t)} <span class="muted">${qs.length}</span></span>`;
  }).join("");
  $("qlist").innerHTML = app.questions.length ? app.questions.map(qCard).join("")
    : '<p class="muted">Aún no hay preguntas. Genéralas con Opus o añádelas a mano.</p>';
}
function qCard(q: DraftQuestion, i: number): string {
  const p = problems(q);
  let crit = "";
  if (q.type === "choice") {
    crit = `<label>Opciones (nombre que ve el modelo · descripción)</label>` +
      q.options.map((o, j) => `<div class="opt"><input type="text" class="name" data-q="${i}" data-opt="${j}" data-k="name" value="${esc(o.name)}" placeholder="nombre_opcion">
        <textarea data-q="${i}" data-opt="${j}" data-k="description" rows="1" placeholder="qué cubre esta opción">${esc(o.description)}</textarea>
        <button class="ghost" data-act="delopt" data-q="${i}" data-opt="${j}" title="Quitar opción">✕</button></div>`).join("") +
      `<button data-act="addopt" data-q="${i}">+ opción</button> ` +
      (app.questions.some((o) => o.id === companionId(q.id))
        ? `<span class="muted">Con Noul compañera <code>${esc(companionId(q.id))}</code>: si dice que no, ninguna opción encaja.</span>`
        : `<button data-act="companion" data-q="${i}" title="Una Choice siempre elige una opción, aunque no encaje ninguna">+ Noul «¿encaja alguna opción?»</button>
           <span class="muted">Mejor que una opción "otro": no le quita probabilidad a las opciones reales.</span>`);
  } else if (q.type === "score") {
    crit = `<label>Niveles, de menor a mayor (cada uno una situación que se entienda sola)</label>` +
      q.levels.map((l, j) => `<div class="lvl"><span class="n">${j}</span><textarea data-q="${i}" data-lvl="${j}" rows="1">${esc(l)}</textarea>
        <button class="ghost" data-act="up" data-q="${i}" data-lvl="${j}" title="Subir">↑</button>
        <button class="ghost" data-act="down" data-q="${i}" data-lvl="${j}" title="Bajar">↓</button>
        <button class="ghost" data-act="dellvl" data-q="${i}" data-lvl="${j}" title="Quitar nivel">✕</button></div>`).join("") +
      `<button data-act="addlvl" data-q="${i}">+ nivel</button>`;
  } else {
    crit = `<div class="grid2"><div><label>Qué significa sí (opcional)</label><textarea data-q="${i}" data-k="true_criterion">${esc(q.true_criterion)}</textarea></div>
      <div><label>Qué significa no (opcional; una situación concreta, no "no X")</label><textarea data-q="${i}" data-k="false_criterion">${esc(q.false_criterion)}</textarea></div></div>`;
  }
  return `<div class="qcard ${q.active === false ? "off" : ""} ${p.length ? "bad" : ""}">
    <div class="qhead">
      <input type="checkbox" data-act="toggle" data-q="${i}" ${q.active !== false ? "checked" : ""} title="Incluir en exportación y ejecución">
      <input type="text" class="qid" data-q="${i}" data-k="id" value="${esc(q.id)}">
      <select data-q="${i}" data-k="type">${(["noul", "choice", "score"] as const).map((t) => `<option ${t === q.type ? "selected" : ""}>${t}</option>`).join("")}</select>
      <span class="cols" style="margin:0">${q.tags.map((t, j) => `<span class="chip">#${esc(t)}<span class="x" data-act="deltag" data-q="${i}" data-tag="${j}">✕</span></span>`).join("")}
        <span class="chip"><input type="text" data-act="newtag" data-q="${i}" placeholder="+ tag"></span></span>
      <span class="spacer"></span>
      <button class="ghost" data-act="mvup" data-q="${i}" title="Subir">↑</button><button class="ghost" data-act="mvdown" data-q="${i}" title="Bajar">↓</button>
      <button class="ghost" data-act="dup" data-q="${i}" title="Duplicar">⧉</button>
      <button class="ghost" data-act="del" data-q="${i}" title="Borrar pregunta">✕</button>
    </div>
    <label>Pregunta (instructions) — referencia campos así: <code>\`record.columna\`</code></label>
    <textarea data-q="${i}" data-k="instructions">${esc(q.instructions)}</textarea>
    ${crit}
    ${q.why ? `<div class="why">${esc(q.why)}</div>` : ""}
    ${p.length ? `<div class="err">${p.map(esc).join(" · ")}</div>` : ""}
  </div>`;
}

// ---------- render: export ----------
function currentExport(tab: ExportTab): string {
  const sampleRow = app.rows[app.sampleIdx[0] ?? 0];
  return exportText(tab, {
    model: $<HTMLSelectElement>("model").value,
    columns: app.selected,
    context: app.context,
    questions: activeQs(),
    jevQuestions: toJevQuestions(activeQs()),
    exampleState: sampleRow ? stateFor(sampleRow) : { record: {} },
    exampleRow: sampleRow ? Object.fromEntries(app.selected.map((c) => [c, sampleRow[c] ?? null])) : {},
  });
}
function renderExport(): void {
  $("exTabs").innerHTML = (Object.keys(EXPORT_TABS) as ExportTab[])
    .map((k) => `<button data-tab="${k}" class="${k === app.exTab ? "on" : ""}">${EXPORT_TABS[k].label}</button>`).join("");
  $("exOut").textContent = currentExport(app.exTab);
}

// ---------- run ----------
let stopFlag = false;
function rowsForRun(): number[] {
  const scope = $<HTMLSelectElement>("scope").value;
  if (scope === "sample") return app.sampleIdx.slice();
  if (scope === "first") return [...app.rows.keys()].slice(0, Math.max(1, Number($("firstN").value) || 1));
  return [...app.rows.keys()];
}
async function run(): Promise<void> {
  const qs = activeQs();
  if (!qs.length) return toast("No hay preguntas activas");
  const bad = qs.filter((q) => problems(q).length);
  if (bad.length) return toast(`Corrige antes: ${bad.map((q) => q.id).join(", ")}`);
  if (!app.rows.length) return toast("Carga un dataset primero");
  const idx = rowsForRun();
  const questions = toJevQuestions(qs);
  const model = $<HTMLSelectElement>("model").value;
  const results: Results = {
    model, items: idx.map(() => null),
    qMeta: qs.map((q) => ({ id: q.id, type: q.type, options: q.options.map((o) => o.name), levels: q.levels.slice() })),
  };
  app.runRows = idx; app.results = results;
  stopFlag = false; $<HTMLButtonElement>("runBtn").disabled = true; $<HTMLButtonElement>("stopBtn").disabled = false;
  const t0 = performance.now(); let tokens = 0;
  for (let b = 0; b < idx.length && !stopFlag; b += BATCH) {
    const chunk = idx.slice(b, b + BATCH);
    const states = chunk.map((i) => stateFor(app.rows[i]));
    let batch: RunResult[];
    try {
      const r = await fetch("/api/run", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ model, states, questions }) });
      const out = await r.json() as RunResponse & { error?: string };
      if (!r.ok) throw new Error(out.error ?? String(r.status));
      batch = out.results;
    } catch (e) {
      batch = chunk.map(() => ({ error: errorText(e) }));
    }
    batch.forEach((x, k) => { results.items[b + k] = { ...x, state: states[k] }; tokens += x.input_tokens ?? 0; });
    $("prog").style.width = `${Math.min(100, ((b + chunk.length) / idx.length) * 100)}%`;
    const errs = results.items.filter((x) => x?.error).length;
    $("runInfo").textContent = `${Math.min(b + chunk.length, idx.length)}/${idx.length} filas · ${tokens.toLocaleString()} tokens · $${(tokens * 0.042 / 1e6).toFixed(5)}${errs ? ` · ${errs} errores` : ""} · ${((performance.now() - t0) / 1000).toFixed(1)} s`;
    renderResults(); void refreshStatus();
  }
  $<HTMLButtonElement>("runBtn").disabled = false; $<HTMLButtonElement>("stopBtn").disabled = true;
  $<HTMLButtonElement>("dlCsv").disabled = $<HTMLButtonElement>("dlJsonl").disabled = false;
}

const nClass = (p: number): string => (p >= YES_AT ? "yes" : p <= NO_AT ? "no" : "mid");
function cellFor(meta: QuestionMeta, a: Answers[string] | undefined, companion?: Answers[string]): string {
  if (!a) return "—";
  if (meta.type === "choice" && companion?.noul !== undefined && companion.noul <= NO_AT)
    return `<span class="muted" title="La Noul compañera dice que no encaja ninguna opción (${companion.noul.toFixed(2)}); la Choice eligió ${esc(a.choice)}">ninguna encaja</span>`;
  if (meta.type === "noul" && a.noul !== undefined) return `<span class="${nClass(a.noul)}">${a.noul.toFixed(2)}</span>`;
  if (meta.type === "choice" && a.choice !== undefined) return `${esc(a.choice)} <span class="muted">${(a.probabilities?.[a.choice] ?? 0).toFixed(2)}</span>`;
  if (meta.type === "score" && a.score !== undefined) return a.score.toFixed(2);
  return esc(JSON.stringify(a));
}
const argmax = (p: Record<string, number> = {}): string | undefined => Object.entries(p).sort((a, b) => b[1] - a[1])[0]?.[0];
function bars(pairs: [string, number][], total: number, code = false): string {
  return pairs.map(([label, n]) => {
    const pct = total ? Math.round((n / total) * 100) : 0;
    return `<div class="bar"><div class="label">${code ? `<code>${esc(label)}</code>` : esc(label)}</div>
      <div class="line"><div class="track"><div class="fill" style="width:${pct}%"></div></div><span class="count">${n} · ${pct}%</span></div></div>`;
  }).join("");
}
function renderResults(): void {
  const R = app.results;
  if (!R) { $("results").innerHTML = ""; $("summary").innerHTML = ""; return; }
  const firstCol = app.selected[0];
  $("results").innerHTML = `<table><tr><th>#</th>${firstCol ? `<th>${esc(firstCol)}</th>` : ""}${R.qMeta.map((m) => `<th>${esc(m.id)}</th>`).join("")}</tr>` +
    R.items.map((it, k) => {
      const i = app.runRows[k]; const row = app.rows[i];
      if (!it) return `<tr><td class="muted">${i}</td><td colspan="${R.qMeta.length + 1}" class="muted">pendiente…</td></tr>`;
      const pre = firstCol ? `<td class="clip">${esc(fmtCell(row[firstCol]))}</td>` : "";
      if (it.error !== undefined) return `<tr class="clickable" data-k="${k}"><td class="muted">${i}</td>${pre}<td colspan="${R.qMeta.length}" class="no">error: ${esc(it.error.slice(0, 200))}</td></tr>`;
      return `<tr class="clickable" data-k="${k}"><td class="muted">${i}</td>${pre}${R.qMeta.map((m) => `<td>${cellFor(m, it.answers[m.id], it.answers[companionId(m.id)])}</td>`).join("")}</tr>`;
    }).join("") + "</table>";
  const done = R.items.flatMap((x) => (x && x.error === undefined ? [x.answers] : []));
  $("summary").innerHTML = R.qMeta.map((m) => {
    const ans = done.map((a) => a[m.id]).filter((a) => a !== undefined);
    if (!ans.length) return "";
    let body = "";
    if (m.type === "noul") {
      const y = ans.filter((a) => (a.noul ?? 0) >= YES_AT).length, n = ans.filter((a) => (a.noul ?? 1) <= NO_AT).length;
      body = bars([[`sí (≥${YES_AT})`, y], ["sin decidir", ans.length - y - n], [`no (≤${NO_AT})`, n]], ans.length);
    } else if (m.type === "choice") {
      const comp = companionId(m.id);
      const fits = (a: Answers): boolean => (a[comp]?.noul ?? 1) > NO_AT;
      const rows = done.filter((a) => a[m.id]);
      const pairs: [string, number][] = m.options.map((o) => [o, rows.filter((a) => fits(a) && a[m.id].choice === o).length]);
      if (R.qMeta.some((x) => x.id === comp)) pairs.push([`ninguna encaja (${comp} ≤ ${NO_AT})`, rows.filter((a) => !fits(a)).length]);
      body = bars(pairs, ans.length, true);
    } else {
      const mean = ans.reduce((s, a) => s + (a.score ?? 0), 0) / ans.length;
      body = `<div class="muted">media ${mean.toFixed(2)} · nivel más probable:</div>` +
        bars(m.levels.map((l, j) => [`${j}. ${l}`, ans.filter((a) => argmax(a.probabilities) === String(j)).length]), ans.length);
    }
    const q = app.questions.find((x) => x.id === m.id);
    return `<div class="sumcard"><div class="head"><b>${esc(m.id)}</b> <span class="muted">${m.type} · ${ans.length} filas</span></div>
      ${q?.instructions ? `<div class="muted" style="margin-bottom:6px">${esc(q.instructions)}</div>` : ""}${body}</div>`;
  }).join("");
}

// ---------- downloads ----------
function download(name: string, text: string, type = "text/plain"): void {
  const a = document.createElement("a");
  a.href = URL.createObjectURL(new Blob([text], { type })); a.download = name; a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}
function csvEscape(v: unknown): string {
  const s = v == null ? "" : typeof v === "object" ? JSON.stringify(v) : String(v);
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}
function exportCsv(): void {
  const R = app.results; if (!R) return;
  const head: string[] = ["row", ...app.columns];
  for (const m of R.qMeta) { head.push(m.id); if (m.type === "choice") head.push(`${m.id}__p`); }
  head.push("error");
  const lines = [head.map(csvEscape).join(",")];
  R.items.forEach((it, k) => {
    if (!it) return;
    const i = app.runRows[k]; const row = app.rows[i];
    const out: unknown[] = [i, ...app.columns.map((c) => row[c])];
    for (const m of R.qMeta) {
      const a = it.answers?.[m.id];
      if (m.type === "choice") out.push(a?.choice, a?.choice ? a.probabilities?.[a.choice] : undefined);
      else out.push(m.type === "score" ? a?.score : a?.noul);
    }
    out.push(it.error ?? "");
    lines.push(out.map(csvEscape).join(","));
  });
  download("jev-results.csv", lines.join("\n"), "text/csv");
}
function exportJsonl(): void {
  const R = app.results; if (!R) return;
  download("jev-results.jsonl", R.items.flatMap((it, k) => it ? [JSON.stringify({
    row: app.runRows[k], model: it.model ?? R.model, state: it.state, answers: it.answers, error: it.error, input_tokens: it.input_tokens,
  })] : []).join("\n"), "application/x-ndjson");
}

// ---------- status ----------
async function refreshStatus(): Promise<void> {
  try {
    const s = await (await fetch("/api/status")).json() as Status;
    $("status").innerHTML = `${s.typesafe_key ? "" : '<span class="no">falta TYPESAFE_API_KEY</span> · '}${s.anthropic_key ? "" : '<span class="no">falta ANTHROPIC_API_KEY</span> · '}gasto: Jev $${s.spend.jev.toFixed(4)} / ${s.caps.jev} · Opus $${s.spend.opus.toFixed(3)} / ${s.caps.opus}`;
  } catch {
    $("status").innerHTML = '<span class="no">servidor no disponible</span>';
  }
}

function renderAll(): void { renderData(); renderNotes(); renderQuestions(); renderExport(); renderResults(); }

// ---------- events: dataset ----------
$("file").onchange = async (e) => {
  const input = e.target as HTMLInputElement; const f = input.files?.[0]; if (!f) return;
  try { setRows(parseData(await f.text(), f.name)); toast(`${app.rows.length} filas cargadas`); } catch (err) { readError(err); }
  input.value = "";
};
$("pasteBtn").onclick = () => $<HTMLDialogElement>("pasteDlg").showModal();
const EXAMPLE_NAMES: Record<string, string> = {
  "support_tickets.csv": "Tickets de soporte · ficticios (30)",
  "sales_calls.json": "Llamadas de venta · Parlora, empresa ficticia (24)",
};
async function loadExampleList(): Promise<void> {
  try {
    const names = await (await fetch("/api/examples")).json() as string[];
    $("exampleSel").innerHTML = names.map((n) => `<option value="${esc(n)}">${esc(EXAMPLE_NAMES[n] ?? n)}</option>`).join("");
  } catch { /* the button reports the failure */ }
}
$("exampleBtn").onclick = async () => {
  const name = $<HTMLSelectElement>("exampleSel").value;
  try {
    const r = await fetch(`/api/example?name=${encodeURIComponent(name)}`);
    if (!r.ok) throw new Error(String(r.status));
    setRows(parseData(await r.text(), name)); toast(`${app.rows.length} filas de ejemplo`);
  } catch { toast("No se pudo cargar el ejemplo"); }
};
$("pasteCancel").onclick = () => $<HTMLDialogElement>("pasteDlg").close();
$("pasteOk").onclick = () => {
  try { setRows(parseData($<HTMLTextAreaElement>("pasteArea").value)); $<HTMLDialogElement>("pasteDlg").close(); } catch (err) { readError(err); }
};
$("cols").onclick = (e) => {
  const c = (e.target as HTMLElement).closest<HTMLElement>("[data-col]")?.dataset.col; if (c === undefined) return;
  app.selected = app.selected.includes(c) ? app.selected.filter((x) => x !== c) : app.columns.filter((x) => x === c || app.selected.includes(x));
  renderData(); renderExport(); save();
};
$("dropEmpty").onchange = () => { app.dropEmpty = $("dropEmpty").checked; renderExport(); save(); };
$("context").oninput = () => { app.context = $("context").value; renderExport(); save(); };
$("sampleSize").onchange = () => { app.sampleSize = Math.max(1, Number($("sampleSize").value) || 15); resample(); renderData(); renderExport(); save(); };
$("resample").onclick = () => { resample(); renderData(); renderExport(); save(); };

// ---------- events: generate ----------
$("goal").oninput = () => { app.goal = $("goal").value; updateGenBtn(); save(); };
$("nq").onchange = () => { app.nq = Number($("nq").value) || 8; save(); };
$("genBtn").onclick = async () => {
  if (!app.rows.length) return toast("Carga un dataset primero");
  const inferred = !app.goal.trim();
  $<HTMLButtonElement>("genBtn").disabled = true;
  $("genInfo").textContent = inferred ? "Opus está revisando la muestra para proponer un objetivo… (suele tardar 30–90 s)" : "Opus está pensando… (suele tardar 30–90 s)";
  try {
    const sample = app.sampleIdx.map((i) => Object.fromEntries(app.selected.map((c) => [c, app.rows[i][c] ?? null])));
    const r = await fetch("/api/generate", { method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ goal: app.goal, context: app.context, columns: app.selected, sample, n_questions: app.nq }) });
    const out = await r.json() as GenerateResponse & { error?: string };
    if (!r.ok) throw new Error(out.error);
    const qs = out.questions.map(normalizeQ);
    if ($("replaceQs").checked) app.questions = qs;
    else for (const q of qs) { while (app.questions.some((o) => o.id === q.id)) q.id += "_2"; app.questions.push(q); }
    app.notes = { decision_sketch: out.decision_sketch, code_notes: out.code_notes, state_columns: out.state_columns,
      goal_used: out.goal_used, suggested_goals: out.suggested_goals, inferred };
    $("genInfo").textContent = `${qs.length} preguntas · ${out.usage.input_tokens + out.usage.output_tokens} tokens · $${out.cost_usd.toFixed(3)} · ${out.seconds.toFixed(0)} s`;
    renderAll(); save(); location.hash = "s-q";
  } catch (e) {
    $("genInfo").innerHTML = `<span class="no">${esc(errorText(e))}</span>`;
  }
  $<HTMLButtonElement>("genBtn").disabled = false; void refreshStatus();
};

// ---------- events: questions ----------
const addQ = (type: QuestionType) => () => { app.questions.push(blankQ(type)); renderQuestions(); renderExport(); save(); };
$("addNoul").onclick = addQ("noul");
$("addChoice").onclick = addQ("choice");
$("addScore").onclick = addQ("score");
$("saveProj").onclick = () => download("jev-project.json", JSON.stringify({
  goal: app.goal, context: app.context, selected: app.selected, dropEmpty: app.dropEmpty, notes: app.notes, questions: app.questions,
}, null, 2), "application/json");
$("loadProj").onchange = async (e) => {
  const input = e.target as HTMLInputElement; const f = input.files?.[0]; if (!f) return;
  try {
    const p = JSON.parse(await f.text());
    app.questions = (p.questions ?? []).map(normalizeQ); app.goal = p.goal ?? ""; app.context = p.context ?? ""; app.notes = p.notes ?? null;
    if (p.selected) app.selected = app.columns.length ? app.columns.filter((c) => p.selected.includes(c)) : p.selected;
    if (p.dropEmpty !== undefined) app.dropEmpty = p.dropEmpty;
    $("goal").value = app.goal; updateGenBtn(); renderAll(); save(); toast("Proyecto cargado");
  } catch {
    toast("Proyecto no válido");
  }
  input.value = "";
};
$("tagbar").onclick = (e) => {
  const t = (e.target as HTMLElement).closest<HTMLElement>("[data-tag]")?.dataset.tag; if (t === undefined) return;
  const qs = app.questions.filter((q) => q.tags.includes(t)); const on = qs.every((q) => q.active !== false);
  qs.forEach((q) => (q.active = !on)); renderQuestions(); renderExport(); save();
};

// Field edits update the model without re-rendering (keeps focus); structural changes re-render.
type Field = "id" | "instructions" | "true_criterion" | "false_criterion";
const ql = $("qlist");
ql.oninput = (e) => {
  const el = e.target as HTMLInputElement; const d = el.dataset;
  if (d.q === undefined || d.act) return;
  const q = app.questions[Number(d.q)];
  if (d.opt !== undefined) q.options[Number(d.opt)][d.k as "name" | "description"] = el.value;
  else if (d.lvl !== undefined) q.levels[Number(d.lvl)] = el.value;
  else if (d.k && d.k !== "type") q[d.k as Field] = el.value;
  renderExport(); save();
};
ql.onchange = (e) => {
  const el = e.target as HTMLInputElement; const d = el.dataset;
  if (d.q === undefined) return;
  const q = app.questions[Number(d.q)];
  if (d.act === "toggle") q.active = el.checked;
  else if (d.k === "type") {
    q.type = el.value as QuestionType;
    if (q.type === "choice" && q.options.length < 2) q.options = [{ name: "", description: "" }, { name: "", description: "" }];
    if (q.type === "score" && q.levels.length < 2) q.levels = ["", "", ""];
  } else if (d.act === "newtag") {
    const t = el.value.trim().replace(/^#/, ""); if (t && !q.tags.includes(t)) q.tags.push(t);
  }
  renderQuestions(); renderExport(); save();
};
ql.onkeydown = (e) => {
  const el = e.target as HTMLInputElement;
  if (e.key === "Enter" && el.dataset.act === "newtag") { e.preventDefault(); el.blur(); }
};
ql.onclick = (e) => {
  const el = (e.target as HTMLElement).closest<HTMLElement>("[data-act]");
  if (!el || el.tagName === "INPUT") return;
  const d = el.dataset; const i = Number(d.q); const q = app.questions[i]; const Q = app.questions;
  const swap = <T,>(arr: T[], a: number, b: number) => { if (b < 0 || b >= arr.length) return; [arr[a], arr[b]] = [arr[b], arr[a]]; };
  switch (d.act) {
    case "del": if (!confirm(`¿Borrar la pregunta ${q.id}?`)) return; Q.splice(i, 1); break;
    case "dup": { const c: DraftQuestion = structuredClone(q); c.id += "_copia"; Q.splice(i + 1, 0, c); break; }
    case "mvup": swap(Q, i, i - 1); break;
    case "mvdown": swap(Q, i, i + 1); break;
    case "addopt": q.options.push({ name: "", description: "" }); break;
    case "companion": Q.splice(i + 1, 0, companionFor(q)); break;
    case "delopt": q.options.splice(Number(d.opt), 1); break;
    case "addlvl": q.levels.push(""); break;
    case "dellvl": q.levels.splice(Number(d.lvl), 1); break;
    case "up": swap(q.levels, Number(d.lvl), Number(d.lvl) - 1); break;
    case "down": swap(q.levels, Number(d.lvl), Number(d.lvl) + 1); break;
    case "deltag": q.tags.splice(Number(d.tag), 1); break;
    default: return;
  }
  renderQuestions(); renderExport(); save();
};

// ---------- events: export + run ----------
$("exTabs").onclick = (e) => {
  const t = (e.target as HTMLElement).dataset.tab as ExportTab | undefined; if (!t) return;
  app.exTab = t; renderExport(); save();
};
$("model").onchange = renderExport;
$("copyEx").onclick = async () => {
  try { await navigator.clipboard.writeText($("exOut").textContent ?? ""); toast("Copiado"); } catch { toast("No se pudo copiar"); }
};
$("dlEx").onclick = () => download(EXPORT_TABS[app.exTab].file, $("exOut").textContent ?? "");

$("runBtn").onclick = () => void run();
$("stopBtn").onclick = () => { stopFlag = true; $<HTMLButtonElement>("stopBtn").disabled = true; };
$("dlCsv").onclick = exportCsv;
$("dlJsonl").onclick = exportJsonl;

let openRow: { model: string; state: JsonValue; questions: ReturnType<typeof toJevQuestions> } | null = null;
$("results").onclick = (e) => {
  const k = (e.target as HTMLElement).closest<HTMLElement>("tr[data-k]")?.dataset.k;
  const R = app.results; if (k === undefined || !R) return;
  const it = R.items[Number(k)]; if (!it) return;
  openRow = { model: it.model ?? R.model, state: it.state, questions: toJevQuestions(activeQs()) };
  $("rowTitle").textContent = `Fila ${app.runRows[Number(k)]}${it.model ? " · " + it.model : ""}`;
  $("rowState").textContent = JSON.stringify(it.state, null, 2);
  $("rowAnswers").textContent = JSON.stringify(it.error !== undefined ? { error: it.error } : it.answers, null, 2);
  $<HTMLDialogElement>("rowDlg").showModal();
};
$("rowClose").onclick = () => $<HTMLDialogElement>("rowDlg").close();
$("rowCopy").onclick = async () => {
  try { await navigator.clipboard.writeText(JSON.stringify(openRow, null, 2)); toast("Petición copiada"); } catch { toast("No se pudo copiar"); }
};

// ---------- start ----------
load();
$("goal").value = app.goal; $("nq").value = String(app.nq); updateGenBtn();
if (app.rows.length && !app.sampleIdx.length) resample();
renderAll(); void refreshStatus(); void loadExampleList();

// Exposed for debugging from the browser console.
Object.assign(window, { jevWorkbench: { app, toJev } });
