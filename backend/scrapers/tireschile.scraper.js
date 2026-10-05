export async function buscarTiresChile(page, itemBusqueda) {
  const proveedor = "TiresChile";

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
    console.log("TiresChile: no se pudo extraer medida:", medida);
    return [];
  }

  try {
    console.log("TiresChile paso 1: armando URL de búsqueda", datosMedida);

    const params = new URLSearchParams({
      ancho: `ancho ${datosMedida.ancho}`,
      perfil: `perfil ${datosMedida.perfil}`,
      aro: `aro ${datosMedida.aro}`,
    });

    const url = `https://www.tireschile.cl/buscar-neumaticos-nuevos?${params.toString()}`;

    await page.goto(url, {
      waitUntil: "domcontentloaded",
      timeout: 60000,
    });

    await page.waitForTimeout(3000);

    console.log("TiresChile paso 2: resultados cargados", page.url());

    const contenedorResultados = page.locator(".products-list");

    if ((await contenedorResultados.count()) === 0) {
      console.log("TiresChile: no encontró el contenedor de resultados (posible cambio de sitio)");
      await page.screenshot({
        path: "tireschile-error-sin-contenedor.png",
        fullPage: true,
      });
      return [];
    }

    const listaProductos = page.locator(".products-list .product-item");

    if ((await listaProductos.count()) === 0) {
      console.log("TiresChile: 0 productos para esta medida (sin stock)");
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

        const parsePrecio = (txt = "") =>
          Math.round(Number(String(txt).replace(/[^\d]/g, "")) || 0);

        const medidaNormalizada = normalizarComparacion(medida);
        const fabricanteNormalizado = normalizarComparacion(fabricante);

        const items = Array.from(
          document.querySelectorAll(".products-list .product-item")
        );
        const resultados = [];

        for (const item of items) {
          const titulo = normalizarTexto(
            item.querySelector(".title a")?.textContent || ""
          );
          const tituloComparable = normalizarComparacion(titulo);

          if (!titulo || !tituloComparable.includes(medidaNormalizada)) continue;

          if (
            fabricanteNormalizado &&
            !tituloComparable.includes(fabricanteNormalizado)
          ) {
            continue;
          }

          const precioOfertaTexto =
            item.querySelector(".price-current")?.textContent?.trim() || "";
          const precioNormalTexto =
            item.querySelector(".price-prev")?.textContent?.trim() || "";

          const precioOferta = parsePrecio(precioOfertaTexto);
          const precioNormal = parsePrecio(precioNormalTexto);

          if (precioOferta <= 0 && precioNormal <= 0) continue;

          const marca = normalizarTexto(
            item.querySelector(".brand")?.textContent || ""
          );

          const url =
            item.querySelector(".title a")?.href || window.location.href;

          resultados.push({
            proveedor,
            medida,
            marca,
            modelo: titulo,
            producto: titulo,
            precioOfertaTexto,
            precioNormalTexto,
            precioOferta,
            precioNormal,
            precio: precioOferta || precioNormal,
            // TiresChile publica un solo precio y es "solo pago con
            // transferencia o deposito en efectivo" (nota en ficha y listado).
            precioEfectivo: precioOferta || precioNormal,
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

    console.log("TiresChile productos reales:", productos.length);

    return productos;
  } catch (error) {
    console.error("Error TiresChile:", error.message);

    await page
      .screenshot({
        path: "tireschile-error-general.png",
        fullPage: true,
      })
      .catch(() => {});

    return [];
  }
}
