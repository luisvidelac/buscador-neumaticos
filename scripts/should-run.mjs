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

let config = POR_DEFECTO;
try {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/settings?clave=eq.scrape_schedule&select=valor`, {
    headers: { apikey: SUPABASE_SERVICE_ROLE_KEY, Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}` },
  });
  const filas = await res.json();
  if (res.ok && filas[0]?.valor) config = { ...POR_DEFECTO, ...filas[0].valor };
} catch (e) {
  console.error("No se pudo leer el horario, se usa el por defecto:", e.message);
}

const partes = Object.fromEntries(
  new Intl.DateTimeFormat("en-US", { timeZone: "America/Santiago", weekday: "short", hour: "2-digit", hourCycle: "h23" })
    .formatToParts(new Date())
    .map((p) => [p.type, p.value])
);
const dia = { Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6, Sun: 7 }[partes.weekday];
const hora = Number(partes.hour);
const horas = (config.horas ?? []).map((h) => Number(String(h).split(":")[0]));

const toca = Boolean(config.activo) && (config.dias ?? []).includes(dia) && horas.includes(hora);
console.error(`Chile: dia ${dia}, hora ${hora}. Programado: dias ${config.dias}, horas ${config.horas}, activo ${config.activo} -> ${toca}`);
console.log(`run=${toca}`);
