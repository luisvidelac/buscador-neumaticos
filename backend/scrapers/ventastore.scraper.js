export async function buscarVentaStore(page, itemBusqueda) {
  const proveedor = "VentaStore";

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
    console.log("VentaStore: no se pudo extraer medida:", medida);
    return [];
  }

  try {
    console.log("VentaStore paso 1: entrando a categoría neumáticos");

    await page.goto(
      "https://ventastore.cl/categoria-producto/neumaticos/",
      {
        waitUntil: "domcontentloaded",
        timeout: 60000,
      }
    );

    await page.waitForTimeout(3000);

    // El sitio usa LiteSpeed Cache con "delay JS execution": jQuery y el bundle
    // de JetSmartFilters no se cargan hasta que ocurre una interacción real del
    // usuario (click/scroll/etc). page.selectOption() por sí solo no dispara
    // esa carga, así que primero simulamos un click real en una zona neutra.
    await page.mouse.move(5, 5);
    await page.mouse.click(5, 5);
    await page.waitForTimeout(3000);

    const selectAro = page.locator('select[name="pa_r"]');
    const selectAncho = page.locator('select[name="pa_ancho"]');
    const selectPerfil = page.locator('select[name="pa_perfil"]');

    if (
      (await selectAro.count()) === 0 ||
      (await selectAncho.count()) === 0 ||
      (await selectPerfil.count()) === 0
    ) {
      console.log("VentaStore: no encontró el widget de filtros");
      await page.screenshot({
        path: "ventastore-error-selectores.png",
        fullPage: true,
      });
      return [];
    }

    console.log("VentaStore paso 2: seleccionando Aro", datosMedida.aro);

    const opcionAro = selectAro.locator(`option[data-label="${datosMedida.aro}"]`);
    if ((await opcionAro.count()) === 0) {
      console.log("VentaStore: 0 productos, no existe opción de Aro", datosMedida.aro);
      return [];
    }

    await selectAro.selectOption({ label: datosMedida.aro });
    await page.waitForTimeout(3000);

    console.log("VentaStore paso 3: seleccionando Ancho", datosMedida.ancho);

    const opcionAncho = selectAncho.locator(`option[data-label="${datosMedida.ancho}"]`);
    if ((await opcionAncho.count()) === 0) {
      console.log("VentaStore: 0 productos, no existe opción de Ancho", datosMedida.ancho);
      return [];
    }

    await selectAncho.selectOption({ label: datosMedida.ancho });
    await page.waitForTimeout(3000);

    console.log("VentaStore paso 4: seleccionando Perfil", datosMedida.perfil);

    const opcionPerfil = selectPerfil.locator(`option[data-label="${datosMedida.perfil}"]`);
    if ((await opcionPerfil.count()) === 0) {
      console.log("VentaStore: 0 productos, no existe opción de Perfil", datosMedida.perfil);
      return [];
    }

    await selectPerfil.selectOption({ label: datosMedida.perfil });
    await page.waitForTimeout(4000);

    console.log("VentaStore paso 5: resultados cargados", page.url());

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
          document.querySelectorAll(".jet-woo-products__item")
        );
        const resultados = [];

        for (const item of items) {
          const titulo = normalizarTexto(
            item.querySelector(".jet-woo-product-title")?.textContent || ""
          );
          const tituloComparable = normalizarComparacion(titulo);

          if (!titulo || !tituloComparable.includes(medidaNormalizada)) continue;

          if (
            fabricanteNormalizado &&
            !tituloComparable.includes(fabricanteNormalizado)
          ) {
            continue;
          }

          const priceBox = item.querySelector(".jet-woo-product-price .price");
          if (!priceBox) continue;

          // El precio final (lo que realmente se cobra) es el último monto que
          // NO está dentro de un <del>. El precio tachado/anterior es el último
          // monto que sí está dentro de un <del> (el sitio a veces anida un
          // <ins> intermedio dentro del <del> para mostrar descuentos
          // escalonados, por eso se toma el último de cada grupo, no el primero).
          const todosLosMontos = Array.from(
            priceBox.querySelectorAll(".woocommerce-Price-amount.amount")
          );
          const montosDelTachado = Array.from(
            priceBox.querySelectorAll("del .woocommerce-Price-amount.amount")
          );
          const montosFinales = todosLosMontos.filter(
            (el) => !el.closest("del")
          );

          const elFinal =
            montosFinales[montosFinales.length - 1] ||
            todosLosMontos[todosLosMontos.length - 1];
          const elNormal = montosDelTachado[montosDelTachado.length - 1];

          const precioOferta = elFinal ? parsePrecio(elFinal.textContent) : 0;
          const precioNormal = elNormal ? parsePrecio(elNormal.textContent) : 0;

          if (precioOferta <= 0 && precioNormal <= 0) continue;

          const url =
            item.querySelector(".jet-woo-product-title a")?.href ||
            window.location.href;

          resultados.push({
            proveedor,
            medida,
            marca: "",
            modelo: titulo,
            producto: titulo,
            precioOfertaTexto: elFinal?.textContent.trim() || "",
            precioNormalTexto: elNormal?.textContent.trim() || "",
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

    console.log("VentaStore productos reales:", productos.length);

    return productos;
  } catch (error) {
    console.error("Error VentaStore:", error.message);

    await page
      .screenshot({
        path: "ventastore-error-general.png",
        fullPage: true,
      })
      .catch(() => {});

    return [];
  }
}
