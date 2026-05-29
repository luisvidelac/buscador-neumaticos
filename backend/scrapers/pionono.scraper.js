export async function buscarPionono(page, itemBusqueda) {
  const proveedor = "Pionono";

  const medida =
    typeof itemBusqueda === "string" ? itemBusqueda : itemBusqueda.medida;

  const fabricante =
    typeof itemBusqueda === "string"
      ? ""
      : itemBusqueda.fabricanteFiltroManual ||
        itemBusqueda.fabricante ||
        "";

  const busqueda =
    typeof itemBusqueda === "string"
      ? itemBusqueda
      : itemBusqueda.busqueda || `${medida} ${fabricante}`;

  const resultadosGlobales = [];
  const unicos = new Map();

  try {
    await page.goto("https://pionono.cl/", {
      waitUntil: "domcontentloaded",
      timeout: 60000,
    });

    await page.waitForTimeout(4000);

    const input = page.locator(
      'input[type="search"], input[name="s"], input[placeholder*="Buscar"], input[placeholder*="buscar"]'
    );

    if ((await input.count()) === 0) {
      console.log("Pionono: no se encontró input de búsqueda");
      return [];
    }

    console.log("Pionono búsqueda:", busqueda);

    await input.first().fill(busqueda);
    await page.keyboard.press("Enter");

    await page.waitForTimeout(7000);

    await page.screenshot({
      path: "pionono-debug.png",
      fullPage: true,
    });

    for (let pagina = 1; pagina <= 5; pagina++) {
      console.log(`Pionono leyendo página ${pagina}`);

      const productosPagina = await page.evaluate(
        ({ proveedor, medida, fabricante }) => {
          const normalizar = (txt = "") =>
            String(txt)
              .toUpperCase()
              .replace(/\s+/g, "")
              .replace(/\//g, "")
              .replace(/-/g, "");

          const medidaNormalizada = normalizar(medida);
          const fabricanteNormalizado = normalizar(fabricante);

          const lineas = document.body.innerText
            .split("\n")
            .map((x) => x.trim())
            .filter(Boolean);

          const resultados = [];

          for (let i = 0; i < lineas.length; i++) {
            const producto = lineas[i];
            const productoMayus = producto.toUpperCase();
            const productoNormalizado = normalizar(producto);

            // Evita basura tipo "225/55R19 (3)" o "185/65R15 (8)"
            if (
              /^\d{3}\/\d{2}R?\d{2}\(\d+\)$/i.test(
                producto.replace(/\s+/g, "")
              )
            ) {
              continue;
            }

            // Evita líneas cortas o sin texto real de producto
            if (producto.length < 15) continue;
            if (!/[A-ZÁÉÍÓÚÑ]{3,}/i.test(producto)) continue;

            // Evita textos de carrito o acciones
            if (productoMayus.includes("CANTIDAD")) continue;
            if (productoMayus.includes("AGREGAR")) continue;
            if (productoMayus.includes("CARRO")) continue;
            if (productoMayus.includes("VER MÁS")) continue;
            if (productoMayus.includes("ORDENAR")) continue;
            if (productoMayus.includes("FILTRO")) continue;

            if (!productoNormalizado.includes(medidaNormalizada)) continue;

            if (
              fabricanteNormalizado &&
              !productoNormalizado.includes(fabricanteNormalizado)
            ) {
              continue;
            }

            const ventana = lineas.slice(i, i + 5).join(" ");
            const precios = ventana.match(/\$[\d.]+/g) || [];

            if (precios.length === 0) continue;

            const preciosNumericos = precios
              .map((p) => ({
                texto: p,
                valor: Number(p.replace(/[^\d]/g, "")),
              }))
              .filter((p) => p.valor > 0);

            if (preciosNumericos.length === 0) continue;

            const precioOfertaObj = preciosNumericos.reduce((menor, actual) =>
              actual.valor < menor.valor ? actual : menor
            );

            const precioNormalObj = preciosNumericos.reduce((mayor, actual) =>
              actual.valor > mayor.valor ? actual : mayor
            );

            const precioOfertaTexto = precioOfertaObj?.texto || "";

            const precioNormalTexto =
              precioNormalObj?.valor !== precioOfertaObj?.valor
                ? precioNormalObj?.texto || ""
                : "";

            const precioOferta = precioOfertaObj?.valor || 0;

            const precioNormal =
              precioNormalObj?.valor !== precioOfertaObj?.valor
                ? precioNormalObj?.valor || 0
                : 0;

            const partes = producto.split(" ");

            resultados.push({
              proveedor,
              medida,
              marca: partes.at(-1) || "",
              modelo: partes.slice(0, -1).join(" "),
              producto,
              precioOfertaTexto,
              precioNormalTexto,
              precioOferta,
              precioNormal,
              precio: precioOferta,
              url: window.location.href,
            });
          }

          return resultados;
        },
        { proveedor, medida, fabricante }
      );

      console.log("Pionono productos página:", productosPagina.length);

      for (const item of productosPagina) {
        const clave = item.producto
          .toUpperCase()
          .replace(/\s+/g, "")
          .replace(/\//g, "")
          .replace(/-/g, "");

        if (!unicos.has(clave)) {
          unicos.set(clave, item);
          resultadosGlobales.push(item);
        }
      }

      const siguiente = page.locator(
        'a.next, .next.page-numbers, a.page-numbers:has-text("→"), a:has-text("Siguiente"), a:has-text("Next")'
      );

      if ((await siguiente.count()) === 0) {
        console.log("Pionono: no hay siguiente página");
        break;
      }

      try {
        await siguiente.first().click();
        await page.waitForTimeout(6000);
      } catch {
        console.log("Pionono: no se pudo pasar a la siguiente página");
        break;
      }
    }

    console.log("Pionono total productos:", resultadosGlobales.length);
    return resultadosGlobales;
  } catch (error) {
    console.error("Error Pionono:", error.message);

    await page
      .screenshot({
        path: "pionono-error.png",
        fullPage: true,
      })
      .catch(() => {});

    return [];
  }
}