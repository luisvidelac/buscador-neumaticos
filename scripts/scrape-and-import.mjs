import "dotenv/config";
import { chromium } from "playwright";
import pLimit from "p-limit";
import { createClient } from "@supabase/supabase-js";
import { buscarEnTodosLosProveedores } from "../backend/scrapers/index.js";
import { mejorOfertaPorProveedorYMarca } from "./ofertas.mjs";

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const CONCURRENCIA = Number(process.env.CONCURRENCIA_MEDIDAS || 3);

if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
  console.error("Faltan las variables de entorno SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY");
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

const { data: products, error: productsError } = await supabase.from("products").select("*").eq("activo", true);
if (productsError) {
  console.error("Error cargando productos:", productsError.message);
  process.exit(1);
}

const { data: providers, error: providersError } = await supabase.from("providers").select("*").eq("activo", true);
if (providersError) {
  console.error("Error cargando proveedores:", providersError.message);
  process.exit(1);
}

const productsByMedidaNormalizada = new Map();
for (const p of products) {
  if (!p.medida_normalizada) continue;
  const lista = productsByMedidaNormalizada.get(p.medida_normalizada) ?? [];
  lista.push(p);
  productsByMedidaNormalizada.set(p.medida_normalizada, lista);
}
const providerByNombreNormalizado = new Map(providers.map((p) => [p.nombre_normalizado, p]));

const medidasUnicas = new Map();
for (const p of products) {
  if (!p.medida_normalizada || medidasUnicas.has(p.medida_normalizada)) continue;
  medidasUnicas.set(p.medida_normalizada, p.medida);
}

console.log(`Escaneando ${medidasUnicas.size} medidas únicas contra todos los proveedores...`);

const browser = await chromium.launch({ headless: true });
const limite = pLimit(CONCURRENCIA);

let insertados = 0;
let errores = 0;
let proveedoresCreados = 0;
let productosCreados = 0;

const tareas = Array.from(medidasUnicas.entries()).map(([medidaNormalizada, medidaTexto]) =>
  limite(async () => {
    let resultados;
    try {
      resultados = await buscarEnTodosLosProveedores(browser, { medida: medidaTexto, fabricante: "" }, {});
    } catch (error) {
      console.error(`Error escaneando ${medidaTexto}:`, error.message);
      errores += 1;
      return;
    }

    for (const oferta of mejorOfertaPorProveedorYMarca(resultados)) {
      const proveedorKey = oferta.proveedorKey;
      let provider = providerByNombreNormalizado.get(proveedorKey);
      if (!provider) {
        const { data, error } = await supabase
          .from("providers")
          .upsert(
            { nombre: oferta.proveedorNombre, nombre_normalizado: proveedorKey, categoria: "Otro", tipo_integracion: "Web autorizada" },
            { onConflict: "nombre_normalizado" }
          )
          .select()
          .single();
        if (error) {
          console.error("Error creando proveedor", oferta.proveedorNombre, error.message);
          errores += 1;
          continue;
        }
        provider = data;
        providerByNombreNormalizado.set(proveedorKey, provider);
        proveedoresCreados += 1;
      }

      let productos = productsByMedidaNormalizada.get(medidaNormalizada) ?? [];
      if (productos.length === 0) {
        const { data, error } = await supabase
          .from("products")
          .upsert(
            {
              external_id: `MED-${medidaNormalizada}`,
              description_original: medidaTexto,
              medida: medidaTexto,
              medida_normalizada: medidaNormalizada,
              marca: "Sin marca",
              modelo: "Genérico",
              precio_azedan: 0,
              precio_pendiente: true,
              requiere_revision: false,
              archivo_origen: "github-actions-scrape-diario",
              fecha_importacion: new Date().toISOString(),
            },
            { onConflict: "external_id" }
          )
          .select()
          .single();
        if (error) {
          console.error("Error creando producto", medidaTexto, error.message);
          errores += 1;
          continue;
        }
        productos = [data];
        productsByMedidaNormalizada.set(medidaNormalizada, productos);
        productosCreados += 1;
      }

      // Si varios productos comparten la misma medida, la oferta se adjunta a
      // todos -- no solo al primero que aparecio en la consulta a Supabase.
      for (const product of productos) {
        const { error: insertError } = await supabase.from("competitor_prices").insert({
          producto_id: product.id,
          proveedor_id: provider.id,
          medida_encontrada: oferta.medida || medidaTexto,
          medida_normalizada: medidaNormalizada,
          marca_encontrada: oferta.marcaDetectada || oferta.marca || null,
          modelo_encontrado: oferta.modelo || null,
          descripcion_encontrada: oferta.producto || null,
          precio_normal: oferta.precioNormal || null,
          precio_oferta: oferta.precioOferta || null,
          precio_utilizado: oferta.precio,
          disponibilidad: "No confirmado",
          url_producto: oferta.url || null,
          fuente: oferta.proveedorNombre,
          nivel_coincidencia: "alta",
          porcentaje_coincidencia: 75,
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
    }
  })
);

await Promise.all(tareas);
await browser.close();

console.log("=== RESUMEN ===");
console.log("Medidas escaneadas:", medidasUnicas.size);
console.log("Precios insertados:", insertados);
console.log("Proveedores nuevos:", proveedoresCreados);
console.log("Productos nuevos:", productosCreados);
console.log("Errores:", errores);
