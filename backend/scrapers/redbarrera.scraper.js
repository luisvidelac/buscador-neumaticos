export async function buscarRedBarrera(page, itemBusqueda) {
  const proveedor = "RedBarrera";

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
    console.log("RedBarrera: no se pudo extraer medida:", medida);
    return [];
  }

  try {
    console.log("RedBarrera paso 1: armando URL de búsqueda", datosMedida);

    const url = `https://redbarrera.cl/?page_id=390&_sft_ancho=${datosMedida.ancho}&_sft_perfil=${datosMedida.perfil}&_sft_aro=${datosMedida.aro}`;

    await page.goto(url, {
      waitUntil: "domcontentloaded",
      timeout: 60000,
    });

    await page.waitForTimeout(4000);

    console.log("RedBarrera paso 2: resultados cargados", page.url());

    const contenedorResultados = page.locator("ul.products");

    if ((await contenedorResultados.count()) === 0) {
      console.log("RedBarrera: no encontró el contenedor de resultados (posible cambio de sitio)");
      await page.screenshot({
        path: "redbarrera-error-sin-contenedor.png",
        fullPage: true,
      });
      return [];
    }

    const listaProductos = page.locator("li.product");

    if ((await listaProductos.count()) === 0) {
      console.log("RedBarrera: 0 productos para esta medida (sin stock)");
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

        const items = Array.from(document.querySelectorAll("li.product"));
        const resultados = [];

        for (const item of items) {
          const titulo = normalizarTexto(
            item.querySelector(".woocommerce-loop-product__title")?.textContent || ""
          );
          const tituloComparable = normalizarComparacion(titulo);

          if (!tituloComparable.includes(medidaNormalizada)) continue;

          if (
            fabricanteNormalizado &&
            !tituloComparable.includes(fabricanteNormalizado)
          ) {
            continue;
          }

          const priceBox = item.querySelector(".price");
          if (!priceBox) continue;

          const insEl = priceBox.querySelector("ins .woocommerce-Price-amount");
          const delEl = priceBox.querySelector("del .woocommerce-Price-amount");
          const plainEl =
            !insEl && !delEl
              ? priceBox.querySelector(".woocommerce-Price-amount")
              : null;

          const precioOferta = insEl ? parsearPrecio(insEl) : parsearPrecio(plainEl);
          const precioNormal = delEl ? parsearPrecio(delEl) : parsearPrecio(plainEl);

          if (precioOferta <= 0 && precioNormal <= 0) continue;

          const url =
            item.querySelector("a.woocommerce-LoopProduct-link")?.href ||
            window.location.href;

          resultados.push({
            proveedor,
            medida,
            marca: "",
            modelo: titulo,
            producto: titulo,
            precioOfertaTexto: (insEl || plainEl)?.textContent.trim() || "",
            precioNormalTexto: (delEl || plainEl)?.textContent.trim() || "",
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

    console.log("RedBarrera productos reales:", productos.length);

    return productos;
  } catch (error) {
    console.error("Error RedBarrera:", error.message);

    await page
      .screenshot({
        path: "redbarrera-error-general.png",
        fullPage: true,
      })
      .catch(() => {});

    return [];
  }
}
