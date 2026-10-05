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

// Solo el frontend local; con cors() abierto cualquier sitio que el usuario
// visite podria disparar trabajos de Playwright contra este servidor.
app.use(cors({ origin: /^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/ }));
app.use(express.json({ limit: "1mb" }));

const CONCURRENCIA_MEDIDAS = Number(process.env.CONCURRENCIA_MEDIDAS || 3);
const MAX_MEDIDAS_POR_LOTE = 500;
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

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

  if (medidas.length > MAX_MEDIDAS_POR_LOTE) {
    return res.status(400).json({
      error: `Máximo ${MAX_MEDIDAS_POR_LOTE} medidas por lote`,
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
  // Express decodifica %2F en params: sin esto "..%2F..%2Fpackage" lee
  // cualquier .json fuera de JOBS_DIR.
  if (!UUID_PATTERN.test(req.params.jobId)) {
    return res.status(404).json({ error: "Job no encontrado" });
  }

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

app.listen(3001, "127.0.0.1", () => {
  console.log("Servidor backend corriendo en http://localhost:3001");
});
