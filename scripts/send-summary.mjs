import "dotenv/config";
import { createClient } from "@supabase/supabase-js";
import * as XLSX from "xlsx";

// Envia por correo el resumen de precios de todos los productos seguidos:
// precio AZedan, mejor precio de la competencia, diferencia y estado.
// Destinatarios y si se envia o no salen de settings.scrape_schedule.

// Sin dominio verificado en Resend, el remitente debe ser onboarding@resend.dev
// y solo se puede enviar al correo duenno de la cuenta Resend.
const { SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, RESEND_API_KEY } = process.env;
const RESEND_FROM = process.env.RESEND_FROM || "AZedan Price Intelligence <onboarding@resend.dev>";
const APP_URL = "https://azedan-price-intel.vercel.app/comparador";

if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
  console.error("Faltan SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY");
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

const { data: settingRow } = await supabase.from("settings").select("valor").eq("clave", "scrape_schedule").maybeSingle();
const config = settingRow?.valor ?? {};
const destinatarios = (config.destinatarios ?? []).filter(Boolean);

// DRY_RUN=carpeta: arma el correo y el Excel en esa carpeta sin enviar nada.
const DRY_RUN = process.env.DRY_RUN;

if (!DRY_RUN && (!config.enviar_correo || destinatarios.length === 0)) {
  console.log("Resumen por correo desactivado o sin destinatarios; no se envia.");
  process.exit(0);
}
if (!DRY_RUN && !RESEND_API_KEY) {
  console.log("Falta el secreto RESEND_API_KEY; no se envia el resumen.");
  process.exit(0);
}

const [{ data: products, error: productsError }, { data: providers }] = await Promise.all([
  supabase.from("products").select("*").eq("activo", true).order("medida_normalizada"),
  supabase.from("providers").select("id, nombre"),
]);
if (productsError) {
  console.error("Error cargando productos:", productsError.message);
  process.exit(1);
}
const providerById = new Map((providers ?? []).map((p) => [p.id, p.nombre]));

const productIds = products.map((p) => p.id);
const offers = [];
for (let desde = 0; productIds.length > 0; desde += 1000) {
  const { data, error } = await supabase.from("competitor_prices").select("*").in("producto_id", productIds).range(desde, desde + 999);
  if (error) {
    console.error("Error cargando precios:", error.message);
    process.exit(1);
  }
  offers.push(...data);
  if (data.length < 1000) break;
}

// Mismos umbrales que src/domain/competitiveStatus.ts del PoC.
function estado(dif) {
  if (dif === null) return "Sin informacion";
  if (dif <= 0) return "AZedan mejor precio";
  if (dif <= 5) return "Competitivo";
  if (dif <= 15) return "Revisar precio";
  return "Fuera de mercado";
}

const filas = products.map((p) => {
  // Por proveedor, la consulta mas reciente.
  const ultima = new Map();
  for (const o of offers) {
    if (o.producto_id !== p.id) continue;
    const actual = ultima.get(o.proveedor_id);
    if (!actual || o.fecha_consulta > actual.fecha_consulta) ultima.set(o.proveedor_id, o);
  }
  const vigentes = Array.from(ultima.values()).sort((a, b) => a.precio_utilizado - b.precio_utilizado);
  const mejor = vigentes[0] ?? null;
  const azedan = p.precio_pendiente ? null : Number(p.precio_azedan);
  const dif = azedan && mejor ? (azedan / mejor.precio_utilizado - 1) * 100 : null;
  return {
    medida: p.medida_normalizada,
    producto: `${p.marca} ${p.modelo}`,
    azedanNormal: p.precio_azedan_normal ? Number(p.precio_azedan_normal) : null,
    azedanOferta: azedan,
    mejorPrecio: mejor?.precio_utilizado ?? null,
    mejorProveedor: mejor ? providerById.get(mejor.proveedor_id) ?? "" : "",
    proveedores: vigentes.length,
    diferencia: dif,
    estado: azedan ? estado(mejor ? dif : null) : "Precio pendiente",
  };
});

const clp = (n) => (n == null ? "—" : `$${Math.round(n).toLocaleString("es-CL")}`);
const conteo = filas.reduce((acc, f) => ((acc[f.estado] = (acc[f.estado] ?? 0) + 1), acc), {});
const colorEstado = {
  "AZedan mejor precio": "#047857",
  Competitivo: "#1d4ed8",
  "Revisar precio": "#b45309",
  "Fuera de mercado": "#DF0024",
};
const fecha = new Intl.DateTimeFormat("es-CL", { dateStyle: "full", timeStyle: "short", timeZone: "America/Santiago" }).format(new Date());

const html = `
<div style="font-family:Inter,Arial,sans-serif;color:#0f172a">
  <div style="background:#020617;color:#fff;padding:16px 20px">
    <strong style="font-size:18px">AZedan Price Intelligence</strong><br>
    <span style="color:#94a3b8;font-size:13px">Resumen de precios · ${fecha}</span>
  </div>
  <p style="font-size:14px">${filas.length} productos seguidos:
    ${Object.entries(conteo).map(([e, n]) => `<b style="color:${colorEstado[e] ?? "#475569"}">${n} ${e}</b>`).join(" · ")}
  </p>
  <table cellpadding="6" cellspacing="0" style="border-collapse:collapse;font-size:13px;width:100%">
    <thead><tr style="background:#f1f5f9;text-align:left">
      <th>Medida</th><th>Producto</th><th>AZedan normal</th><th>AZedan oferta</th><th>Mejor competencia</th><th>Diferencia</th><th>Estado</th>
    </tr></thead>
    <tbody>
      ${filas
        .map(
          (f) => `<tr style="border-top:1px solid #e2e8f0">
        <td>${f.medida}</td><td>${f.producto}</td>
        <td style="color:#64748b">${clp(f.azedanNormal)}</td><td><b>${clp(f.azedanOferta)}</b></td>
        <td>${f.mejorPrecio ? `${clp(f.mejorPrecio)} <span style="color:#64748b">(${f.mejorProveedor})</span>` : "—"}</td>
        <td>${f.diferencia == null ? "—" : `${f.diferencia.toFixed(1)}%`}</td>
        <td style="color:${colorEstado[f.estado] ?? "#475569"}">${f.estado}</td>
      </tr>`
        )
        .join("")}
    </tbody>
  </table>
  <p style="font-size:12px;color:#64748b">Diferencia = AZedan oferta vs. el menor precio vigente de la competencia (misma marca).
    Todos los proveedores y precios en el Excel adjunto y en <a href="${APP_URL}">el comparador</a>.</p>
</div>`;

// Excel adjunto: el mismo formato que "Exportar analisis" del Comparador -- una
// fila por producto, una columna por proveedor (su precio vigente), diferencia y
// estado -- mas una hoja con el detalle de cada precio encontrado.
const libro = XLSX.utils.book_new();
const vigentesPorProducto = new Map();
for (const o of offers) {
  const m = vigentesPorProducto.get(o.producto_id) ?? new Map();
  const actual = m.get(o.proveedor_id);
  if (!actual || o.fecha_consulta > actual.fecha_consulta) m.set(o.proveedor_id, o);
  vigentesPorProducto.set(o.producto_id, m);
}
const columnas = Array.from(new Set(offers.map((o) => o.proveedor_id)))
  .map((id) => ({ id, nombre: providerById.get(id) ?? "" }))
  .sort((x, y) => x.nombre.localeCompare(y.nombre));
const encabezado = ["Medida", "Marca / Modelo", "Detalle", "AZedan normal", "AZedan oferta", ...columnas.map((c) => c.nombre), "Diferencia %", "Estado"];
const filasExcel = products.map((p, i) => {
  const vigentes = vigentesPorProducto.get(p.id) ?? new Map();
  const f = filas[i];
  return [
    p.medida_normalizada,
    `${p.marca} ${p.modelo}`,
    p.indice_carga_velocidad ?? "",
    f.azedanNormal ?? "",
    f.azedanOferta ?? (p.azedan_buscado_en ? "No encontrado en azedan.cl" : ""),
    ...columnas.map((c) => vigentes.get(c.id)?.precio_utilizado ?? ""),
    f.diferencia == null ? "" : Number(f.diferencia.toFixed(1)),
    f.estado,
  ];
});
XLSX.utils.book_append_sheet(libro, XLSX.utils.aoa_to_sheet([encabezado, ...filasExcel]), "Comparador");
const detalle = [];
for (const p of products) {
  const ultima = new Map();
  for (const o of offers) {
    if (o.producto_id !== p.id) continue;
    const actual = ultima.get(o.proveedor_id);
    if (!actual || o.fecha_consulta > actual.fecha_consulta) ultima.set(o.proveedor_id, o);
  }
  for (const o of ultima.values()) {
    detalle.push({
      Medida: p.medida_normalizada,
      Producto: `${p.marca} ${p.modelo}`,
      Proveedor: providerById.get(o.proveedor_id) ?? "",
      "Neumatico encontrado": o.descripcion_encontrada ?? o.modelo_encontrado ?? "",
      "Precio oferta": o.precio_utilizado,
      "Precio normal": o.precio_normal,
      "Precio transferencia": o.precio_efectivo,
      "Consultado el": o.fecha_consulta,
      Link: o.url_producto,
    });
  }
}
XLSX.utils.book_append_sheet(libro, XLSX.utils.json_to_sheet(detalle), "Detalle por proveedor");
const adjunto = XLSX.write(libro, { type: "buffer", bookType: "xlsx" });

// Fecha de Chile (a las 21:00 en Chile ya es el dia siguiente en UTC).
const dia = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Santiago" }).format(new Date());

if (DRY_RUN) {
  const fs = await import("fs");
  fs.mkdirSync(DRY_RUN, { recursive: true });
  fs.writeFileSync(`${DRY_RUN}/resumen.html`, html);
  fs.writeFileSync(`${DRY_RUN}/resumen.xlsx`, adjunto);
  console.log(`DRY_RUN: ${filas.length} productos, ${detalle.length} precios de detalle -> ${DRY_RUN}`);
  process.exit(0);
}

const respuesta = await fetch("https://api.resend.com/emails", {
  method: "POST",
  headers: { Authorization: `Bearer ${RESEND_API_KEY}`, "Content-Type": "application/json" },
  body: JSON.stringify({
    from: RESEND_FROM,
    to: destinatarios,
    subject: `Resumen de precios AZedan · ${dia}`,
    html,
    attachments: [{ filename: `comparador_azedan_${dia}.xlsx`, content: Buffer.from(adjunto).toString("base64") }],
  }),
});
const cuerpo = await respuesta.json().catch(() => ({}));
if (!respuesta.ok) {
  console.error("Resend rechazo el envio:", respuesta.status, JSON.stringify(cuerpo));
  process.exit(1);
}

// El repo es publico y los logs de Actions tambien: no imprimir los correos.
console.log(`Resumen enviado a ${destinatarios.length} destinatario(s) (${filas.length} productos). id=${cuerpo.id}`);
