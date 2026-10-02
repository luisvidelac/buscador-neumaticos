export async function buscarReyDelNeumatico(page, itemBusqueda) {
  const proveedor = "ReyDelNeumatico";

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
    console.log("ReyDelNeumatico: no se pudo extraer medida:", medida);
    return [];
  }

  try {
    console.log("ReyDelNeumatico paso 1: entrando a home");

    await page.goto("https://elreydelneumatico.cl/", {
      waitUntil: "domcontentloaded",
      timeout: 60000,
    });

    await page.waitForTimeout(3000);

    console.log("ReyDelNeumatico paso 2: seleccionando filtros", datosMedida);

    const selectAncho = page.locator("#oftipo-direccion");
    const selectPerfil = page.locator("#oftipo-propiedad");
    const selectAro = page.locator("#oftipo-operacion");

    if (
      (await selectAncho.count()) === 0 ||
      (await selectPerfil.count()) === 0 ||
      (await selectAro.count()) === 0
    ) {
      console.log("ReyDelNeumatico: no encontró los 3 selectores");
      await page.screenshot({
        path: "reydelneumatico-error-selectores.png",
        fullPage: true,
      });
      return [];
    }

    await selectAncho.selectOption({ label: datosMedida.ancho });
    await page.waitForTimeout(500);

    await selectPerfil.selectOption({ label: datosMedida.perfil });
    await page.waitForTimeout(500);

    await selectAro.selectOption({ label: datosMedida.aro });
    await page.waitForTimeout(500);

    console.log("ReyDelNeumatico paso 3: clic en Buscar");

    const botonBuscar = page.locator(
      'form.searchandfilter input[type="submit"]'
    );

    if ((await botonBuscar.count()) === 0) {
      console.log("ReyDelNeumatico: no encontró botón Buscar");
      await page.screenshot({
        path: "reydelneumatico-error-boton-buscar.png",
        fullPage: true,
      });
      return [];
    }

    await Promise.all([
      page.waitForLoadState("domcontentloaded").catch(() => {}),
      botonBuscar.click(),
    ]);

    await page.waitForTimeout(3500);

    console.log("ReyDelNeumatico paso 4: resultados cargados", page.url());

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

        const fabricanteNormalizado = normalizarComparacion(fabricante);

        const items = Array.from(
          document.querySelectorAll("ul.products li.product")
        );
        const resultados = [];

        for (const item of items) {
          const titulo = normalizarTexto(
            item.querySelector("h2.woocommerce-loop-product__title")
              ?.textContent || ""
          );

          if (!titulo) continue;

          const tituloComparable = normalizarComparacion(titulo);

          if (
            fabricanteNormalizado &&
            !tituloComparable.includes(fabricanteNormalizado)
          ) {
            continue;
          }

          const precioBox = item.querySelector(".priceCode .price");
          if (!precioBox) continue;

          const insEl = precioBox.querySelector("ins .woocommerce-Price-amount");
          const delEl = precioBox.querySelector("del .woocommerce-Price-amount");
          const simpleEl = precioBox.querySelector(
            ":scope > .woocommerce-Price-amount"
          );

          const aNumero = (txt = "") =>
            Math.round(Number(String(txt).replace(/[^\d]/g, "")) || 0);

          let precioOferta = 0;
          let precioNormal = 0;
          let precioOfertaTexto = "";
          let precioNormalTexto = "";

          if (insEl) {
            precioOfertaTexto = insEl.textContent.trim();
            precioOferta = aNumero(precioOfertaTexto);
            precioNormalTexto = delEl?.textContent.trim() || "";
            precioNormal = aNumero(precioNormalTexto);
          } else if (simpleEl) {
            precioOfertaTexto = simpleEl.textContent.trim();
            precioNormalTexto = precioOfertaTexto;
            precioOferta = aNumero(precioOfertaTexto);
            precioNormal = precioOferta;
          }

          if (precioOferta <= 0 && precioNormal <= 0) continue;

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
            url: window.location.href,
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

    console.log("ReyDelNeumatico productos reales:", productos.length);

    return productos;
  } catch (error) {
    console.error("Error ReyDelNeumatico:", error.message);

    await page
      .screenshot({
        path: "reydelneumatico-error-general.png",
        fullPage: true,
      })
      .catch(() => {});

    return [];
  }
}
