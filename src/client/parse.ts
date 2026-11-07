// Turn an uploaded or pasted file into rows. Accepts CSV (comma, semicolon or tab, with a
// header row), a JSON array of objects (or {"rows": [...]}), or JSONL.

import type { Row } from "../shared/types.ts";

export const FORMAT_HELP = "Usa CSV con cabecera, JSON (lista de objetos) o JSONL, en UTF-8.";

/** Errors whose message is already written for the user. */
export class FormatError extends Error {}

export function parseCSV(text: string): Row[] {
  text = text.replace(/^﻿/, "");
  const first = text.split(/\r?\n/, 1)[0];
  const delim = [",", ";", "\t"].map((d) => [d, first.split(d).length] as const).sort((a, b) => b[1] - a[1])[0][0];
  const out: string[][] = [];
  let row: string[] = [], field = "", quoted = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quoted) {
      if (c === '"') { if (text[i + 1] === '"') { field += '"'; i++; } else quoted = false; }
      else field += c;
    } else if (c === '"') quoted = true;
    else if (c === delim) { row.push(field); field = ""; }
    else if (c === "\n" || c === "\r") {
      if (c === "\r" && text[i + 1] === "\n") i++;
      row.push(field); field = ""; if (row.some((v) => v !== "")) out.push(row); row = [];
    } else field += c;
  }
  row.push(field); if (row.some((v) => v !== "")) out.push(row);
  const header = (out.shift() ?? []).map((h, i) => h.trim() || `col_${i + 1}`);
  return out.map((r) => Object.fromEntries(header.map((h, i) => [h, r[i] ?? ""])));
}

export function parseData(text: string, name = ""): unknown[] {
  const ext = (name.split(".").pop() ?? "").toLowerCase();
  if (["xlsx", "xls", "ods", "numbers"].includes(ext) || text.startsWith("PK"))
    throw new FormatError("Es una hoja de cálculo. Guárdala como \"CSV UTF-8\" y súbela de nuevo.");
  if (ext === "parquet" || text.startsWith("PAR1"))
    throw new FormatError("Parquet no está soportado. Conviértelo a CSV, p. ej. pandas.read_parquet(f).to_csv(\"datos.csv\", index=False).");
  const t = text.trim();
  if (!t) throw new FormatError("El fichero está vacío.");
  if (t.startsWith("[")) return JSON.parse(t);
  if (t.startsWith("{")) {
    try {
      const one = JSON.parse(t);
      return Array.isArray(one) ? one : Array.isArray(one.rows) ? one.rows : [one];
    } catch {
      return t.split(/\r?\n/).filter((l) => l.trim()).map((l) => JSON.parse(l));
    }
  }
  return parseCSV(text);
}

export function isRow(value: unknown): value is Row {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
