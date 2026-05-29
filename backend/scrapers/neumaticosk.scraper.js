export async function buscarNeumaticosK(page, itemBusqueda) {
  const proveedor = "NeumaticosK";

const medida =
  typeof itemBusqueda === "string" ? itemBusqueda : itemBusqueda.medida;

const fabricante =
  typeof itemBusqueda === "string" ? "" : itemBusqueda.fabricante || "";

const busqueda =
  typeof itemBusqueda === "string"
    ? itemBusqueda
    : itemBusqueda.busqueda || `${medida} ${fabricante}`;
  const convertirMedidaAUrl = (valor = "") => {
    const match = String(valor)
      .toUpperCase()
      .match(/(\d{3})\/(\d{2})\s*R(\d{2})/);

    if (!match) return null;

    return `${match[1]}-${match[2]}-R${match[3]}`;
  };

  const medidaUrl = convertirMedidaAUrl(medida);

  if (!medidaUrl) {
    console.log("NeumaticosK: no se pudo convertir medida:", medida);
    return [];
  }

  try {
    const url = `https://neumaticosk.cl/neumaticos/medidas/${medidaUrl}`;

    console.log("Abriendo NeumaticosK:", url);

    await page.goto(url, {
      waitUntil: "domcontentloaded",
      timeout: 60000,
    });

    await page.waitForTimeout(8000);

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

        const contenedores = Array.from(
          document.querySelectorAll("section, .box-catalogo, div, article, li")
        ).filter((el) => {
          const txt = el.innerText || "";
          return txt.includes("$") && txt.toUpperCase().includes("NEUMATICO");
        });

        const resultados = [];

        for (const contenedor of contenedores) {
          const lineas = contenedor.innerText
            .split("\n")
            .map((x) => x.trim())
            .filter(Boolean);

          for (const linea of lineas) {
            if (!linea.toUpperCase().startsWith("NEUMATICO")) continue;

            const lineaNormalizada = normalizar(linea);

            if (!lineaNormalizada.includes(medidaNormalizada)) continue;

            if (
              fabricanteNormalizado &&
              !lineaNormalizada.includes(fabricanteNormalizado)
            ) {
              continue;
            }

            const precioNormalTexto =
              contenedor
                .querySelector(".precio-oferta")
                ?.innerText?.match(/\$[\d.]+/)?.[0] || "";

            const precioOfertaTexto =
              contenedor
                .querySelector(".precio-normal")
                ?.innerText?.match(/\$[\d.]+/)?.[0] || "";

            const precioNormal = Number(
              precioNormalTexto.replace(/[^\d]/g, "")
            );

            const precioOferta = Number(
              precioOfertaTexto.replace(/[^\d]/g, "")
            );

            if (!precioOferta) continue;

            const link =
              contenedor.querySelector("a[href*='neumatico']")?.href ||
              contenedor.querySelector("a")?.href ||
              window.location.href;

            const partes = linea
              .replace(/^NEUMATICO\s+/i, "")
              .split(" ")
              .filter(Boolean);

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
              precio: precioOferta,
              url: link,
            });
          }
        }

        const unicos = new Map();

        for (const item of resultados) {
          unicos.set(normalizar(item.producto), item);
        }

        return Array.from(unicos.values());
      },
      {
        proveedor,
        medida,
        fabricante,
      }
    );

    console.log("NeumaticosK productos reales:", productos.length);

    return productos;
  } catch (error) {
    console.error("Error NeumaticosK:", error.message);

    await page
      .screenshot({
        path: "neumaticosk-error.png",
        fullPage: true,
      })
      .catch(() => {});

    return [];
  }
}