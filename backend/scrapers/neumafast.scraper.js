export async function buscarNeumafast(page, itemBusqueda) {
  const proveedor = "Neumafast";

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
      .replace(/-/g, "");

  try {
    const query = encodeURIComponent(busqueda);

    const urls = [
      `https://neumafast.cl/?s=${query}&post_type=product`,
      `https://www.neumafast.cl/?s=${query}&post_type=product`,
      `https://neumafast.cl/?s=${query}`,
    ];

    const resultadosGlobales = [];
    const unicos = new Map();

    for (const url of urls) {
      console.log("Abriendo NeumaFast:", url);

      await page.goto(url, {
        waitUntil: "domcontentloaded",
        timeout: 60000,
      });

      await page.waitForTimeout(7000);

      await page.screenshot({
        path: "neumafast-debug.png",
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

          return resultados;
        },
        { proveedor, medida, fabricante }
      );

      for (const item of productos) {
        const clave = `${item.producto}-${item.precio}`;

        if (!unicos.has(clave)) {
          unicos.set(clave, item);
          resultadosGlobales.push(item);
        }
      }

      if (resultadosGlobales.length > 0) break;
    }

    console.log("NeumaFast total productos:", resultadosGlobales.length);

    return resultadosGlobales;
  } catch (error) {
    console.error("Error NeumaFast:", error.message);
    return [];
  }
}