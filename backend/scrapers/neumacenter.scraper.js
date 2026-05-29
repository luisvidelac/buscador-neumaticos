export async function buscarNeumacenter(page, itemBusqueda) {
  const proveedor = "Neumacenter";

  const medida =
    typeof itemBusqueda === "string" ? itemBusqueda : itemBusqueda.medida;

  const fabricante =
  typeof itemBusqueda === "string"
    ? ""
    : itemBusqueda.fabricanteFiltroManual ||
      itemBusqueda.fabricante ||
      "";

  const busqueda = medida;

  const normalizar = (txt = "") =>
    String(txt).toUpperCase().replace(/\s+/g, "").replace(/-/g, "/");

  const medidaNormalizada = normalizar(medida);
  const fabricanteNormalizado = normalizar(fabricante);

  const resultadosGlobales = [];
  const urlsVisitadas = new Set();

  await page.goto("https://www.neumacenter.cl/", {
    waitUntil: "domcontentloaded",
    timeout: 60000,
  });

  await page.waitForTimeout(3000);

  await page.fill('input[type="search"]', busqueda);
  await page.keyboard.press("Enter");

  await page.waitForTimeout(5000);

  for (let pagina = 1; pagina <= 5; pagina++) {
    console.log(`Neumacenter leyendo página ${pagina}`);

    const productosPagina = await page.evaluate(
      ({ proveedor, medida, medidaNormalizada, fabricanteNormalizado }) => {
        const normalizar = (txt = "") =>
          String(txt).toUpperCase().replace(/\s+/g, "").replace(/-/g, "/");

        const cards = Array.from(
          document.querySelectorAll(
            ".product-small, .product, li.product, .product-type-simple"
          )
        );

        return cards
          .map((card) => {
            const producto =
              card.querySelector(".name.product-title")?.innerText?.trim() ||
              card.querySelector(".woocommerce-loop-product__title")?.innerText?.trim() ||
              card.querySelector("h2")?.innerText?.trim() ||
              "";

            const productoNormalizado = normalizar(producto);

            if (!productoNormalizado.includes(medidaNormalizada)) return null;

            if (
              fabricanteNormalizado &&
              !productoNormalizado.includes(fabricanteNormalizado)
            ) {
              return null;
            }

            const precioNormalTexto =
              card.querySelector("del .woocommerce-Price-amount")?.innerText?.trim() ||
              "";

            const precioOfertaTexto =
              card.querySelector("ins .woocommerce-Price-amount")?.innerText?.trim() ||
              card.querySelector(".price .woocommerce-Price-amount")?.innerText?.trim() ||
              card.querySelector(".woocommerce-Price-amount")?.innerText?.trim() ||
              "";

            const precioNormal = Number(precioNormalTexto.replace(/[^\d]/g, ""));
            const precioOferta = Number(precioOfertaTexto.replace(/[^\d]/g, ""));
            const precio = precioOferta || precioNormal;

            if (!producto || !precio) return null;

            const url = card.querySelector("a")?.href || window.location.href;

            const partes = producto.split(" ");

            return {
              proveedor,
              medida,
              marca: partes[0] || "",
              modelo: partes.slice(1).join(" "),
              producto,
              precioNormalTexto,
              precioOfertaTexto,
              precioNormal,
              precioOferta,
              precio,
              url,
            };
          })
          .filter(Boolean);
      },
      { proveedor, medida, medidaNormalizada, fabricanteNormalizado }
    );

    for (const item of productosPagina) {
      const clave = item.url || `${item.producto}-${item.precio}`;

      if (!urlsVisitadas.has(clave)) {
        urlsVisitadas.add(clave);
        resultadosGlobales.push(item);
      }
    }

    const siguiente = page.locator(
      'a.next, .next.page-number, a:has-text("Siguiente"), a:has-text("→")'
    );

    if ((await siguiente.count()) === 0) break;

    try {
      await siguiente.first().click();
      await page.waitForTimeout(5000);
    } catch {
      break;
    }
  }

  console.log("Neumacenter total productos:", resultadosGlobales.length);

  return resultadosGlobales;
}