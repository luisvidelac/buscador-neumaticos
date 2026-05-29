import "dotenv/config";
import {
  interpretarBusquedaIA,
  deduplicarResultados,
  elegirMejorPrecio,
} from "./motorBusquedaIA.js";
import "dotenv/config";
import express from "express";
import cors from "cors";
import { chromium } from "playwright";
import { buscarEnTodosLosProveedores } from "./scrapers/index.js";

const app = express();

app.use(cors());
app.use(express.json({ limit: "10mb" }));

app.post("/api/neumaticos/lote", async (req, res) => {
  const { medidas, proveedores = [], fabricante = "" } = req.body;

  if (!Array.isArray(medidas) || medidas.length === 0) {
    return res.status(400).json({
      error: "Debes enviar un arreglo de medidas",
    });
  }

  let browser;

  try {
    browser = await chromium.launch({
  headless: true,
});

    const resultadosFinales = [];

    for (const textoExcel of medidas) {
      console.log("Texto recibido desde Excel:", textoExcel);

      const busquedaIA = await interpretarBusquedaIA(textoExcel);

      console.log("Búsqueda interpretada:", busquedaIA);

      if (!busquedaIA.medida) {
        resultadosFinales.push({
          medida: textoExcel,
          busquedaIA,
          totalResultados: 0,
          mejorPrecio: null,
          resultados: [],
        });

        continue;
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

      resultadosFinales.push({
        medida: busquedaIA.medida,
        descripcionOriginal: textoExcel,
        busquedaIA,
        totalResultados: resultadosLimpios.length,
        mejorPrecio,
        resultados: resultadosLimpios,
      });
    }
console.log("RESULTADOS FINALES:", JSON.stringify(resultadosFinales, null, 2));
    res.json({
      totalMedidas: medidas.length,
      resultados: resultadosFinales,
    });
  } catch (error) {
    res.status(500).json({
      error: "Error en búsqueda por lote",
      detalle: error.message,
    });
  } finally {
    if (browser) await browser.close();
  }
});

app.listen(3001, () => {
  console.log("Servidor backend corriendo en http://localhost:3001");
});
