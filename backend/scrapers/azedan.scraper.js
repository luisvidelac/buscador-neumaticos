export async function buscarAZedan(page, itemBusqueda) {
  const proveedor = "AZedan";

  const medida =
  typeof itemBusqueda === "string" ? itemBusqueda : itemBusqueda.medida;

const fabricante =
  typeof itemBusqueda === "string" ? "" : itemBusqueda.fabricante || "";

const busqueda =
  typeof itemBusqueda === "string"
    ? itemBusqueda
    : itemBusqueda.busqueda || `${medida} ${fabricante}`;
  const query = encodeURIComponent(busqueda);

  await page.goto(`https://azedan.cl/?s=${query}&post_type=product`, {
    waitUntil: "domcontentloaded",
    timeout: 60000,
  });

  await page.waitForTimeout(6000);

  const productos = await page.evaluate(({ proveedor, medida, fabricante }) => {
    const normalizar = (txt = "") =>
      txt.toUpperCase().replace(/\s+/g, "").replace(/-/g, "/");

    const medidaNormalizada = normalizar(medida);
    const fabricanteNormalizado = normalizar(fabricante);

    const lineas = document.body.innerText
      .split("\n")
      .map((x) => x.trim())
      .filter(Boolean);

    const resultados = [];

    for (let i = 0; i < lineas.length; i++) {
      const producto = lineas[i];

if (producto.toUpperCase().includes("CANTIDAD")) continue;
if (producto.toUpperCase().includes("AGREGAR")) continue;
if (producto.toUpperCase().includes("CARRO")) continue;

      if (!normalizar(producto).includes(medidaNormalizada)) continue;

      if (
        fabricanteNormalizado &&
        !normalizar(producto).includes(fabricanteNormalizado)
      ) {
        continue;
      }

      const ventana = lineas.slice(i, i + 6).join(" ");
      const precios = ventana.match(/\$[\d.]+/g) || [];

      if (precios.length === 0) continue;

      const preciosNumericos = precios
        .map((p) => ({
          texto: p,
          valor: Number(p.replace(/[^\d]/g, "")),
        }))
        .filter((p) => p.valor > 0);

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

    const unicos = new Map();

for (const item of resultados) {
  const clave = normalizar(
    item.producto
      .replace(/cantidad/gi, "")
      .replace(/\$/g, "")
  );

  if (!unicos.has(clave)) {
    unicos.set(clave, item);
  }
}

return Array.from(unicos.values());
  }, { proveedor, medida, fabricante });

  console.log("AZedan productos reales:", productos.length);

  return productos;
}