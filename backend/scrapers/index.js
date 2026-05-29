import { buscarAZedan } from "./azedan.scraper.js";
import { buscarNeumacenter } from "./neumacenter.scraper.js";
import { buscarNeumaticosK } from "./neumaticosk.scraper.js";
import { buscarPionono } from "./pionono.scraper.js";
import { buscarChileNeumaticos } from "./chileneumaticos.scraper.js";

const scrapers = [
  { nombre: "AZedan", fn: buscarAZedan },
  { nombre: "Neumacenter", fn: buscarNeumacenter },
  { nombre: "NeumaticosK", fn: buscarNeumaticosK },
  { nombre: "Pionono", fn: buscarPionono },
  { nombre: "ChileNeumaticos", fn: buscarChileNeumaticos },
];

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

    const data = await scraper.fn(page, itemBusqueda);

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