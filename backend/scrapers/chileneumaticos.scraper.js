export async function buscarChileNeumaticos(page, itemBusqueda) {
  const proveedor = "ChileNeumaticos";

  const medida =
  typeof itemBusqueda === "string" ? itemBusqueda : itemBusqueda.medida;

const fabricante =
  typeof itemBusqueda === "string" ? "" : itemBusqueda.fabricante || "";

const busqueda =
  typeof itemBusqueda === "string"
    ? itemBusqueda
    : itemBusqueda.busqueda || `${medida} ${fabricante}`;
  const normalizar = (txt = "") =>
    String(txt)
      .toUpperCase()
      .replace(/\s+/g, "")
      .replace(/\//g, "")
      .replace(/-/g, "")
      .replace(/\./g, "");

  const medidaNormalizada = normalizar(medida);
  const fabricanteNormalizado = normalizar(fabricante);

  try {
    const url = `https://chileneumaticos.cl/s?search=${encodeURIComponent(
      busqueda
    )}`;

    console.log(url);

    console.log("Abriendo ChileNeumaticos:", url);

    await page.goto(url, {
      waitUntil: "domcontentloaded",
      timeout: 60000,
    });

    await page.waitForTimeout(12000);

    await page
      .waitForSelector(".product-card-container", {
        timeout: 20000,
      })
      .catch(() => {
        console.log("ChileNeumaticos: no aparecieron tarjetas");
      });

    await page.screenshot({
      path: "chileneumaticos-debug.png",
      fullPage: true,
    });

    const cantidadCards = await page.locator(".product-card-container").count();

    console.log('cantidadCards===========');
    console.log(cantidadCards);

    console.log("ChileNeumaticos tarjetas encontradas:", cantidadCards);

    const productos = await page.evaluate(
      ({ proveedor, medida, medidaNormalizada, fabricanteNormalizado }) => {
        const normalizar = (txt = "") =>
          String(txt)
            .toUpperCase()
            .replace(/\s+/g, "")
            .replace(/\//g, "")
            .replace(/-/g, "")
            .replace(/\./g, "");

        const medidaFlexible = medidaNormalizada.replace("R", "");

        const cards = Array.from(
          document.querySelectorAll(".product-card-container")
        );

        const resultados = [];

        for (const card of cards) {
          const producto =
            card.querySelector(".product-card-name")?.innerText?.trim() || "";

          const productoNormalizado = normalizar(producto);

          if (
            !productoNormalizado.includes(medidaNormalizada) &&
            !productoNormalizado.includes(medidaFlexible)
          ) {
            continue;
          }

          if (
            fabricanteNormalizado &&
            !productoNormalizado.includes(fabricanteNormalizado)
          ) {
            continue;
          }

          const precioOfertaTexto =
            card
              .querySelector(".product-card-price.offer")
              ?.childNodes?.[0]?.textContent?.trim() ||
            card
              .querySelector(".product-card-price.offer")
              ?.innerText?.split("\n")?.[0]?.trim() ||
            "";

          const precioOferta = Number(
            precioOfertaTexto.replace(/[^\d]/g, "")
          );

          const precioNormalTexto =
            card.querySelector(".product-card-price")?.innerText?.trim() || "";

          const link = card.querySelector("a.product-card-name")?.href || "";

          if (!producto || !precioOferta) continue;

          const partes = producto.split(" ");

          resultados.push({
            proveedor,
            medida,
            marca: partes[0] || "",
            modelo: partes.slice(1).join(" "),
            producto,
            precioOfertaTexto,
            precioNormalTexto,
            precioOferta,
            precioNormal: 0,
            precio: precioOferta,
            url: link || window.location.href,
          });
        }

        const unicos = new Map();

        for (const item of resultados) {
          const clave = item.url || `${item.producto}-${item.precio}`;
          unicos.set(clave, item);
        }

        return Array.from(unicos.values());
      },
      {
        proveedor,
        medida,
        medidaNormalizada,
        fabricanteNormalizado,
      }
    );

    console.log("ChileNeumaticos productos reales:", productos.length);

    return productos;
  } catch (error) {
    console.error("Error ChileNeumaticos:", error.message);

    await page
      .screenshot({
        path: "chileneumaticos-error.png",
        fullPage: true,
      })
      .catch(() => {});

    return [];
  }
}