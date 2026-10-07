import "dotenv/config";
import { chromium } from "playwright";
import pLimit from "p-limit";
import { createClient } from "@supabase/supabase-js";
import { buscarEnTodosLosProveedores } from "../backend/scrapers/index.js";
import { buscarAZedan, buscarAZedanPorTexto } from "../backend/scrapers/azedan.scraper.js";
import { marcaDelProducto, mejorOfertaParaProducto, mejorOfertaPorProveedorYMarca, puntajeModelo, detectarMarca, tokensModelo, mismaMedida, textoIncluyeMarca } from "./ofertas.mjs";

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const CONCURRENCIA = Number(process.env.CONCURRENCIA_MEDIDAS || 3);

if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
  console.error("Faltan las variables de entorno SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY");
  process.exit(1);
}

// PRODUCT_IDS (JSON) = solo esos productos (lo que se acaba de subir por Excel);
// vacio = todos los productos activos (corrida diaria).
let productIds = null;
if (process.env.PRODUCT_IDS) {
  try {
    productIds = JSON.parse(process.env.PRODUCT_IDS);
    if (!Array.isArray(productIds) || productIds.length === 0) throw new Error("debe ser un array no vacio");
  } catch (e) {
    console.error("PRODUCT_IDS invalido:", e.message);
    process.exit(1);
  }
}

// PROVIDERS (JSON) = comparar solo contra esos proveedores (combos del
// Comparador); vacio = todos.
let proveedoresElegidos = [];
if (process.env.PROVIDERS) {
  try {
    proveedoresElegidos = JSON.parse(process.env.PROVIDERS);
    if (!Array.isArray(proveedoresElegidos)) throw new Error("debe ser un array");
  } catch (e) {
    console.error("PROVIDERS invalido:", e.message);
    process.exit(1);
  }
}

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

// Con PRODUCT_IDS se escanean esos aunque esten inactivos: la busqueda por
// medida usa un producto oculto (activo=false) que no entra al cron diario.
let productsQuery = supabase.from("products").select("*");
productsQuery = productIds ? productsQuery.in("id", productIds) : productsQuery.eq("activo", true);
const { data: products, error: productsError } = await productsQuery;
if (productsError) {
  console.error("Error cargando productos:", productsError.message);
  process.exit(1);
}

const { data: providers, error: providersError } = await supabase.from("providers").select("*").eq("activo", true);
if (providersError) {
  console.error("Error cargando proveedores:", providersError.message);
  process.exit(1);
}
const providerByNombreNormalizado = new Map(providers.map((p) => [p.nombre_normalizado, p]));

const productsByMedida = new Map();
for (const p of products) {
  if (!p.medida_normalizada) continue;
  const lista = productsByMedida.get(p.medida_normalizada) ?? [];
  lista.push(p);
  productsByMedida.set(p.medida_normalizada, lista);
}

console.log(
  `Escaneando ${products.length} producto(s) en ${productsByMedida.size} medida(s) contra ${
    proveedoresElegidos.length ? proveedoresElegidos.join(", ") : "todos los proveedores"
  }...`
);

const browser = await chromium.launch({ headless: true });
const limite = pLimit(CONCURRENCIA);

let insertados = 0;
let preciosAzedan = 0;
let errores = 0;

async function obtenerProveedor(oferta) {
  let provider = providerByNombreNormalizado.get(oferta.proveedorKey);
  if (provider) return provider;
  const { data, error } = await supabase
    .from("providers")
    .upsert(
      { nombre: oferta.proveedorNombre, nombre_normalizado: oferta.proveedorKey, categoria: "Otro", tipo_integracion: "Web autorizada" },
      { onConflict: "nombre_normalizado" }
    )
    .select()
    .single();
  if (error) {
    console.error("Error creando proveedor", oferta.proveedorNombre, error.message);
    errores += 1;
    return null;
  }
  providerByNombreNormalizado.set(oferta.proveedorKey, data);
  return data;
}

// Producto sin marca (busqueda por medida): un precio AZedan por cada marca que
// tenga azedan.cl en esa medida, el mas barato de cada una.
async function guardarPreciosAzedanPorMarca(product) {
  const page = await browser.newPage();
  try {
    const resultados = await buscarAZedan(page, { medida: product.medida, fabricante: "" });
    const porMarca = new Map();
    for (const o of resultados) {
      const precio = Number(o.precio) || 0;
      if (precio <= 0) continue;
      // En azedan.cl la marca siempre va al final del titulo ("... H/T KUSTONE").
      const ultimaPalabra = String(o.producto || "").trim().split(/\s+/).pop()?.toUpperCase();
      const marca = detectarMarca(o) ?? (ultimaPalabra && /^[A-Z]{3,}$/.test(ultimaPalabra) ? ultimaPalabra : "OTRA");
      const actual = porMarca.get(marca);
      if (!actual || precio < actual.precio) porMarca.set(marca, { ...o, precio, marca });
    }
    for (const o of porMarca.values()) {
      const { error } = await supabase.from("azedan_prices").insert({
        producto_id: product.id,
        precio_normal: Number(o.precioNormal) || null,
        precio_oferta: o.precio,
        url: o.url || null,
        marca: o.marca,
        descripcion: o.producto || null,
      });
      if (error) throw error;
      preciosAzedan += 1;
    }
    console.log(`  AZedan: ${porMarca.size} marca(s) en azedan.cl para ${product.medida}`);
  } catch (error) {
    console.error(`  Error precios AZedan ${product.medida}:`, error.message);
    errores += 1;
  } finally {
    await page.close();
  }
}

// El neumatico de azedan.cl que corresponde al producto: misma medida, nunca
// de otra marca reconocida, y con al menos la mitad del modelo en el titulo.
// Algunos titulos de azedan.cl no traen la marca ("H11 RXMOTION"), por eso la
// marca no es obligatoria si el modelo coincide.
function elegirAzedan(resultados, product, marca) {
  const conModelo = tokensModelo(product.modelo).length > 0;
  return resultados
    .filter((o) => Number(o.precio) > 0 && mismaMedida(o, product.medida_normalizada))
    .filter((o) => {
      const otra = detectarMarca(o);
      return !marca || !otra || otra === marca || textoIncluyeMarca(o, marca);
    })
    .map((o) => ({ ...o, puntaje: puntajeModelo(o, product.modelo), marcaOk: Boolean(marca && textoIncluyeMarca(o, marca)) }))
    .filter((o) => (conModelo ? o.puntaje >= 0.5 : o.marcaOk))
    .sort((a, b) => b.puntaje - a.puntaje || Number(b.marcaOk) - Number(a.marcaOk) || a.precio - b.precio)[0];
}

async function actualizarPrecioAzedan(product, marca) {
  if (!product.activo) return guardarPreciosAzedanPorMarca(product);
  const page = await browser.newPage();
  try {
    let mejor = elegirAzedan(await buscarAZedan(page, { medida: product.medida }), product, marca);
    // Respaldo: productos que existen pero no salen en el filtro por medida.
    if (!mejor) mejor = elegirAzedan(await buscarAZedanPorTexto(page, product.description_original), product, marca);
    if (!mejor) {
      console.log(`  AZedan: no esta en azedan.cl -> ${product.description_original}`);
      return;
    }

    const precioNormal = Number(mejor.precioNormal) || null;
    const { error: updateError } = await supabase
      .from("products")
      .update({
        precio_azedan: mejor.precio,
        precio_azedan_normal: precioNormal,
        url_azedan: mejor.url || null,
        precio_pendiente: false,
        updated_at: new Date().toISOString(),
      })
      .eq("id", product.id);
    if (updateError) throw updateError;

    const { error: historyError } = await supabase.from("azedan_prices").insert({
      producto_id: product.id,
      precio_normal: precioNormal,
      precio_oferta: mejor.precio,
      url: mejor.url || null,
    });
    if (historyError) throw historyError;

    preciosAzedan += 1;
    console.log(`  AZedan: $${mejor.precio} (normal $${precioNormal ?? "-"}) ${mejor.producto}`);
  } catch (error) {
    console.error(`  Error precio AZedan ${product.description_original}:`, error.message);
    errores += 1;
  } finally {
    await page.close();
  }
}

const tareas = Array.from(productsByMedida.entries()).map(([medidaNormalizada, productosMedida]) =>
  limite(async () => {
    let resultados;
    try {
      resultados = await buscarEnTodosLosProveedores(
        browser,
        { medida: productosMedida[0].medida, fabricante: "" },
        { proveedores: proveedoresElegidos }
      );
    } catch (error) {
      console.error(`Error escaneando ${medidaNormalizada}:`, error.message);
      errores += 1;
      return;
    }

    for (const product of productosMedida) {
      const marca = marcaDelProducto(product.marca);
      // Con marca conocida: solo ofertas de esa marca (la que mas se parece al
      // modelo por proveedor). Sin marca: la mas barata por proveedor+marca.
      const ofertas = marca ? mejorOfertaParaProducto(resultados, marca, product.modelo) : mejorOfertaPorProveedorYMarca(resultados);
      console.log(`${product.description_original}: ${ofertas.length} oferta(s) de competencia`);

      for (const oferta of ofertas) {
        const provider = await obtenerProveedor(oferta);
        if (!provider) continue;

        const exacta = marca && oferta.puntaje >= 0.5;
        const { error: insertError } = await supabase.from("competitor_prices").insert({
          producto_id: product.id,
          proveedor_id: provider.id,
          medida_encontrada: oferta.medida || product.medida,
          medida_normalizada: medidaNormalizada,
          // Si no se reconoce, la marca que trae el scraper sirve salvo que sea
          // basura tipo indice de carga ("91V").
          marca_encontrada: oferta.marcaDetectada || (oferta.marca && !/^\d/.test(oferta.marca.trim()) ? oferta.marca : null),
          modelo_encontrado: oferta.modelo || null,
          descripcion_encontrada: oferta.producto || null,
          precio_normal: oferta.precioNormal || null,
          precio_oferta: oferta.precioOferta || null,
          precio_efectivo: oferta.precioEfectivo || null,
          precio_utilizado: oferta.precio,
          disponibilidad: "No confirmado",
          url_producto: oferta.url || null,
          fuente: oferta.proveedorNombre,
          nivel_coincidencia: exacta ? "exacta" : "alta",
          porcentaje_coincidencia: exacta ? 100 : 75,
          revision_manual: false,
          es_demo: false,
        });

        if (insertError) {
          console.error("Error insertando precio", insertError.message);
          errores += 1;
          continue;
        }
        insertados += 1;
      }

      await actualizarPrecioAzedan(product, marca);
    }
  })
);

await Promise.all(tareas);
await browser.close();

console.log("=== RESUMEN ===");
console.log("Productos escaneados:", products.length);
console.log("Precios de competencia insertados:", insertados);
console.log("Precios AZedan actualizados:", preciosAzedan);
console.log("Errores:", errores);
