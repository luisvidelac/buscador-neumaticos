# Plan de mejoras — consultas masivas de precios

> **Para quien ejecute:** usar subagentes con revisión en dos etapas por tarea (implementador → revisor de cumplimiento → revisor de calidad), igual que el resto del trabajo de esta sesión.

**Objetivo:** que el scraper aguante una corrida real de 112 medidas (el Excel `compara neumaticosK.xlsx` del cliente) sin agotar el timeout HTTP, sin perder todo si falla a mitad de camino, y sin que un proveedor colgado frene el resto.

**Arquitectura:** `POST /api/neumaticos/lote` deja de ser una llamada bloqueante que espera el lote completo — ahora crea un "job" en segundo plano y devuelve `{jobId}` al toque. El procesamiento corre con paralelismo limitado (varias medidas a la vez, no una por una) y graba el progreso a disco después de cada medida. El frontend consulta el estado del job cada 2 segundos (polling) en vez de esperar una sola respuesta gigante.

**Stack:** mismo stack existente (Express, Playwright, React+Vite) + `p-limit` (control de concurrencia, sin infraestructura de colas/Redis — no hace falta a esta escala).

**Fuera de alcance de esta ronda (decisión explícita, no es olvido):**
- Reemplazar las esperas fijas (`waitForTimeout`) por esperas inteligentes (`waitForSelector`) en los scrapers — requiere verificar contra los sitios reales en vivo para no romper silenciosamente algo que hoy funciona; el timeout por proveedor (Tarea 2) ya resuelve el riesgo real de "un scraper colgado frena todo el lote", que era el problema de fondo.
- Levantar el límite de 2 proveedores seleccionables a la vez en el frontend — limitación real, pero no es lo que impide correr las 112 medidas (se puede correr el lote completo contra 2 proveedores, varias veces). Mencionado para una ronda futura si se pide.
- Deploy/URL configurable — el frontend sigue apuntando a `http://localhost:3001` (sin cambios), no se tocó nada de hosting.

---

## Tarea 1: Registrar los 2 scrapers reales que estaban sin conectar

**Archivos:**
- Modificar: `backend/scrapers/index.js`
- Modificar: `frontend/src/main.jsx`

- [ ] **Paso 1: Leer primero**

Confirmar que `sdn.scraper.js` (222 líneas, exporta `buscarSDN`) y `neumafast.scraper.js` (140 líneas, exporta `buscarNeumafast`) son implementaciones reales específicas del sitio (no los stubs genéricos de 2 líneas como `cambiatuneumatico.scraper.js`/`fullneumaticos.scraper.js`/`llantasdelpacifico.scraper.js`) — ya confirmado en la exploración previa, pero releer los archivos antes de tocar nada.

- [ ] **Paso 2: Registrar ambos en `index.js`**

Agregar los imports y entradas al array `scrapers`:

```js
import { buscarSDN } from "./sdn.scraper.js";
import { buscarNeumafast } from "./neumafast.scraper.js";
```

```js
const scrapers = [
  { nombre: "AZedan", fn: buscarAZedan },
  { nombre: "Neumacenter", fn: buscarNeumacenter },
  { nombre: "NeumaticosK", fn: buscarNeumaticosK },
  { nombre: "Pionono", fn: buscarPionono },
  { nombre: "ChileNeumaticos", fn: buscarChileNeumaticos },
  { nombre: "SDN", fn: buscarSDN },
  { nombre: "Neumafast", fn: buscarNeumafast },
];
```

- [ ] **Paso 3: Sacar "Llantas del Pacífico" de la lista del frontend**

En `frontend/src/main.jsx`, el array `PROVEEDORES` incluye `"Llantas del Pacífico"`, que hoy no corresponde a ningún scraper registrado (su único scraper es un stub genérico de búsqueda en Google, nunca importado en `index.js`) — seleccionarlo en el frontend hoy no hace nada, silenciosamente. Sacarlo de la lista para que lo que se puede elegir coincida con lo que realmente funciona:

```js
const PROVEEDORES = [
  "AZedan",
  "Neumacenter",
  "NeumaticosK",
  "ChileNeumaticos",
  "SDN",
  "Pionono",
  "Neumafast",
];
```

No se borra el archivo `llantasdelpacifico.scraper.js` ni los otros 2 stubs — quedan como código preexistente sin conectar, no es parte de esta tarea tocarlos más que eso.

- [ ] **Paso 4: Verificar**

No hay suite de tests en este proyecto. Verificar manualmente: `cd backend && node -e "import('./scrapers/index.js').then(m => console.log(Object.keys(m)))"` corre sin error de import (confirma que `buscarSDN`/`buscarNeumafast` se resuelven bien). Revisar que `frontend/src/main.jsx` compile si hay un build de prueba disponible (`cd frontend && npm run build` si existe ese script — si no existe, basta con que no haya errores de sintaxis evidentes en una relectura).

- [ ] **Paso 5: Commit**

```bash
git add backend/scrapers/index.js frontend/src/main.jsx
git commit -m "feat(scrapers): registrar SDN y Neumafast, sacar proveedor no conectado del frontend"
```

---

## Tarea 2: Timeout por proveedor para que uno colgado no frene todo el lote

**Archivos:**
- Modificar: `backend/scrapers/index.js`

- [ ] **Paso 1: Leer el archivo actual completo primero** (ya modificado por la Tarea 1 — trabajar sobre esa versión).

- [ ] **Paso 2: Agregar un wrapper de timeout**

```js
const TIMEOUT_POR_PROVEEDOR_MS = 25000;

function conTimeout(promesa, ms, etiqueta) {
  return Promise.race([
    promesa,
    new Promise((_, reject) =>
      setTimeout(() => reject(new Error(`Timeout de ${ms}ms en ${etiqueta}`)), ms)
    ),
  ]);
}
```

Envolver la llamada a cada scraper dentro del `for` de `buscarEnTodosLosProveedores`:

```js
      const data = await conTimeout(
        scraper.fn(page, itemBusqueda),
        TIMEOUT_POR_PROVEEDOR_MS,
        scraper.nombre
      );
```

(Reemplaza la línea actual `const data = await scraper.fn(page, itemBusqueda);` — el resto del `try/catch/finally` que rodea esta línea, incluyendo el `page.close()` en `finally`, queda exactamente igual; cerrar la página sigue abortando cualquier operación de Playwright que haya quedado pendiente tras el timeout.)

- [ ] **Paso 3: Verificar**

Relectura del archivo completo — confirmar que el `try/catch/finally` existente no se alteró, solo la línea del `await`.

- [ ] **Paso 4: Commit**

```bash
git add backend/scrapers/index.js
git commit -m "fix(scrapers): agregar timeout por proveedor para no bloquear todo el lote"
```

---

## Tarea 3: API de jobs con paralelismo y persistencia incremental

**Archivos:**
- Modificar: `backend/server.js`
- Modificar: `package.json` (raíz — agregar `p-limit`; confirmado que el backend corre con los `node_modules` de la raíz, no los de `backend/`, ya que `motorBusquedaIA.js` importa `openai`, que solo existe en el `package.json` raíz)

- [ ] **Paso 1: Leer `backend/server.js` completo primero**

Confirmar la forma exacta actual del único endpoint (`POST /api/neumaticos/lote`), el `for` secuencial sobre `medidas`, y cómo arma cada fila de `resultadosFinales`.

- [ ] **Paso 2: Instalar `p-limit` en la raíz**

```bash
npm install p-limit
```

(Se instala en la raíz del proyecto — `C:\Users\luisv\Downloads\PoC\comparador-neumaticos\comparador-neumaticos` — no dentro de `backend/`.)

- [ ] **Paso 3: Reescribir `backend/server.js`**

Reemplazar el archivo completo por:

```js
import "dotenv/config";
import {
  interpretarBusquedaIA,
  deduplicarResultados,
  elegirMejorPrecio,
} from "./motorBusquedaIA.js";
import express from "express";
import cors from "cors";
import { randomUUID } from "crypto";
import fs from "fs/promises";
import path from "path";
import { fileURLToPath } from "url";
import { chromium } from "playwright";
import pLimit from "p-limit";
import { buscarEnTodosLosProveedores } from "./scrapers/index.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const JOBS_DIR = path.join(__dirname, "jobs");

const app = express();

app.use(cors());
app.use(express.json({ limit: "10mb" }));

const CONCURRENCIA_MEDIDAS = Number(process.env.CONCURRENCIA_MEDIDAS || 3);

async function guardarEstadoJob(jobId, estado) {
  await fs.mkdir(JOBS_DIR, { recursive: true });
  await fs.writeFile(
    path.join(JOBS_DIR, `${jobId}.json`),
    JSON.stringify(estado, null, 2)
  );
}

async function procesarMedida(browser, textoExcel, { proveedores, fabricante }) {
  console.log("Texto recibido desde Excel:", textoExcel);

  const busquedaIA = await interpretarBusquedaIA(textoExcel);

  console.log("Búsqueda interpretada:", busquedaIA);

  if (!busquedaIA.medida) {
    return {
      medida: textoExcel,
      busquedaIA,
      totalResultados: 0,
      mejorPrecio: null,
      resultados: [],
    };
  }

  const itemBusquedaFinal = {
    ...busquedaIA,
    fabricanteFiltroManual: fabricante || "",
  };

  if (fabricante) {
    itemBusquedaFinal.fabricante = fabricante;
    itemBusquedaFinal.busqueda = `${busquedaIA.medida} ${fabricante}`;
  }

  const resultados = await buscarEnTodosLosProveedores(browser, itemBusquedaFinal, {
    proveedores,
  });

  const resultadosLimpios = deduplicarResultados(resultados);
  const mejorPrecio = elegirMejorPrecio(resultadosLimpios);

  return {
    medida: busquedaIA.medida,
    descripcionOriginal: textoExcel,
    busquedaIA,
    totalResultados: resultadosLimpios.length,
    mejorPrecio,
    resultados: resultadosLimpios,
  };
}

app.post("/api/neumaticos/lote", async (req, res) => {
  const { medidas, proveedores = [], fabricante = "" } = req.body;

  if (!Array.isArray(medidas) || medidas.length === 0) {
    return res.status(400).json({
      error: "Debes enviar un arreglo de medidas",
    });
  }

  const jobId = randomUUID();

  const estado = {
    jobId,
    estado: "en_progreso",
    total: medidas.length,
    procesados: 0,
    resultados: [],
    error: null,
  };

  await guardarEstadoJob(jobId, estado);

  res.status(202).json({ jobId, total: medidas.length });

  (async () => {
    let browser;

    try {
      browser = await chromium.launch({ headless: true });

      const limite = pLimit(CONCURRENCIA_MEDIDAS);

      const tareas = medidas.map((textoExcel, index) =>
        limite(async () => {
          let resultado;
          try {
            resultado = await procesarMedida(browser, textoExcel, { proveedores, fabricante });
          } catch (error) {
            console.error(`Error procesando medida "${textoExcel}":`, error.message);
            resultado = {
              medida: textoExcel,
              busquedaIA: null,
              totalResultados: 0,
              mejorPrecio: null,
              resultados: [],
              error: error.message,
            };
          }

          estado.resultados[index] = resultado;
          estado.procesados += 1;
          await guardarEstadoJob(jobId, estado);
        })
      );

      await Promise.all(tareas);

      estado.estado = "completado";
      await guardarEstadoJob(jobId, estado);
    } catch (error) {
      estado.estado = "error";
      estado.error = error.message;
      await guardarEstadoJob(jobId, estado);
    } finally {
      if (browser) await browser.close();
    }
  })();
});

app.get("/api/neumaticos/lote/:jobId", async (req, res) => {
  try {
    const contenido = await fs.readFile(
      path.join(JOBS_DIR, `${req.params.jobId}.json`),
      "utf-8"
    );
    res.json(JSON.parse(contenido));
  } catch (error) {
    res.status(404).json({ error: "Job no encontrado" });
  }
});

app.listen(3001, () => {
  console.log("Servidor backend corriendo en http://localhost:3001");
});
```

Notas para quien implemente:
- El `POST` ya NO espera a que termine el lote — responde `202` con `{jobId, total}` apenas crea el job, y el procesamiento real corre en una función async autoejecutada (`(async () => {...})()`) sin que el handler la espere (`await`). Esto es intencional: el cliente HTTP original (el `fetch` del frontend) ya no se queda colgado esperando.
- `estado` es un único objeto en memoria compartido por todas las tareas en paralelo (closure). Cada tarea, al terminar, escribe su resultado en `estado.resultados[index]` (por índice, no con `push`, para que el orden final coincida con el orden original de `medidas` aunque terminen en otro orden por el paralelismo) y llama a `guardarEstadoJob` para persistir a disco. Es aceptable que dos escrituras a disco se puedan solapar en el tiempo (no hay lock) — cada una igual serializa el estado acumulado hasta ese momento, así que en el peor caso una escritura ligeramente más vieja pisa a una más nueva por una fracción de segundo, pero la siguiente escritura (siempre llega una más) corrige el número. No hace falta más que esto para esta escala.
- `backend/jobs/` se crea sola la primera vez (`fs.mkdir(..., {recursive:true})`). Agregar `backend/jobs/` al `.gitignore` del proyecto si no está ya cubierto por un patrón existente (revisar `backend/.gitignore` o el de la raíz).
- Si el proceso del servidor se cae a mitad de un job, lo ya procesado queda en el archivo `.json` en disco (no se pierde), pero el job no se "reanuda" solo al reiniciar el servidor — eso es una mejora de alcance mayor (cola de trabajos real), explícitamente fuera de esta ronda.

- [ ] **Paso 4: Revisar `.gitignore`**

Correr `cat backend/.gitignore .gitignore 2>/dev/null` (o el equivalente) y, si `backend/jobs/` o `jobs/` no están ya cubiertos por un patrón como `node_modules` únicamente, agregar una línea `backend/jobs/` a `.gitignore` para no versionar los resultados de cada corrida.

- [ ] **Paso 5: Verificar**

No hay tests automatizados en este proyecto. Verificación manual: confirmar que `node -e "import('./backend/server.js')"` (ejecutado desde la raíz) no tira error de sintaxis/import al cargar el módulo (ojo: esto también intenta levantar el servidor en el puerto 3001 — si ya hay uno corriendo, fallará por el puerto ocupado, lo cual en sí mismo confirma que el archivo se parseó e intentó arrancar correctamente; si no hay nada corriendo, dejarlo arrancado un par de segundos y después matarlo). Si es posible correr el servidor real y hacer una prueba end-to-end con 2-3 medidas reales contra 1 proveedor rápido, mejor — reportar si se hizo o no.

- [ ] **Paso 6: Commit**

```bash
git add backend/server.js package.json package-lock.json
git commit -m "feat(api): convertir /lote en job asincrónico con paralelismo y persistencia incremental"
```

(Agregar también `.gitignore` al commit si se modificó en el Paso 4.)

---

## Tarea 4: Frontend — consumir el nuevo flujo de jobs con barra de progreso

**Archivos:**
- Modificar: `frontend/src/main.jsx`

- [ ] **Paso 1: Leer el archivo completo primero** (ya modificado por la Tarea 1 — trabajar sobre esa versión).

- [ ] **Paso 2: Agregar estado de progreso**

Agregar, junto a los demás `useState`:

```js
  const [progreso, setProgreso] = useState({ procesados: 0, total: 0 });
```

- [ ] **Paso 3: Reemplazar `buscarMedidasExcel` para crear el job y arrancar el polling**

```js
  const buscarMedidasExcel = async () => {
    if (medidas.length === 0) {
      alert("Primero debes cargar un archivo Excel con medidas.");
      return;
    }

    try {
      const proveedoresSeleccionados = [proveedor1, proveedor2].filter(Boolean);

      if (proveedor1 && proveedor2 && proveedor1 === proveedor2) {
        alert("Proveedor 1 y Proveedor 2 no pueden ser iguales.");
        return;
      }

      setCargando(true);
      setResultados([]);
      setProgreso({ procesados: 0, total: medidas.length });

      const response = await fetch("http://localhost:3001/api/neumaticos/lote", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          medidas,
          proveedores: proveedoresSeleccionados,
          fabricante: fabricanteFiltro,
        }),
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.detalle || data.error || "Error al iniciar la búsqueda");
      }

      await esperarJob(data.jobId);
    } catch (error) {
      alert(error.message);
      setCargando(false);
    }
  };

  const esperarJob = (jobId) => {
    return new Promise((resolve) => {
      const intervalo = setInterval(async () => {
        try {
          const response = await fetch(`http://localhost:3001/api/neumaticos/lote/${jobId}`);
          const estado = await response.json();

          setProgreso({ procesados: estado.procesados, total: estado.total });
          setResultados((estado.resultados || []).filter(Boolean));

          if (estado.estado === "completado" || estado.estado === "error") {
            clearInterval(intervalo);
            setCargando(false);
            if (estado.estado === "error") {
              alert(estado.error || "Error durante la búsqueda");
            }
            resolve();
          }
        } catch (error) {
          clearInterval(intervalo);
          setCargando(false);
          alert("Se perdió la conexión con el servidor durante la búsqueda.");
          resolve();
        }
      }, 2000);
    });
  };
```

(`estado.resultados` puede venir con huecos — posiciones `undefined` para medidas que aún no terminaron, porque se van llenando por índice a medida que cada tarea en paralelo completa, no en orden estricto. El `.filter(Boolean)` descarta esos huecos antes de guardarlos en `resultados`, así la tabla de resultados en pantalla solo muestra medidas ya procesadas.)

- [ ] **Paso 4: Mostrar el progreso en la UI**

Reemplazar el bloque actual:

```jsx
          {cargando && (
  <div className="processing-box">
    Analizando proveedores, comparando precios y buscando mejores ofertas...
  </div>
)}
```

por:

```jsx
          {cargando && (
  <div className="processing-box">
    Analizando proveedores, comparando precios y buscando mejores ofertas...
    {progreso.total > 0 && (
      <div style={{ marginTop: "8px" }}>
        {progreso.procesados} de {progreso.total} medidas procesadas
      </div>
    )}
  </div>
)}
```

- [ ] **Paso 5: Verificar**

Relectura completa del archivo. Confirmar que `exportarExcel` sigue funcionando igual (lee de `resultados`, que ahora se va completando de a poco en vez de todo junto al final, pero la forma de cada elemento del array es idéntica a antes — no debería requerir ningún cambio en `exportarExcel`). Si hay forma de correr el frontend (`npm run dev` en `frontend/`) y probar con el backend ya actualizado (Tarea 3), hacerlo con un Excel chico (3-5 medidas) para confirmar visualmente que la barra de progreso avanza y los resultados aparecen de a poco. Reportar si se hizo la prueba end-to-end o no.

- [ ] **Paso 6: Commit**

```bash
git add frontend/src/main.jsx
git commit -m "feat(frontend): consumir la API de jobs con barra de progreso en vez de esperar una respuesta unica"
```

---

## Tarea 5: Alinear la versión de Playwright en `backend/package.json`

**Archivos:**
- Modificar: `backend/package.json`

- [ ] **Paso 1: Confirmar el desajuste**

`backend/package.json` tiene `"playwright": "^1.49.1"`, mientras que el `package.json` raíz (el que en la práctica se usa para correr el backend, ya que `motorBusquedaIA.js` importa `openai`, que solo está en el `package.json` raíz) tiene `"playwright": "^1.54.2"`. Este archivo (`backend/package.json`) parece vestigial/no ser el que realmente se instala para correr el servidor, pero mantenerlo desalineado es una fuente de confusión futura si alguien alguna vez corre `npm install` dentro de `backend/` esperando que funcione de forma independiente.

- [ ] **Paso 2: Alinear la versión**

Cambiar en `backend/package.json`:
```diff
-    "playwright": "^1.49.1"
+    "playwright": "^1.54.2"
```

- [ ] **Paso 3: Verificar**

No hace falta reinstalar nada (este `package.json` no es el que se usa en la práctica) — solo confirmar que el archivo sigue siendo JSON válido tras el cambio.

- [ ] **Paso 4: Commit**

```bash
git add backend/package.json
git commit -m "chore(backend): alinear version de playwright con el package.json raiz"
```

---

## Notas de autorrevisión

- **Cobertura:** las 8 mejoras identificadas en la revisión original se agrupan así: paralelismo + persistencia + API de jobs → Tarea 3; timeout por proveedor → Tarea 2; scrapers placeholder/sin conectar → Tarea 1; esperas fijas → explícitamente fuera de alcance (ver nota al inicio); versión de Playwright → Tarea 5; barra de progreso en frontend → Tarea 4.
- **Orden importa:** Tarea 1 antes que Tarea 2 (ambas tocan `index.js`, aplicar en ese orden evita conflictos). Tarea 3 antes que Tarea 4 (el frontend depende del endpoint `GET /lote/:jobId` que crea la Tarea 3).
- **Sin romper lo que ya funciona:** ningún scraper individual (`azedan.scraper.js`, `neumaticosk.scraper.js`, etc.) se modifica en este plan — toda la mejora es en la capa de orquestación (`index.js`, `server.js`) y el frontend.
