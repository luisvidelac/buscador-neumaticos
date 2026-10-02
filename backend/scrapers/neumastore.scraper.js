export async function buscarNeumastore(page, itemBusqueda) {
  const proveedor = "Neumastore";

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
    console.log("Neumastore: no se pudo extraer medida:", medida);
    return [];
  }

  try {
    console.log("Neumastore paso 1: entrando a home");

    await page.goto("https://neumastore.cl/", {
      waitUntil: "domcontentloaded",
      timeout: 60000,
    });

    await page.waitForTimeout(3000);

    console.log("Neumastore paso 2: seleccionando filtros", datosMedida);

    const form = page.locator("form.nsbm-buscador-form").first();
    const selectAncho = form.locator('select[name="nsbm_ancho"]');
    const selectAlto = form.locator('select[name="nsbm_alto"]');
    const selectAro = form.locator('select[name="nsbm_aro"]');
    const botonBuscar = form.locator('button[type="submit"]');

    if (
      (await form.count()) === 0 ||
      (await selectAncho.count()) === 0 ||
      (await selectAlto.count()) === 0 ||
      (await selectAro.count()) === 0 ||
      (await botonBuscar.count()) === 0
    ) {
      console.log("Neumastore: no encontró el widget de búsqueda");
      await page.screenshot({
        path: "neumastore-error-selectores.png",
        fullPage: true,
      });
      return [];
    }

    await selectAncho.selectOption({ label: datosMedida.ancho });
    await selectAlto.selectOption({ label: datosMedida.perfil });
    await selectAro.selectOption({ label: `R${datosMedida.aro}` });

    console.log("Neumastore paso 3: clic en Buscar");

    await Promise.all([
      page.waitForLoadState("domcontentloaded").catch(() => {}),
      botonBuscar.click(),
    ]);

    await page.waitForTimeout(3000);

    console.log("Neumastore paso 4: resultados cargados", page.url());

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
          document.querySelectorAll("ul.products li.product")
        );
        const resultados = [];

        for (const item of items) {
          const titulo = normalizarTexto(
            item.querySelector(".woocommerce-loop-product__title")
              ?.textContent || ""
          );
          const tituloComparable = normalizarComparacion(titulo);

          if (!titulo || !tituloComparable.includes(medidaNormalizada)) continue;

          if (
            fabricanteNormalizado &&
            !tituloComparable.includes(fabricanteNormalizado)
          ) {
            continue;
          }

          const priceBox = item.querySelector(".price");
          if (!priceBox) continue;

          const delTexto = priceBox.querySelector("del .amount")?.textContent?.trim() || "";
          const insTexto = priceBox.querySelector("ins .amount")?.textContent?.trim() || "";

          let precioOfertaTexto;
          let precioNormalTexto;

          if (insTexto) {
            precioOfertaTexto = insTexto;
            precioNormalTexto = delTexto;
          } else {
            precioOfertaTexto = priceBox.querySelector(".amount")?.textContent?.trim() || "";
            precioNormalTexto = "";
          }

          const precioOferta = parsePrecio(precioOfertaTexto);
          const precioNormal = parsePrecio(precioNormalTexto);

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
            precioOfertaTexto,
            precioNormalTexto,
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

    console.log("Neumastore productos reales:", productos.length);

    return productos;
  } catch (error) {
    console.error("Error Neumastore:", error.message);

    await page
      .screenshot({
        path: "neumastore-error-general.png",
        fullPage: true,
      })
      .catch(() => {});

    return [];
  }
}
