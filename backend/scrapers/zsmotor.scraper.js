export async function buscarZSMotor(page, itemBusqueda) {
  const proveedor = "ZSMotor";

  const medida =
    typeof itemBusqueda === "string" ? itemBusqueda : itemBusqueda.medida;

  const fabricante =
    typeof itemBusqueda === "string" ? "" : itemBusqueda.fabricante || "";

  const extraerMedida = (valor = "") => {
    const texto = String(valor).toUpperCase();
    const match = texto.match(/(\d{3})\/(\d{2})\s*R(\d{2})/);

    if (!match) return null;

    return {
      ancho: match[1],
      perfil: match[2],
      aro: match[3],
      medidaTexto: `${match[1]}/${match[2]} R${match[3]}`,
    };
  };

  const datosMedida = extraerMedida(medida);

  if (!datosMedida) {
    console.log("ZSMotor: no se pudo extraer medida:", medida);
    return [];
  }

  try {
    console.log("ZSMotor paso 1: armando URL de búsqueda", datosMedida);

    const url = `https://www.zsmotor.cl/neumaticos/${datosMedida.aro}/${datosMedida.ancho}/${datosMedida.perfil}?map=category-1,aro,ancho,perfil`;

    await page.goto(url, {
      waitUntil: "domcontentloaded",
      timeout: 60000,
    });

    await page.waitForTimeout(4000);

    console.log("ZSMotor paso 2: resultados cargados", page.url());

    const resultadoPagina = page.locator("[class*='searchResult']");

    if ((await resultadoPagina.count()) === 0) {
      console.log("ZSMotor: no encontró el contenedor de resultados (posible cambio de sitio)");
      await page.screenshot({
        path: "zsmotor-error-sin-contenedor.png",
        fullPage: true,
      });
      return [];
    }

    const listaProductos = page.locator(".vtex-search-result-3-x-galleryItem");

    if ((await listaProductos.count()) === 0) {
      console.log("ZSMotor: 0 productos para esta medida (sin stock)");
      return [];
    }

    const productos = await page.evaluate(
      ({ proveedor, medida, fabricante }) => {
        const normalizarTexto = (txt = "") =>
          String(txt).replace(/\s+/g, " ").trim();

        const normalizarComparacion = (txt = "") =>
          String(txt)
            .toUpperCase()
            .replace(/\s+/g, "")
            .replace(/\//g, "")
            .replace(/-/g, "");

        const medidaNormalizada = normalizarComparacion(medida);
        const fabricanteNormalizado = normalizarComparacion(fabricante);

        const parsearPrecio = (el) => {
          if (!el) return 0;
          return Number(el.textContent.replace(/[^\d]/g, "")) || 0;
        };

        const items = Array.from(
          document.querySelectorAll(".vtex-search-result-3-x-galleryItem")
        );
        const resultados = [];

        for (const item of items) {
          const titulo = normalizarTexto(
            item.querySelector(".vtex-product-summary-2-x-productNameContainer")
              ?.textContent || ""
          );

          if (!titulo) continue;

          const tituloComparable = normalizarComparacion(titulo);

          if (!tituloComparable.includes(medidaNormalizada)) continue;

          if (
            fabricanteNormalizado &&
            !tituloComparable.includes(fabricanteNormalizado)
          ) {
            continue;
          }

          const sellingEl = item.querySelector(
            ".vtex-product-price-1-x-sellingPriceValue"
          );
          const listEl = item.querySelector(
            ".vtex-product-price-1-x-listPriceValue"
          );

          const precioOferta = parsearPrecio(sellingEl);
          const precioNormal = listEl ? parsearPrecio(listEl) : precioOferta;

          if (precioOferta <= 0 && precioNormal <= 0) continue;

          const brandImg = item.querySelector(
            "[class*='productBrandLogo'] img, [class*='productBrandLogoWrapper'] img"
          );
          const marca = normalizarTexto(brandImg?.alt || "");

          const url = item.querySelector("a")?.href || window.location.href;

          resultados.push({
            proveedor,
            medida,
            marca,
            modelo: titulo,
            producto: titulo,
            precioOfertaTexto: sellingEl?.textContent.trim() || "",
            precioNormalTexto: listEl?.textContent.trim() || "",
            precioOferta,
            precioNormal,
            precio: precioOferta || precioNormal,
            url,
          });
        }

        const unicos = new Map();

        for (const item of resultados) {
          unicos.set(`${item.producto}-${item.precio}`, item);
        }

        return Array.from(unicos.values());
      },
      {
        proveedor,
        medida: datosMedida.medidaTexto,
        fabricante,
      }
    );

    console.log("ZSMotor productos reales:", productos.length);

    return productos;
  } catch (error) {
    console.error("Error ZSMotor:", error.message);

    await page
      .screenshot({
        path: "zsmotor-error-general.png",
        fullPage: true,
      })
      .catch(() => {});

    return [];
  }
}
