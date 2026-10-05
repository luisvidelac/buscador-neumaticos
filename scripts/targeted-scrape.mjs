import "dotenv/config";
import { chromium } from "playwright";
import { createClient } from "@supabase/supabase-js";
import { buscarEnTodosLosProveedores } from "../backend/scrapers/index.js";

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const PROVIDER = process.env.TARGETED_PROVIDER;
const ITEMS_RAW = process.env.TARGETED_ITEMS;

if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
  console.error("Faltan las variables de entorno SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY");
  process.exit(1);
}

if (!PROVIDER || !ITEMS_RAW) {
  console.error("Faltan TARGETED_PROVIDER / TARGETED_ITEMS");
  process.exit(1);
}

let items;
try {
  items = JSON.parse(ITEMS_RAW);
} catch (e) {
  console.error("TARGETED_ITEMS no es JSON valido:", e.message);
  process.exit(1);
}

if (!Array.isArray(items) || items.length === 0) {
  console.error("TARGETED_ITEMS debe ser un array con al menos un item");
  process.exit(1);
}

// Misma logica que src/domain/normalizeMeasure.ts del PoC
const MEASURE_PATTERN = /^(\d{2,3})\s*[/\s]\s*(\d{2,3})\s*[Rr]\s*(\d{1,2}(?:\.\d)?)$/;
function normalizeMeasure(input) {
  const trimmed = String(input).trim();
  const match = trimmed.match(MEASURE_PATTERN);
  if (!match) return null;
  const ancho = Number(match[1]);
  const perfil = Number(match[2]);
  const aro = Number(match[3]);
  if (!(ancho >= 115 && ancho <= 450)) return null;
  if (!(perfil >= 25 && perfil <= 95)) return null;
  if (!(aro >= 8 && aro <= 26 && Number.isInteger(aro * 2))) return null;
  return `${ancho}/${perfil}R${aro}`;
}

function normalizarTexto(txt) {
  return String(txt || "")
    .toUpperCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .trim();
}

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

const { data: products, error: productsError } = await supabase.from("products").select("*").eq("activo", true);
if (productsError) {
  console.error("Error cargando productos:", productsError.message);
  process.exit(1);
}

const productsByMedidaNormalizada = new Map();
for (const p of products) {
  if (!p.medida_normalizada) continue;
  const lista = productsByMedidaNormalizada.get(p.medida_normalizada) ?? [];
  lista.push(p);
  productsByMedidaNormalizada.set(p.medida_normalizada, lista);
}

const { data: providerRow, error: providerError } = await supabase
  .from("providers")
  .select("*")
  .eq("nombre", PROVIDER)
  .maybeSingle();

if (providerError || !providerRow) {
  console.error(`Proveedor "${PROVIDER}" no encontrado en providers:`, providerError?.message);
  process.exit(1);
}

console.log(`Comparacion dirigida contra ${PROVIDER}: ${items.length} item(s)`);

const browser = await chromium.launch({ headless: true });

let encontrados = 0;
let noEncontrados = 0;
let sinProducto = 0;
let errores = 0;

for (const item of items) {
  const medidaNormalizada = normalizeMeasure(item.medida);
  if (!medidaNormalizada) {
    console.log(`"${item.medida}": medida no interpretable, se omite`);
    errores += 1;
    continue;
  }

  const productos = productsByMedidaNormalizada.get(medidaNormalizada) ?? [];
  if (productos.length === 0) {
    console.log(`${medidaNormalizada}: no hay producto AZedan con esa medida en el catalogo, se omite`);
    sinProducto += 1;
    continue;
  }

  let resultados;
  try {
    resultados = await buscarEnTodosLosProveedores(browser, { medida: item.medida, fabricante: "" }, { proveedores: [PROVIDER] });
  } catch (error) {
    console.error(`Error escaneando ${item.medida} en ${PROVIDER}:`, error.message);
    errores += 1;
    continue;
  }

  const marcaBuscada = normalizarTexto(item.marca);
  const modeloBuscado = normalizarTexto(item.modelo);

  if (!marcaBuscada) {
    console.log(`${item.medida}: falta la marca a buscar, se omite`);
    errores += 1;
    continue;
  }

  // La marca que trae cada scraper suele venir vacia o mal recortada (ver
  // PLAN_MEJORAS.md / historial de fixes) -- el texto confiable es el titulo
  // completo (marca+modelo+producto concatenados), ahi SI aparece la marca
  // como texto. Buscar la marca pedida DENTRO de ese texto combinado, nunca
  // al reves: "".includes(cualquierCosa) es false, pero
  // cualquierCosa.includes("") siempre es true -- comparar en esa direccion
  // (oferta vacia "contiene" cualquier marca pedida) fue justamente el bug
  // que esto reemplaza.
  const candidatosMarca = resultados.filter((o) => {
    const precio = Number(o.precio) || 0;
    if (precio <= 0) return false;
    const textoOferta = normalizarTexto(`${o.marca || ""} ${o.modelo || ""} ${o.producto || ""}`);
    return textoOferta.includes(marcaBuscada);
  });

  if (candidatosMarca.length === 0) {
    console.log(`${item.medida} ${item.marca} ${item.modelo || ""}: NO encontrado en ${PROVIDER} (no se inventa comparacion con otra marca)`);
    noEncontrados += 1;
    continue;
  }

  const candidatosModelo = modeloBuscado
    ? candidatosMarca.filter((o) => normalizarTexto(`${o.modelo || ""} ${o.producto || ""}`).includes(modeloBuscado))
    : [];

  const nivelCoincidencia = candidatosModelo.length > 0 ? "exacta" : "alta";
  const candidatos = candidatosModelo.length > 0 ? candidatosModelo : candidatosMarca;
  const mejor = candidatos.reduce((a, b) => (Number(b.precio) < Number(a.precio) ? b : a));

  for (const product of productos) {
    const { error: insertError } = await supabase.from("competitor_prices").insert({
      producto_id: product.id,
      proveedor_id: providerRow.id,
      medida_encontrada: mejor.medida || item.medida,
      medida_normalizada: medidaNormalizada,
      marca_encontrada: mejor.marca || null,
      modelo_encontrado: mejor.modelo || null,
      precio_normal: mejor.precioNormal || null,
      precio_oferta: mejor.precioOferta || null,
      precio_utilizado: Number(mejor.precio),
      disponibilidad: "No confirmado",
      url_producto: mejor.url || null,
      fuente: `${PROVIDER} (dirigida)`,
      nivel_coincidencia: nivelCoincidencia,
      porcentaje_coincidencia: nivelCoincidencia === "exacta" ? 100 : 85,
      revision_manual: false,
      es_demo: false,
    });

    if (insertError) {
      console.error("Error insertando precio dirigido:", insertError.message);
      errores += 1;
      continue;
    }
  }

  console.log(`${item.medida} ${item.marca} ${item.modelo || ""}: encontrado en ${PROVIDER} -> $${mejor.precio} (${nivelCoincidencia}, ${mejor.marca} ${mejor.modelo || ""})`);
  encontrados += 1;
}

await browser.close();

console.log("\n=== RESUMEN BUSQUEDA DIRIGIDA ===");
console.log("Proveedor:", PROVIDER);
console.log("Items pedidos:", items.length);
console.log("Encontrados (misma marca):", encontrados);
console.log("No encontrados (esa marca no esta en ese proveedor):", noEncontrados);
console.log("Sin producto AZedan para esa medida:", sinProducto);
console.log("Errores:", errores);
