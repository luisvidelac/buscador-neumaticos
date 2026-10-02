import { buscarAZedan } from "./azedan.scraper.js";
import { buscarNeumacenter } from "./neumacenter.scraper.js";
import { buscarNeumaticosK } from "./neumaticosk.scraper.js";
import { buscarPionono } from "./pionono.scraper.js";
import { buscarChileNeumaticos } from "./chileneumaticos.scraper.js";
import { buscarSDN } from "./sdn.scraper.js";
import { buscarNeumafast } from "./neumafast.scraper.js";
import { buscarReyDelNeumatico } from "./reydelneumatico.scraper.js";
import { buscarRedBarrera } from "./redbarrera.scraper.js";
import { buscarNeumastore } from "./neumastore.scraper.js";
import { buscarNeumax } from "./neumax.scraper.js";
import { buscarVentaStore } from "./ventastore.scraper.js";
import { buscarLeon } from "./leon.scraper.js";
import { buscarTiresChile } from "./tireschile.scraper.js";

const scrapers = [
  { nombre: "AZedan", fn: buscarAZedan },
  { nombre: "Neumacenter", fn: buscarNeumacenter },
  { nombre: "NeumaticosK", fn: buscarNeumaticosK },
  { nombre: "Pionono", fn: buscarPionono },
  { nombre: "ChileNeumaticos", fn: buscarChileNeumaticos },
  { nombre: "SDN", fn: buscarSDN, timeoutMs: 40000 },
  { nombre: "Neumafast", fn: buscarNeumafast },
  { nombre: "ReyDelNeumatico", fn: buscarReyDelNeumatico },
  { nombre: "RedBarrera", fn: buscarRedBarrera },
  { nombre: "Neumastore", fn: buscarNeumastore },
  { nombre: "Neumax", fn: buscarNeumax },
  { nombre: "VentaStore", fn: buscarVentaStore },
  { nombre: "Leon", fn: buscarLeon, timeoutMs: 45000 },
  { nombre: "TiresChile", fn: buscarTiresChile },
];

const TIMEOUT_POR_PROVEEDOR_MS = 25000;

function conTimeout(promesa, ms, etiqueta) {
  return Promise.race([
    promesa,
    new Promise((_, reject) =>
      setTimeout(() => reject(new Error(`Timeout de ${ms}ms en ${etiqueta}`)), ms)
    ),
  ]);
}

export async function buscarEnTodosLosProveedores(
  browser,
  itemBusqueda,
  opciones = {}
) {
  const proveedoresSeleccionados = opciones.proveedores || [];

  const scrapersFiltrados =
    proveedoresSeleccionados.length > 0
      ? scrapers.filter((s) => proveedoresSeleccionados.includes(s.nombre))
      : scrapers;

  const resultados = [];

  for (const scraper of scrapersFiltrados) {
  const page = await browser.newPage();

  try {
    console.log(`Ejecutando: ${scraper.nombre}`);

    const data = await conTimeout(
      scraper.fn(page, itemBusqueda),
      scraper.timeoutMs || TIMEOUT_POR_PROVEEDOR_MS,
      scraper.nombre
    );

    console.log(`${scraper.nombre} resultados:`, data.length);

    resultados.push(...data);
  } catch (error) {
    console.error(`Error en ${scraper.nombre}:`, error.message);
  } finally {
    await page.close();
  }
}

  return resultados;
}