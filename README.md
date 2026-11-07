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
4. **Exportar**: las preguntas activas como JSON, petición completa, Python, JavaScript o curl.
5. **Ejecutar**: corre Jev sobre la muestra, las primeras N filas o todo el dataset (una petición
   por fila con todas las preguntas). Resumen por pregunta, tabla de resultados, detalle de cada
   fila con el state exacto enviado, y descarga en CSV o JSONL.

Cada fila se envía como:

```json
{"context": "hechos compartidos (opcional)", "record": {"columna": "valor", "...": "..."}}
```

así que las preguntas se refieren a los campos como `` `record.columna` ``.

## Uso

Requiere Python 3.9+.

```bash
python3 -m venv .venv
.venv/bin/pip install -r requirements.txt
cp .env.example .env   # rellena TYPESAFE_API_KEY y ANTHROPIC_API_KEY
.venv/bin/python workbench/server.py
```

Abre http://127.0.0.1:8791 y pulsa **Cargar ejemplo** para probar con `examples/support_tickets.csv`
(30 tickets de soporte ficticios).

## Notas

- Las claves se quedan en el servidor local; el navegador nunca las ve.
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
workbench/server.py     servidor HTTP (stdlib) y endpoints /api/generate, /api/run, /api/status
workbench/generator.py  prompt y esquema para que Opus redacte las preguntas
workbench/clients.py    clientes de Jev (HTTP) y Claude (SDK de Anthropic)
public/index.html       la interfaz (una sola página, sin build)
examples/               dataset de ejemplo
```
