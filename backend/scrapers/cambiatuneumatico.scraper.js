export async function buscarCambiaTuNeumatico(page, itemBusqueda) {
  const proveedor = "CambiaTuNeumatico";

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
    console.log("CambiaTuNeumatico: no se pudo extraer medida:", medida);
    return [];
  }

  try {
    const url = `https://www.cambiatuneumatico.com/medida/${datosMedida.ancho}-${datosMedida.perfil}-R${datosMedida.aro}`;

    console.log("CambiaTuNeumatico paso 1: entrando a", url);

    await page.goto(url, {
      waitUntil: "domcontentloaded",
      timeout: 60000,
    });

    await page.waitForTimeout(3500);

    console.log("CambiaTuNeumatico paso 2: resultados cargados", page.url());

    const contenedorResultados = page.locator(".listado-resultados");

    if ((await contenedorResultados.count()) === 0) {
      console.log(
        "CambiaTuNeumatico: no encontró el contenedor de resultados (posible cambio de sitio)"
      );
      await page.screenshot({
        path: "cambiatuneumatico-error-sin-contenedor.png",
        fullPage: true,
      });
      return [];
    }

    const listaProductos = page.locator(".listado-resultados > .producto");

    if ((await listaProductos.count()) === 0) {
      console.log("CambiaTuNeumatico: 0 productos para esta medida (sin stock)");
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

        const parsearPrecio = (txt = "") =>
          Number(String(txt).replace(/[^\d]/g, "")) || 0;

        const items = Array.from(
          document.querySelectorAll(".listado-resultados > .producto")
        );
        const resultados = [];

        for (const item of items) {
          const detalle = item.querySelector(".box-detalle-producto");
          if (!detalle) continue;

          const lineas = Array.from(detalle.querySelectorAll(".h6.m-0"))
            .map((el) => normalizarTexto(el.textContent))
            .filter(Boolean);

          if (lineas.length === 0) continue;

          const medidaLinea = lineas[lineas.length - 1];
          const modelo = lineas.slice(0, -1).join(" ").trim();

          const marcaAlt = detalle.querySelector(".imagen-marca img")?.alt || "";
          const marca = marcaAlt.replace(/^Neumaticos\s+/i, "").trim();

          const titulo = normalizarTexto(
            [marca, modelo, medidaLinea].filter(Boolean).join(" ")
          );
          const tituloComparable = normalizarComparacion(titulo);

          if (!tituloComparable.includes(medidaNormalizada)) continue;

          if (
            fabricanteNormalizado &&
            !tituloComparable.includes(fabricanteNormalizado)
          ) {
            continue;
          }

          const precioEl = item.querySelector(".precio");
          if (!precioEl) continue;

          let etiquetaActual = "";
          let precioOfertaTexto = "";
          let precioNormalTexto = "";

          for (const hijo of Array.from(precioEl.children)) {
            if (hijo.classList.contains("small")) {
              etiquetaActual = normalizarTexto(hijo.textContent);
              continue;
            }

            if (etiquetaActual === "Precio Oferta") {
              precioOfertaTexto = normalizarTexto(hijo.textContent);
            } else if (etiquetaActual === "Precio Normal") {
              precioNormalTexto = normalizarTexto(hijo.textContent);
            }

            etiquetaActual = "";
          }

          const precioOferta = parsearPrecio(precioOfertaTexto);
          const precioNormal = parsearPrecio(precioNormalTexto);

          if (precioOferta <= 0 && precioNormal <= 0) continue;

          const hrefRelativo = item
            .querySelector(".box-imagen-producto a")
            ?.getAttribute("href");

          const url =
            hrefRelativo && hrefRelativo.startsWith("/")
              ? `https://www.cambiatuneumatico.com${hrefRelativo}`
              : hrefRelativo || window.location.href;

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

    console.log("CambiaTuNeumatico productos reales:", productos.length);

    return productos;
  } catch (error) {
    console.error("Error CambiaTuNeumatico:", error.message);

    await page
      .screenshot({
        path: "cambiatuneumatico-error-general.png",
        fullPage: true,
      })
      .catch(() => {});

    return [];
  }
}
