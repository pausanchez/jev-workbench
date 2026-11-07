// Regenerates the README screenshots in docs/screenshots/.
//
//     npm start                 # in another terminal: the Workbench must be running
//     npm run screenshots
//
// Loads the Parlora sales calls example and its saved project (questions and Opus notes, so no
// Opus call is made), runs Jev on every call (about $0.002) and captures each step with your
// installed Chrome at 2x. Set CHROME_PATH if Chrome is not in the default macOS location, and
// WORKBENCH_URL if the Workbench runs on another port.

import { mkdir } from "node:fs/promises";
import { join, resolve } from "node:path";
import puppeteer, { type Page } from "puppeteer-core";

const ROOT = resolve(import.meta.dirname, "..");
const OUT = join(ROOT, "docs", "screenshots");
const URL = process.env.WORKBENCH_URL ?? "http://127.0.0.1:8791";
const CHROME = process.env.CHROME_PATH ?? "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const PROJECT = join(ROOT, "examples", "sales_calls.project.json");

async function shot(page: Page, selector: string, file: string, maxHeight = 1400): Promise<void> {
  const el = await page.$(selector);
  const box = await el?.boundingBox();
  if (!box) throw new Error(`${selector} not found`);
  const scrollY = await page.evaluate(() => window.scrollY);
  await page.screenshot({
    path: join(OUT, file),
    captureBeyondViewport: true,
    clip: { x: box.x - 8, y: box.y + scrollY - 8, width: box.width + 16, height: Math.min(box.height, maxHeight) + 16 },
  });
  console.log(`docs/screenshots/${file}`);
}

const browser = await puppeteer.launch({ executablePath: CHROME, headless: true });
try {
  const page = await browser.newPage();
  await page.setViewport({ width: 1280, height: 900, deviceScaleFactor: 2 });
  await page.emulateMediaFeatures([{ name: "prefers-color-scheme", value: "light" }]);
  await page.goto(URL, { waitUntil: "networkidle0" });
  await page.evaluate(() => localStorage.clear());
  await page.reload({ waitUntil: "networkidle0" });
  await mkdir(OUT, { recursive: true });

  // 1 · Dataset
  await page.select("#exampleSel", "sales_calls.json");
  await page.click("#exampleBtn");
  await page.waitForFunction(() => document.querySelectorAll("#preview tr").length > 1);
  const loadProject = await page.$("#loadProj");
  await (loadProject as unknown as { uploadFile(path: string): Promise<void> }).uploadFile(PROJECT);
  await page.waitForFunction(() => document.querySelectorAll(".qcard").length > 0);
  await page.evaluate(() => document.getElementById("toast")?.classList.remove("show"));
  await shot(page, "#s-data", "1-dataset.png", 900);

  // 2 · Generar (the notes come from the saved project)
  await shot(page, "#s-gen", "2-generar.png");

  // 3 · Preguntas
  await shot(page, "#s-q", "3-preguntas.png", 1300);

  // 4 · Exportar
  await page.click('#exTabs [data-tab="typescript"]');
  await shot(page, "#s-export", "4-exportar.png", 800);

  // 5 · Ejecutar
  await page.select("#scope", "all");
  await page.click("#runBtn");
  await page.waitForFunction(() => !(document.getElementById("runBtn") as HTMLButtonElement).disabled
    && document.querySelectorAll("#results tr[data-k]").length > 0, { timeout: 120_000 });
  const errors = await page.$$eval("#results td.no", (tds) => tds.length);
  if (errors) throw new Error(`${errors} rows failed: is TYPESAFE_API_KEY set on the server?`);
  await new Promise((r) => setTimeout(r, 500)); // let the progress bar finish its transition
  await shot(page, "#s-run", "5-ejecutar.png", 1500);

  // Row detail
  await page.click('#results tr[data-k="5"]');
  await page.waitForSelector("#rowDlg[open]");
  await shot(page, "#rowDlg", "6-detalle-fila.png", 900);
} finally {
  await browser.close();
}
