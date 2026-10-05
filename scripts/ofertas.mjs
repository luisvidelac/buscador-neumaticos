// La marca que trae cada scraper viene vacia o mal recortada en varios sitios;
// el titulo completo del producto si la menciona, asi que se detecta ahi.
export const MARCAS_CONOCIDAS = [
  "BFGOODRICH", "BRIDGESTONE", "CONTINENTAL", "DUNLOP", "FALKEN", "FIRESTONE",
  "GENERAL", "GOODYEAR", "HANKOOK", "KUMHO", "MAXXIS", "MICHELIN", "NEXEN",
  "PIRELLI", "TOYO", "YOKOHAMA", "LINGLONG", "WESTLAKE", "ROADX", "APTANY",
  "TRIANGLE", "SAILUN", "GOODRIDE", "ROADWIND", "GENESYS", "DELINTE", "HIFLY",
  "ROADCRUZA", "APLUS", "KAPSEN", "FIREMAX", "AOTELI", "CITY STAR", "ADERENZA",
  "ANNAITE", "COOPER", "SONIX", "TRACMAX", "MINNELL", "KUSTONE", "HILO", "MAZZINI", "WINDFORCE", "DOUBLECOIN", "MINERVA", "VINMAX", "ANTARES", "LANDSAIL", "COMFORSER", "ZEETEX", "MARSHAL", "LASSA", "UNIROYAL", "BARUM",
];

export function normalizarTexto(txt) {
  return String(txt || "")
    .toUpperCase()
    .normalize("NFD")
    .replace(/[^\x00-\x7F]/g, "")
    .trim();
}

function textoOferta(oferta) {
  return normalizarTexto(`${oferta.marca || ""} ${oferta.modelo || ""} ${oferta.producto || ""}`);
}

export function detectarMarca(oferta) {
  const texto = textoOferta(oferta);
  return MARCAS_CONOCIDAS.find((marca) => texto.includes(marca)) ?? null;
}

export function marcaConocida(marca) {
  const m = normalizarTexto(marca);
  return MARCAS_CONOCIDAS.includes(m) ? m : null;
}

// Palabras del modelo con contenido (ej. "K435 KINERGY ECO2"), sin la medida ni
// el indice de carga/velocidad, para medir cuanto del modelo aparece en la oferta.
function tokensModelo(modelo) {
  return normalizarTexto(modelo)
    .split(/[^A-Z0-9]+/)
    .filter((t) => t.length >= 3 && !/^\d+$/.test(t));
}

export function puntajeModelo(oferta, modelo) {
  const tokens = tokensModelo(modelo);
  if (tokens.length === 0) return 0;
  const texto = textoOferta(oferta);
  return tokens.filter((t) => texto.includes(t)).length / tokens.length;
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

// Para un producto con marca conocida: por proveedor, la oferta de esa marca que
// mas se parece al modelo (y entre iguales, la mas barata). Una oferta de otra
// marca nunca se usa -- no se inventa comparacion contra un neumatico distinto.
export function mejorOfertaParaProducto(resultados, marca, modelo) {
  const porProveedor = new Map();
  for (const oferta of resultados) {
    if (!oferta.proveedor) continue;
    const precio = Number(oferta.precio) || 0;
    if (precio <= 0) continue;
    const marcaDetectada = detectarMarca(oferta);
    if (marcaDetectada !== marca) continue;
    const o = { ...oferta, precio, marcaDetectada, proveedorNombre: oferta.proveedor, proveedorKey: oferta.proveedor.trim().toLowerCase() };
    const puntaje = puntajeModelo(o, modelo);
    const actual = porProveedor.get(o.proveedorKey);
    if (!actual || puntaje > actual.puntaje || (puntaje === actual.puntaje && o.precio < actual.precio)) {
      porProveedor.set(o.proveedorKey, { ...o, puntaje });
    }
  }
  return Array.from(porProveedor.values());
}
