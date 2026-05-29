export function normalizarMedida(medida) {
  return String(medida || "")
    .trim()
    .toUpperCase()
    .replace(/\s+/g, "")
    .replace("/", "-");
}

export function extraerPrecio(texto) {
  if (!texto) return { precioTexto: null, precio: null };
  const match = texto.match(/\$\s?[0-9.]{4,}/);
  if (!match) return { precioTexto: null, precio: null };
  const precioTexto = match[0];
  const precio = Number(precioTexto.replace("$", "").replaceAll(".", "").trim());
  return { precioTexto, precio: Number.isFinite(precio) ? precio : null };
}

export function crearScraperBusqueda({ proveedor, dominio, palabrasClave = "neumático neumatico" }) {
  return async function buscarProveedor(page, medida) {
    const query = `site:${dominio} ${palabrasClave} ${medida} Chile precio`;
    const url = `https://www.google.com/search?q=${encodeURIComponent(query)}`;

    await page.goto(url, { waitUntil: "domcontentloaded", timeout: 30000 });
    await page.waitForTimeout(1200);

    const productos = await page.evaluate(({ proveedor, medida }) => {
      const bloques = Array.from(document.querySelectorAll("a, div, span"))
        .map((el) => ({ texto: el.innerText || "", link: el.href || "" }))
        .filter((item) => item.texto.includes("$") && item.texto.length > 10);

      const vistos = new Set();

      return bloques.slice(0, 35).map((item) => {
        const precioTexto = item.texto.match(/\$\s?[0-9.]{4,}/)?.[0] || null;
        const precio = precioTexto
          ? Number(precioTexto.replace("$", "").replaceAll(".", "").trim())
          : null;

        return {
          proveedor,
          medida,
          nombre: item.texto.replace(/\s+/g, " ").trim().substring(0, 220),
          precioTexto,
          precio,
          url: item.link || window.location.href,
          fuente: "Búsqueda web"
        };
      })
      .filter((item) => item.precio && !vistos.has(item.nombre) && vistos.add(item.nombre));
    }, { proveedor, medida });

    return productos;
  };
}
