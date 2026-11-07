# Jev Workbench

Una herramienta para probar, sin programar, qué puede responder
[Jev](https://docs.typesafe.ai) sobre tus propios datos: tickets de soporte, llamadas de venta,
reseñas, formularios… Cargas un fichero, una IA (Claude Opus) te propone las preguntas, las ajustas
a tu gusto y ves cómo las responde Jev en cada fila. Cuando te convencen, las copias para pasárselas
al equipo de desarrollo.

Está pensada para Product Managers y perfiles no técnicos. Se instala y se arranca en tu ordenador;
lo más cómodo es pedírselo a [Claude Code](#instalarlo-con-claude-code-recomendado).

---

## Qué es Jev, en un minuto

Jev es un modelo de [TypeSafe](https://typesafe.ai) que responde **preguntas cerradas** sobre un
texto, muy rápido y muy barato. No escribe redacciones: contesta con una probabilidad. Hay tres
tipos de pregunta:

| Tipo | Qué responde | Ejemplo con una llamada de venta |
|---|---|---|
| **Noul** (sí/no) | La probabilidad de que algo sea cierto, de 0 a 1 | ¿El cliente menciona a un competidor? → 0,97 |
| **Choice** (elegir una) | Cuál de tus opciones encaja mejor | ¿En qué etapa está el deal? → `demo` |
| **Score** (escala) | Un nivel dentro de una escala que tú defines | ¿Cuánto interés muestra el cliente? → 3 de 4 |

La idea es no preguntarle "¿qué hago con esta llamada?", sino muchas preguntas pequeñas que una
persona contestaría de un vistazo. Luego **tus reglas** deciden qué hacer con esas respuestas
(por ejemplo: "si menciona un competidor y no hay siguiente paso, avisar al jefe de ventas"). La
herramienta te propone también esas reglas, en el "boceto de la lógica de decisión".

---

## Qué necesitas

1. **Acceso a este repositorio** en GitHub. Si no lo ves, pide al propietario que te invite.
2. **Dos claves de API**, o que alguien de tu equipo te las pase:
   - **TypeSafe** (para Jev): en [console.typesafe.ai](https://console.typesafe.ai).
   - **Anthropic** (para Opus, el que redacta las preguntas): en
     [platform.claude.com](https://platform.claude.com).
3. **Claude Code**, que hará la instalación por ti. Vale la app de escritorio de Claude (pestaña
   Code) o la versión de terminal.

Las claves son como contraseñas: no las pegues en documentos compartidos ni en chats.

---

## Instalarlo con Claude Code (recomendado)

1. Abre Claude Code en la carpeta donde quieras guardar la herramienta (por ejemplo, `Documentos`).
2. Copia y pega este mensaje:

   > Clona el repositorio privado de GitHub `pausanchez/jev-workbench` e instala lo que haga falta
   > para usarlo (incluido Node.js 24 o superior si no lo tengo). Crea el fichero `.env` a partir de
   > `.env.example`, pero no me pidas las claves por el chat: dime qué fichero tengo que abrir para
   > pegarlas yo. Cuando las haya pegado, arranca la herramienta y dime qué dirección abrir en el
   > navegador.

3. Claude te pedirá permiso para ejecutar comandos. Es normal: está descargando e instalando.
4. Cuando te lo diga, abre el fichero `.env` con cualquier editor de texto y pega tus claves
   después del `=`, así:

   ```
   TYPESAFE_API_KEY=aquí-tu-clave-de-typesafe
   ANTHROPIC_API_KEY=aquí-tu-clave-de-anthropic
   ```

5. Abre en el navegador la dirección que te indique, normalmente **http://127.0.0.1:8791**.

### Frases útiles para el día a día

Abre Claude Code en la carpeta `jev-workbench` y pide lo que necesites:

| Para… | Dile a Claude Code |
|---|---|
| Arrancarla | "Arranca Jev Workbench y dime qué dirección abrir." |
| Pararla | "Para el servidor de Jev Workbench." |
| Actualizarla | "Actualiza Jev Workbench a la última versión del repositorio y vuelve a arrancarlo." |
| Arreglar un fallo | "Jev Workbench no arranca (o da este error: …). Averigua qué pasa y arréglalo." |
| Preparar tus datos | "Convierte este Excel a CSV en UTF-8 para cargarlo en Jev Workbench: …" |

La herramienta sigue funcionando mientras esté abierta la ventana donde se arrancó. Si la cierras,
pídele a Claude Code que la arranque otra vez.

---

## Cómo se usa, paso a paso

La página tiene cinco pasos, de arriba abajo.

### 1 · Dataset: carga tus datos

- **Sube un fichero** CSV (la exportación normal de Excel o Google Sheets, con una fila de
  títulos), JSON o JSONL. Si tienes un Excel, guárdalo antes como "CSV UTF-8".
- O pulsa **Cargar ejemplo** para probar con los datos ficticios incluidos.
- **Elige las columnas** que Jev debe leer. Marca solo las que una persona miraría para responder:
  quita identificadores, fechas internas y columnas que no aporten. Cuantas menos distracciones,
  mejores respuestas.
- **Contexto compartido** (opcional): una o dos frases que el modelo no puede saber. Por ejemplo:
  "Son llamadas de venta de Parlora, una plataforma de chatbots. Los asistentes marcados como
  (Parlora) son nuestros comerciales."
- **Muestra**: las filas que verá Opus para proponer preguntas. Con 15 a 25 suele bastar.

### 2 · Generar: deja que Opus proponga las preguntas

- Escribe el **objetivo**: qué quieres decidir con estos datos. Por ejemplo: "Detectar qué deals
  están en riesgo y por qué".
- ¿No lo tienes claro? **Déjalo vacío.** Opus revisará la muestra, propondrá el objetivo que vea
  más útil y te sugerirá otros posibles; con un clic eliges uno y vuelves a generar.
- Pulsa el botón y espera entre 30 y 90 segundos. Además de las preguntas, verás:
  - el **boceto de la lógica de decisión**: las reglas que tu producto aplicaría con las respuestas;
  - lo que conviene resolver **sin IA** (fechas, cálculos, búsquedas exactas);
  - las **columnas recomendadas** (con un botón para aplicarlas).

### 3 · Preguntas: revísalas y ajústalas

Todo se puede editar: el texto de la pregunta, las opciones de una Choice, los niveles de una
Score, qué significa "sí" y "no" en una Noul, y las etiquetas (tags).

- Usa la casilla de cada pregunta, o pulsa una tag, para **activar o desactivar** preguntas sin
  borrarlas.
- **Guardar proyecto** descarga un fichero con tus preguntas; **Cargar proyecto** lo recupera otro
  día o en otro ordenador. Hazlo siempre que el trabajo te importe: la página recuerda lo último
  que hiciste, pero solo en ese navegador.
- Si una pregunta tiene un problema (un nombre repetido, una Choice sin opciones…), se marca en rojo.

### 4 · Exportar: llévatelo a tu equipo

Copia las preguntas activas en el formato que prefiera desarrollo: JSON, la petición completa,
TypeScript, Python o curl. Todos funcionan tal cual.

### 5 · Ejecutar: mira cómo responde Jev

- Elige qué filas probar (la muestra, las primeras N o todas) y pulsa **Ejecutar**. Jev tarda
  menos de un segundo por tanda.
- Arriba, un **resumen** por pregunta (cuántas filas dijeron sí, no, o qué opción salió); debajo,
  la **tabla** fila a fila. Haz clic en una fila para ver exactamente qué recibió Jev y qué
  contestó.
- Cómo leer los números: en una pregunta sí/no, **0,7 o más es sí**, **0,3 o menos es no**, y lo
  de en medio significa que **no está claro** (normalmente porque el texto no lo dice).
- **Descarga** los resultados en CSV para abrirlos en Excel o Google Sheets.

---

## Ejemplos incluidos

Ambos son **inventados**: empresas, personas, precios y conversaciones.

- **Tickets de soporte (30)**: mensajes de clientes de una app de facturación.
- **Llamadas de venta Parlora (24)**: transcripciones como las que exportaría Fathom, en español e
  inglés: demos, negociaciones de precio, deals perdidos contra la competencia, un cliente
  descontento, una llamada cancelada…

Las llamadas traen tres columnas con la respuesta correcta (`label_stage`, `label_outcome`,
`label_main_objection`) para que compares con lo que dice Jev. Se cargan desmarcadas a propósito:
si las marcas, Jev vería la solución. Esto funciona con cualquier columna que se llame `label` o
empiece por `label_`, también en tus datos.

---

## Consejos para que las preguntas funcionen

- **Una cosa por pregunta.** "¿Menciona precio o competencia?" son dos preguntas.
- **Pregunta lo que se puede ver en el texto**, no la decisión final. Mejor "¿El cliente dice que
  se plantea irse?" que "¿Hay que escalar esta cuenta?". La decisión la ponen tus reglas.
- **La prueba de la persona:** si un compañero, leyendo solo esa fila, no podría responder rápido,
  Jev tampoco. Suele arreglarse dándole mejores columnas o contexto, no cambiando la redacción.
- **Sobre la opción "otro":** una Choice siempre elige alguna opción, aunque no encaje ninguna. En
  vez de añadir "otro", cada Choice lleva una pregunta sí/no compañera que comprueba si alguna
  opción encaja (Opus la añade solo; en el editor hay un botón para crearla). Cuando dice que no,
  los resultados muestran "ninguna encaja".
- **No ajustes la redacción para acertar un caso concreto.** Si una respuesta te sorprende, mira
  primero qué recibió Jev (clic en la fila): casi siempre falta información.

---

## Cuánto cuesta y qué datos salen de tu ordenador

- **Coste orientativo:** generar 8–10 preguntas con Opus, unos 0,10–0,15 USD; ejecutar 30 filas con
  Jev, unos 0,002 USD. Arriba a la derecha ves lo gastado. Por seguridad, la herramienta se para al
  llegar a 2 USD por modelo cada vez que se arranca.
- **Qué se envía:**
  - a **Anthropic** (Opus), las filas de la muestra con las columnas marcadas, el objetivo y el
    contexto, solo al pulsar Generar;
  - a **TypeSafe** (Jev), las filas que ejecutas, con las columnas marcadas, y las preguntas.
- **Qué no sale de tu ordenador:** las claves y el registro de llamadas (carpeta `runs/`).
- Antes de cargar datos reales de clientes, comprueba con tu equipo si puedes enviarlos a estos
  servicios. Si tienes dudas, prueba primero con los ejemplos o con datos anonimizados.

---

## Problemas frecuentes

| Ves esto | Qué pasa | Qué hacer |
|---|---|---|
| `Could not read package.json` | El comando se ejecutó en otra carpeta | Pide a Claude Code que lo arranque desde la carpeta `jev-workbench` |
| `Port 8791 is already in use` | Ya hay una copia en marcha | Abre http://127.0.0.1:8791, o pide a Claude Code que pare la otra |
| Arriba a la derecha: "falta TYPESAFE_API_KEY" o "falta ANTHROPIC_API_KEY" | La clave no está en el fichero `.env` | Pégala en `.env` y vuelve a arrancar |
| "servidor no disponible" | La herramienta no está en marcha | Arráncala otra vez |
| "Jev spend cap … reached" u "Opus spend cap … reached" | Se alcanzó el límite de gasto de esa sesión | Vuelve a arrancar la herramienta |
| No ves un cambio reciente | La página o el servidor siguen con la versión anterior | Recarga el navegador; si no basta, reinicia la herramienta |

Si nada de esto lo resuelve, copia el error y pídele a Claude Code que lo investigue.

---

## Para desarrolladores

Requiere Node.js 24 o superior: el servidor ejecuta TypeScript directamente con Node.

```bash
npm install
cp .env.example .env   # TYPESAFE_API_KEY y ANTHROPIC_API_KEY
npm start              # compila la página y arranca en http://127.0.0.1:8791
npm run dev            # recompila y reinicia al guardar
npm run typecheck      # tsc --noEmit sobre servidor y cliente
```

Variables opcionales en `.env`: `PORT`, `JEV_SPEND_CAP_USD`, `OPUS_SPEND_CAP_USD`.

Cada fila se envía a Jev como el state
`{"context": "…", "record": {"columna": "valor"}}`, así que las preguntas se refieren a los
campos como `` `record.columna` ``. Las preguntas se editan en una forma propia (`DraftQuestion`)
y se convierten a preguntas de Jev en un único sitio (`toJev` en `src/shared/types.ts`), así que lo
que se ve en el editor es exactamente lo que se envía.

Detalles:

- Jev se llama con `@typesafe-ai/sdk`; Opus con `@anthropic-ai/sdk`, structured outputs (esquema
  Zod) y `fallbacks: "default"`, que reintenta en otro modelo si la petición se rechaza por una
  política de seguridad.
- Una llamada fallida se muestra como error, nunca como respuesta.
- Cada petición a Jev (state, preguntas y respuesta) se guarda en `runs/calls.jsonl` para poder
  repetirla. `runs/` y `.env` están en `.gitignore`.
- Solo texto por ahora: no envía imágenes ni preguntas Box.

```
src/server/server.ts      servidor HTTP (node:http): estáticos y /api/generate, /api/run, /api/status, /api/examples
src/server/generator.ts   prompt y esquema Zod para que Opus redacte las preguntas
src/shared/types.ts       tipos compartidos y la conversión de pregunta editable a pregunta de Jev
src/client/app.ts         la interfaz (se compila con esbuild a public/app.js)
src/client/parse.ts       lectura de CSV, JSON y JSONL
src/client/exporters.ts   los snippets de exportación
public/index.html         marcado y estilos
examples/                 datasets de ejemplo
```
