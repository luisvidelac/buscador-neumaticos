// La marca que trae cada scraper viene vacia o mal recortada en varios sitios;
// el titulo completo del producto si la menciona, asi que se detecta ahi.
export const MARCAS_CONOCIDAS = [
  "BFGOODRICH", "BRIDGESTONE", "CONTINENTAL", "DUNLOP", "FALKEN", "FIRESTONE",
  "GENERAL", "GOODYEAR", "HANKOOK", "KUMHO", "MAXXIS", "MICHELIN", "NEXEN",
  "PIRELLI", "TOYO", "YOKOHAMA", "LINGLONG", "WESTLAKE", "ROADX", "APTANY",
  "TRIANGLE", "SAILUN", "GOODRIDE", "ROADWIND", "GENESYS", "DELINTE", "HIFLY",
  "ROADCRUZA", "APLUS", "KAPSEN", "FIREMAX", "AOTELI", "CITY STAR", "ADERENZA",
];

export function normalizarTexto(txt) {
  return String(txt || "")
    .toUpperCase()
    .normalize("NFD")
    .replace(/[^\x00-\x7F]/g, "")
    .trim();
}

export function detectarMarca(oferta) {
  const texto = normalizarTexto(`${oferta.marca || ""} ${oferta.modelo || ""} ${oferta.producto || ""}`);
  return MARCAS_CONOCIDAS.find((marca) => texto.includes(marca)) ?? null;
}

// Antes se guardaba solo la mas barata por proveedor: si esa era una marca
// economica, la oferta Hankook/Bridgestone del mismo proveedor se perdia y la
// comparacion por marca quedaba vacia. Ahora: la mas barata por proveedor+marca.
export function mejorOfertaPorProveedorYMarca(resultados) {
  const mejores = new Map();
  for (const oferta of resultados) {
    const proveedorNombre = oferta.proveedor;
    if (!proveedorNombre) continue;
    const precio = Number(oferta.precio) || 0;
    if (precio <= 0) continue;

    const marcaDetectada = detectarMarca(oferta);
    const proveedorKey = proveedorNombre.trim().toLowerCase();
    const key = `${proveedorKey}|${marcaDetectada ?? "?"}`;
    const actual = mejores.get(key);
    if (!actual || precio < actual.precio) {
      mejores.set(key, { ...oferta, precio, proveedorNombre, proveedorKey, marcaDetectada });
    }
  }
  return Array.from(mejores.values());
}
