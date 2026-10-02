export async function buscarSDN(page, itemBusqueda) {
  const proveedor = "SDN";

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

  const normalizar = (txt = "") =>
    String(txt)
      .toUpperCase()
      .replace(/\s+/g, "")
      .replace(/\//g, "")
      .replace(/-/g, "");

  const datosMedida = extraerMedida(medida);

  if (!datosMedida) {
    console.log("SDN: no se pudo extraer medida:", medida);
    return [];
  }

  try {
    console.log("SDN paso 1: entrando a home");

    await page.goto("https://www.sdn.cl", {
      waitUntil: "domcontentloaded",
      timeout: 60000,
    });

    await page.waitForTimeout(4000);

    console.log("SDN paso 2: seleccionando filtros", datosMedida);

    const selectAncho = page.locator("#filter-ancho");
    const selectPerfil = page.locator("#filter-perfil");
    const selectAro = page.locator("#filter-aro");

    if (
      (await selectAncho.count()) === 0 ||
      (await selectPerfil.count()) === 0 ||
      (await selectAro.count()) === 0
    ) {
      console.log("SDN: no encontró los 3 selectores");
      await page.screenshot({
        path: "sdn-error-selectores.png",
        fullPage: true,
      });
      return [];
    }

    await selectAncho.selectOption({ label: datosMedida.ancho });
    await page.waitForTimeout(1500);

    await selectPerfil.selectOption({ label: datosMedida.perfil });
    await page.waitForTimeout(1500);

    await selectAro.selectOption({ label: datosMedida.aro });
    await page.waitForTimeout(800);

    console.log("SDN paso 3: clic en Buscar");

    const botonBuscar = page.locator("#tire-filter-btn");

    if ((await botonBuscar.count()) === 0) {
      console.log("SDN: no encontró botón Buscar");
      await page.screenshot({
        path: "sdn-error-boton-buscar.png",
        fullPage: true,
      });
      return [];
    }

    await Promise.all([
      page.waitForLoadState("domcontentloaded").catch(() => {}),
      botonBuscar.click(),
    ]);

    await page.waitForTimeout(9000);

    console.log("SDN paso 4: resultados cargados", page.url());

    await page.screenshot({
      path: "sdn-resultados-debug.png",
      fullPage: true,
    });

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

        const items = Array.from(document.querySelectorAll(".product-item-info"));
        const resultados = [];

        for (const item of items) {
          const titulo = normalizarTexto(
            item.querySelector(".product-item-link")?.textContent || ""
          );
          const tituloComparable = normalizarComparacion(titulo);

          if (!tituloComparable.includes(medidaNormalizada)) continue;

          if (
            fabricanteNormalizado &&
            !tituloComparable.includes(fabricanteNormalizado)
          ) {
            continue;
          }

          const priceBox = item.querySelector(".price-box");
          if (!priceBox) continue;

          const finalEl = priceBox.querySelector('[data-price-type="finalPrice"]');
          const oldEl = priceBox.querySelector('[data-price-type="oldPrice"]');

          const precioOferta = finalEl
            ? Math.round(Number(finalEl.getAttribute("data-price-amount")) || 0)
            : 0;
          const precioNormal = oldEl
            ? Math.round(Number(oldEl.getAttribute("data-price-amount")) || 0)
            : 0;

          if (precioOferta <= 0 && precioNormal <= 0) continue;

          resultados.push({
            proveedor,
            medida,
            marca: "",
            modelo: titulo,
            producto: titulo,
            precioOfertaTexto: finalEl?.textContent.trim() || "",
            precioNormalTexto: oldEl?.textContent.trim() || "",
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

    console.log("SDN productos reales:", productos.length);

    return productos;
  } catch (error) {
    console.error("Error SDN:", error.message);

    await page
      .screenshot({
        path: "sdn-error-general.png",
        fullPage: true,
      })
      .catch(() => {});

    return [];
  }
}