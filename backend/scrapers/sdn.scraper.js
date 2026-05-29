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

    console.log("SDN paso 2: clic en Autos y camionetas");

    const botonAutos = page.locator(
      'text=Auto - camioneta, text=Autos y camionetas, text=Auto, a[href*="autos-y-camionetas"]'
    );

    if ((await botonAutos.count()) > 0) {
      await Promise.all([
        page.waitForLoadState("domcontentloaded").catch(() => {}),
        botonAutos.first().click(),
      ]);
    } else {
      console.log("SDN: no encontró botón Autos y camionetas, entra directo a categoría");

      await page.goto(
        "https://www.sdn.cl/neumaticos/autos-y-camionetas-neumaticos.html",
        {
          waitUntil: "domcontentloaded",
          timeout: 60000,
        }
      );
    }

    await page.waitForTimeout(5000);

    console.log("SDN paso 3: seleccionando filtros", datosMedida);

    const selects = page.locator("select");
    const totalSelects = await selects.count();

    if (totalSelects < 3) {
      console.log("SDN: no encontró los 3 selectores");
      await page.screenshot({
        path: "sdn-error-selectores.png",
        fullPage: true,
      });
      return [];
    }

    await selects.nth(0).selectOption({ label: datosMedida.ancho });
    await page.waitForTimeout(800);

    await selects.nth(1).selectOption({ label: datosMedida.perfil });
    await page.waitForTimeout(800);

    await selects.nth(2).selectOption({ label: datosMedida.aro });
    await page.waitForTimeout(800);

    console.log("SDN paso 4: clic en Filtrar");

    const botonFiltrar = page.locator(
      'button:has-text("Filtrar"), input[value="Filtrar"], input[type="submit"], a:has-text("Filtrar")'
    );

    if ((await botonFiltrar.count()) === 0) {
      console.log("SDN: no encontró botón Filtrar");
      await page.screenshot({
        path: "sdn-error-boton-filtrar.png",
        fullPage: true,
      });
      return [];
    }

    await Promise.all([
      page.waitForLoadState("domcontentloaded").catch(() => {}),
      botonFiltrar.first().click(),
    ]);

    await page.waitForTimeout(9000);

    console.log("SDN paso 5: resultados cargados", page.url());

    await page.screenshot({
      path: "sdn-resultados-debug.png",
      fullPage: true,
    });

    const productos = await page.evaluate(
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
          const linea = lineas[i];
          const lineaNormalizada = normalizar(linea);

          if (!lineaNormalizada.includes(medidaNormalizada)) continue;

          if (
            fabricanteNormalizado &&
            !lineaNormalizada.includes(fabricanteNormalizado)
          ) {
            continue;
          }

          const ventana = lineas.slice(i, i + 15).join(" ");
          const precios = ventana.match(/\$[\d.]+/g) || [];

          if (precios.length === 0) continue;

          const preciosOrdenados = precios
            .map((p) => ({
              texto: p,
              valor: Number(p.replace(/[^\d]/g, "")),
            }))
            .filter((p) => p.valor > 0)
            .sort((a, b) => a.valor - b.valor);

          const precioOfertaTexto = preciosOrdenados[0]?.texto || "";
          const precioNormalTexto = preciosOrdenados[1]?.texto || "";

          const precioOferta = preciosOrdenados[0]?.valor || 0;
          const precioNormal = preciosOrdenados[1]?.valor || 0;

          const partes = linea.split(" ");

          resultados.push({
            proveedor,
            medida,
            marca: partes.at(-1) || "",
            modelo: partes.slice(0, -1).join(" "),
            producto: linea,
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