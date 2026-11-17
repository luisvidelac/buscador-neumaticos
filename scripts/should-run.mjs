// El cron de GitHub corre cada hora; este paso decide si a esta hora (Chile)
// toca la corrida programada segun settings.scrape_schedule (Administracion).
// Sin dependencias (fetch nativo) para no instalar nada si no toca correr.
// Imprime "run=true|false" para $GITHUB_OUTPUT.

const { SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, EVENT_NAME } = process.env;

if (EVENT_NAME !== "schedule") {
  console.log("run=true");
  process.exit(0);
}

const POR_DEFECTO = { activo: true, dias: [1, 2, 3, 4, 5, 6, 7], horas: ["10:00"] };
const headers = { apikey: SUPABASE_SERVICE_ROLE_KEY, Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}` };

async function leerSetting(clave) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/settings?clave=eq.${clave}&select=valor`, { headers });
  const filas = await res.json();
  return res.ok ? filas[0]?.valor : undefined;
}

let config = POR_DEFECTO;
let ultima = "";
try {
  const valor = await leerSetting("scrape_schedule");
  if (valor) config = { ...POR_DEFECTO, ...valor };
  ultima = (await leerSetting("scrape_ultima_programada"))?.turno ?? "";
} catch (e) {
  console.error("No se pudo leer el horario, se usa el por defecto:", e.message);
}

const partes = Object.fromEntries(
  new Intl.DateTimeFormat("en-US", {
    timeZone: "America/Santiago", weekday: "short", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", hourCycle: "h23",
  })
    .formatToParts(new Date())
    .map((p) => [p.type, p.value])
);
const dia = { Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6, Sun: 7 }[partes.weekday];
const hora = Number(partes.hour);
const fecha = `${partes.year}-${partes.month}-${partes.day}`;
const horas = (config.horas ?? []).map((h) => Number(String(h).split(":")[0]));

// GitHub no garantiza el cron horario (a veces corre solo unas pocas veces al
// dia), asi que no se exige caer justo en la hora: toca si la ultima hora
// programada de hoy ya paso y ese turno todavia no se ejecuto.
const pasadas = horas.filter((h) => h <= hora);
const turno = pasadas.length ? `${fecha} ${String(Math.max(...pasadas)).padStart(2, "0")}` : "";
const toca = Boolean(config.activo) && (config.dias ?? []).includes(dia) && turno !== "" && turno > ultima;
console.error(`Chile: ${fecha} dia ${dia}, hora ${hora}. Programado: dias ${config.dias}, horas ${config.horas}, activo ${config.activo}. Ultimo turno: ${ultima || "ninguno"} -> ${toca}`);

if (toca) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/settings?on_conflict=clave`, {
    method: "POST",
    headers: { ...headers, "Content-Type": "application/json", Prefer: "resolution=merge-duplicates" },
    body: JSON.stringify({ clave: "scrape_ultima_programada", valor: { turno } }),
  });
  if (!res.ok) console.error("No se pudo guardar el turno:", res.status, await res.text());
}
console.log(`run=${toca}`);
