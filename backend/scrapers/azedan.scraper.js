// Precios de azedan.cl por medida, usando el filtro Ancho/Perfil/Aro del propio
// sitio. El buscador de texto (?s=...) devuelve productos que no tienen que ver
// con la busqueda, asi que no sirve para ubicar un neumatico puntual.
// Ojo: algunos titulos no traen la marca ("165/65 R14 79T H11 RXMOTION"), por eso
// aqui no se filtra por marca; la coincidencia la decide quien llama.

const BASE = "https://www.azedan.cl/tienda/";
const MAX_PAGINAS = 5;

function extraerMedida(texto) {
  const m = String(texto).toUpperCase().match(/(\d{2,3})\s*\/\s*(\d{2,3})\s*Z?R?\s*(\d{2}(?:\.\d)?)/);
  return m ? { ancho: m[1], perfil: m[2], aro: m[3] } : null;
}

export async function buscarAZedan(page, itemBusqueda) {
  const proveedor = "AZedan";
  const medida = typeof itemBusqueda === "string" ? itemBusqueda : itemBusqueda.medida;
  const partes = extraerMedida(medida);
  if (!partes) {
    console.log("AZedan: medida no interpretable:", medida);
    return [];
  }

  let url = `${BASE}?filtering=1&filter_width=${partes.ancho}&filter_profile=${partes.perfil}&filter_rim=${partes.aro}`;
  const productos = [];

  for (let pagina = 1; url && pagina <= MAX_PAGINAS; pagina++) {
    await page.goto(url, { waitUntil: "domcontentloaded", timeout: 60000 });
    await page.waitForSelector("#primary", { timeout: 20000 }).catch(() => {});

    const { items, siguiente } = await page.evaluate(
      ({ proveedor, medida }) => {
        const precio = (el) => Number(String(el?.textContent ?? "").replace(/[^\d]/g, "")) || 0;
        // Solo la grilla de resultados; el resto de la pagina son carruseles.
        const tarjetas = Array.from(document.querySelectorAll("#primary .products .product"));
        const items = tarjetas
          .map((card) => {
            const tituloEl = card.querySelector(".product-title a, .product-title");
            const producto = tituloEl?.textContent.replace(/\s+/g, " ").trim() ?? "";
            const oferta = precio(card.querySelector(".price ins .amount"));
            const normal = precio(card.querySelector(".price del .amount"));
            const unico = precio(card.querySelector(".price .amount"));
            const precioOferta = oferta || unico;
            return {
              proveedor,
              medida,
              marca: "",
              modelo: producto,
              producto,
              precioOferta,
              precioNormal: normal || null,
              precio: precioOferta,
              url: card.querySelector(".product-title a")?.href || window.location.href,
            };
          })
          .filter((p) => p.producto && p.precio > 0);
        const siguiente = document.querySelector(".woocommerce-pagination a.next, a.next.page-numbers")?.href ?? null;
        return { items, siguiente };
      },
      { proveedor, medida }
    );

    productos.push(...items);
    url = siguiente;
  }

  console.log("AZedan productos reales:", productos.length);
  return productos;
}

// Respaldo para productos que existen en azedan.cl pero no salen en el filtro por
// medida (les falta el atributo): buscar el titulo exacto. Si calza con un solo
// producto, el sitio redirige directo a su ficha.
export async function buscarAZedanPorTexto(page, texto) {
  const proveedor = "AZedan";
  await page.goto(`https://www.azedan.cl/?s=${encodeURIComponent(texto)}&post_type=product`, { waitUntil: "domcontentloaded", timeout: 60000 });
  await page.waitForSelector("#primary, .product_title", { timeout: 20000 }).catch(() => {});

  return page.evaluate(
    ({ proveedor, texto }) => {
      const precio = (el) => Number(String(el?.textContent ?? "").replace(/[^\d]/g, "")) || 0;
      const armar = (producto, oferta, normal, unico, url) => ({
        proveedor,
        medida: texto,
        marca: "",
        modelo: producto,
        producto,
        precioOferta: oferta || unico,
        precioNormal: normal || null,
        precio: oferta || unico,
        url,
      });

      // Ficha de producto (Elementor): titulo en el h1 y precio en su widget; los
      // otros .price de la pagina son carruseles de productos relacionados.
      const titulo = document.body.classList.contains("single-product") ? document.querySelector("h1") : null;
      if (titulo) {
        const p = document.querySelector(".elementor-widget-woocommerce-product-price");
        return [
          armar(
            titulo.textContent.replace(/\s+/g, " ").trim(),
            precio(p?.querySelector("ins .amount")),
            precio(p?.querySelector("del .amount")),
            precio(p?.querySelector(".amount")),
            window.location.href
          ),
        ].filter((x) => x.precio > 0);
      }

      return Array.from(document.querySelectorAll("#primary .products .product"))
        .map((card) =>
          armar(
            card.querySelector(".product-title")?.textContent.replace(/\s+/g, " ").trim() ?? "",
            precio(card.querySelector(".price ins .amount")),
            precio(card.querySelector(".price del .amount")),
            precio(card.querySelector(".price .amount")),
            card.querySelector(".product-title a")?.href || window.location.href
          )
        )
        .filter((x) => x.producto && x.precio > 0);
    },
    { proveedor, texto }
  );
}
