import OpenAI from "openai";

let client = null;

if (process.env.OPENAI_API_KEY) {
  client = new OpenAI({
    apiKey: process.env.OPENAI_API_KEY,
  });
}

const MARCAS_CONOCIDAS = [
  "HANKOOK",
  "MICHELIN",
  "BRIDGESTONE",
  "FIRESTONE",
  "PIRELLI",
  "GOODYEAR",
  "DUNLOP",
  "KUMHO",
  "WESTLAKE",
  "ROADX",
  "APTANY",
  "LINGLONG",
  "NEXEN",
  "YOKOHAMA",
  "FALKEN",
  "GOODRIDE",
  "FORTUNE",
  "TRAZANO",
  "KUSTONE",
];

export function extraerMedida(texto = "") {
  const match = String(texto)
    .toUpperCase()
    .match(/(\d{3})\/(\d{2})\s*R(\d{2})/);

  if (!match) return "";

  return `${match[1]}/${match[2]} R${match[3]}`;
}

export function detectarFabricanteBasico(texto = "") {
  const limpio = String(texto).toUpperCase();

  return MARCAS_CONOCIDAS.find((marca) => limpio.includes(marca)) || "";
}

export function normalizarTexto(texto = "") {
  return String(texto)
    .toUpperCase()
    .replace(/\s+/g, " ")
    .replace(/-/g, " ")
    .trim();
}

export async function interpretarBusquedaIA(textoExcel) {
  const medida = extraerMedida(textoExcel);
  const fabricanteBasico = detectarFabricanteBasico(textoExcel);

  if (!client || process.env.USAR_IA !== "true") {
    return {
      textoOriginal: textoExcel,
      medida,
      fabricante: fabricanteBasico,
      modelo: "",
      busqueda: fabricanteBasico ? `${medida} ${fabricanteBasico}` : medida,
    };
  }

  try {
    const prompt = `
Extrae datos de este neumático.

Texto:
"${textoExcel}"

Devuelve SOLO JSON válido con:
{
  "medida": "",
  "fabricante": "",
  "modelo": "",
  "busqueda": ""
}

Reglas:
- medida debe tener formato 225/65 R17.
- fabricante debe ser marca comercial si aparece.
- modelo debe excluir medida y fabricante.
- busqueda debe combinar medida + fabricante + modelo relevante.
`;

    const response = await client.chat.completions.create({
      model: "gpt-4.1-mini",
      messages: [{ role: "user", content: prompt }],
      temperature: 0,
    });

    const content = response.choices[0].message.content;
    const json = JSON.parse(content);

    return {
      textoOriginal: textoExcel,
      medida: json.medida || medida,
      fabricante: json.fabricante || fabricanteBasico,
      modelo: json.modelo || "",
      busqueda:
        json.busqueda ||
        `${json.medida || medida} ${json.fabricante || fabricanteBasico}`.trim(),
    };
  } catch (error) {
    console.log("IA fallback:", error.message);

    return {
      textoOriginal: textoExcel,
      medida,
      fabricante: fabricanteBasico,
      modelo: "",
      busqueda: fabricanteBasico ? `${medida} ${fabricanteBasico}` : medida,
    };
  }
}

export function deduplicarResultados(resultados = []) {
  const mapa = new Map();

  for (const item of resultados) {
    const clave = normalizarTexto(
      `${item.proveedor} ${item.medida} ${item.producto}`
    );

    if (!mapa.has(clave)) {
      mapa.set(clave, item);
    }
  }

  return Array.from(mapa.values());
}

export function elegirMejorPrecio(resultados = []) {
  const validos = resultados.filter(
    (item) => Number(item.precioOferta || item.precio || 0) > 0
  );

  if (validos.length === 0) return null;

  return validos.reduce((mejor, actual) => {
    const precioMejor = Number(mejor.precioOferta || mejor.precio || 0);
    const precioActual = Number(actual.precioOferta || actual.precio || 0);

    return precioActual < precioMejor ? actual : mejor;
  });
}