# Jev Workbench

Herramienta local para diseñar preguntas de [TypeSafe Jev](https://docs.typesafe.ai) sobre un dataset:

1. **Dataset**: carga un CSV, JSON o JSONL, elige qué columnas van al state y saca una muestra.
2. **Generar**: Opus 5.5 lee el objetivo, las columnas y la muestra, y propone preguntas atómicas
   (Choice, Noul, Score), un boceto de la lógica de decisión (que va en tu código), qué conviene
   resolver en código y qué columnas meter en el state. El objetivo es opcional: si lo dejas
   vacío, Opus revisa la muestra, propone el objetivo más útil y genera las preguntas para él.
   Siempre sugiere además otros objetivos posibles con esos datos; un clic los pone como objetivo
   para volver a generar.
3. **Preguntas**: todo es editable: IDs, tipo, instrucciones, opciones (añadir/quitar), niveles
   (añadir/quitar/reordenar), criterios de sí/no, tags. Activa o desactiva preguntas una a una o
   por tag. Guarda y carga el proyecto como JSON.
4. **Exportar**: las preguntas activas como JSON, petición completa, TypeScript (con el SDK
   `@typesafe-ai/sdk`), Python o curl.
5. **Ejecutar**: corre Jev sobre la muestra, las primeras N filas o todo el dataset (una petición
   por fila con todas las preguntas). Resumen por pregunta, tabla de resultados, detalle de cada
   fila con el state exacto enviado, y descarga en CSV o JSONL.

Cada fila se envía como:

```json
{"context": "hechos compartidos (opcional)", "record": {"columna": "valor", "...": "..."}}
```

así que las preguntas se refieren a los campos como `` `record.columna` ``.

## Uso

Requiere Node.js 24 o superior (el servidor corre TypeScript directamente con Node).

```bash
npm install
cp .env.example .env   # rellena TYPESAFE_API_KEY y ANTHROPIC_API_KEY
npm start              # compila la página y arranca en http://127.0.0.1:8791
```

Elige un ejemplo en el desplegable y pulsa **Cargar ejemplo**:

- `examples/support_tickets.csv`: 30 tickets de soporte de una app de facturación.
- `examples/sales_calls.json`: 24 llamadas de venta de Parlora como las exportaría Fathom
  (título, asistentes, empresa y transcripción por turnos), en español e inglés. Incluye columnas
  `label_stage`, `label_outcome` y `label_main_objection` con lo que pasó en cada llamada, para
  comparar con las respuestas de Jev.

Los dos son ficticios: empresas, personas, precios y conversaciones inventados. Las columnas que
se llaman `label` o empiezan por `label_` se cargan desmarcadas, para que Jev no vea la respuesta.

Otros comandos:

```bash
npm run dev         # recompila la página y reinicia el servidor al guardar
npm run typecheck   # tsc --noEmit sobre servidor y cliente
```

## Notas

- Las claves se quedan en el servidor local; el navegador nunca las ve.
- Opus se llama con structured outputs (esquema Zod) y con `fallbacks: "default"`: si la petición
  se rechaza por una política de seguridad, la API la reintenta en el modelo de respaldo que
  corresponda a esa categoría.
- Límite de gasto por proceso: `JEV_SPEND_CAP_USD` y `OPUS_SPEND_CAP_USD` (2 USD cada uno por
  defecto). Como referencia, generar 8 preguntas cuesta unos 0,08 USD en Opus y ejecutar 30 filas
  con 8 preguntas unos 0,002 USD en Jev.
- Cada petición a Jev (state, preguntas y respuesta) se guarda en `runs/calls.jsonl` para poder
  repetirla. `runs/` está en `.gitignore`.
- Una llamada fallida se muestra como error, nunca como respuesta.
- Umbrales de lectura en la UI para Noul: ≥ 0,7 sí, ≤ 0,3 no, en medio sin decidir.
- El estado de la página (dataset, preguntas, objetivo) se guarda en el `localStorage` del navegador.
  Para conservarlo de verdad, usa **Guardar proyecto**.
- Solo texto por ahora: no envía imágenes ni preguntas Box.

## Estructura

```
src/server/server.ts      servidor HTTP (node:http): estáticos y /api/generate, /api/run, /api/status
src/server/generator.ts   prompt y esquema Zod para que Opus redacte las preguntas
src/shared/types.ts       tipos compartidos y la conversión de pregunta editable a pregunta de Jev
src/client/app.ts         la interfaz (se compila con esbuild a public/app.js)
src/client/parse.ts       lectura de CSV, JSON y JSONL
src/client/exporters.ts   los snippets de exportación
public/index.html         marcado y estilos
examples/                 dataset de ejemplo
```
