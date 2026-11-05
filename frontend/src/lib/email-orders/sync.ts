/**
 * Reglas PURAS de la sincronización de pedidos por email: ventana de búsqueda, estado REAL de una corrida (nunca «éxito» si no se
 * creó nada sin explicarlo) y decisión pedido / no pedido / «a revisar». Sin I/O: se prueban sin Gmail ni base.
 */
import type { RawExtraction } from "./types";

export type SyncTrigger = "manual" | "cron" | "backfill";
export type RunStatus =
  | "ok" // se crearon borradores
  | "sin_borradores" // se leyó Gmail, pero no quedó ningún borrador (todo ya visto / excluido / sin pedido)
  | "sin_correos" // Gmail no devolvió ningún correo en la ventana
  | "parcial" // hubo borradores pero también correos con error
  | "error" // todo lo analizable falló
  | "error_gmail" // no se pudo leer Gmail
  | "error_ia" // la IA no está disponible
  | "no_conectada"; // la casilla no está conectada

export const WINDOW_OPTIONS = [2, 7, 15, 30] as const;
export type WindowDays = (typeof WINDOW_OPTIONS)[number];

/** Ventana de búsqueda en días (solo valores permitidos; cualquier otro → null = «solo lo reciente»). */
export function parseWindowDays(v: unknown): WindowDays | null {
  const n = Number(v);
  return (WINDOW_OPTIONS as readonly number[]).includes(n) ? (n as WindowDays) : null;
}

/** AAAA-MM-DD de hace `days` días (UTC; el filtro `after:` de Gmail trabaja por día). */
export function afterDateForWindow(days: number, now: Date = new Date()): string {
  const d = new Date(now.getTime() - days * 86_400_000);
  return d.toISOString().slice(0, 10);
}

export type RunCounts = {
  found: number;
  scanned: number;
  analyzed: number;
  drafts: number;
  excluded: number;
  withoutOrder: number;
  alreadyProcessed: number;
  errors: number;
};

/** Estado y explicación de una corrida que SÍ leyó Gmail. */
export function summarizeRun(c: RunCounts, windowLabel: string): { status: RunStatus; reason: string } {
  if (c.found === 0) {
    return { status: "sin_correos", reason: `Gmail no devolvió ningún correo en la bandeja de entrada ${windowLabel}. Si esperabas pedidos, revisá que Webnode reenvíe a la cuenta conectada y que no estén en otra carpeta.` };
  }
  if (c.drafts > 0) {
    return c.errors > 0
      ? { status: "parcial", reason: `${c.drafts} borrador(es) creado(s); ${c.errors} correo(s) con error se reintentarán.` }
      : { status: "ok", reason: `${c.drafts} borrador(es) creado(s) para revisar.` };
  }
  if (c.errors > 0 && c.analyzed === 0) {
    return { status: "error", reason: `${c.errors} correo(s) fallaron al analizarse: no se creó ningún borrador. Se pueden reintentar.` };
  }
  const parts: string[] = [];
  if (c.alreadyProcessed) parts.push(`${c.alreadyProcessed} ya estaban procesado(s)`);
  if (c.excluded) parts.push(`${c.excluded} excluido(s) por no poder verificar que iban a la casilla de pedidos`);
  if (c.withoutOrder) parts.push(`${c.withoutOrder} sin pedido (consultas u otros asuntos)`);
  if (c.errors) parts.push(`${c.errors} con error`);
  return { status: "sin_borradores", reason: `No se creó ningún borrador: de ${c.found} correo(s) encontrados, ${parts.join(", ") || "ninguno era un pedido nuevo"}.` };
}

/** Texto corto del estado para la pantalla (nunca «correcto» si no hubo borradores). */
export const RUN_STATUS_LABEL: Record<RunStatus, string> = {
  ok: "Borradores creados",
  sin_borradores: "Sin borradores nuevos",
  sin_correos: "Sin correos en Gmail",
  parcial: "Con errores parciales",
  error: "Con errores",
  error_gmail: "No se pudo leer Gmail",
  error_ia: "IA no disponible",
  no_conectada: "Casilla no conectada",
};

/**
 * ¿Qué hacer con un correo ya interpretado? Solo se OMITE cuando la IA está segura de que NO es un pedido. Ante la duda (confianza baja/media,
 * o menciona un pedido sin poder leer los productos) queda un BORRADOR «a revisar»: Producción decide; nunca se inventan cantidades.
 */
export function decideOutcome(ex: Pick<RawExtraction, "kind" | "confidence" | "items" | "cliente">): { action: "omitir" | "borrador"; uncertain: boolean; reason: string } {
  const nonOrder = ex.kind === "consulta" || ex.kind === "no_relacionado";
  if (nonOrder) {
    if (ex.confidence === "alta" && ex.items.length === 0) return { action: "omitir", uncertain: false, reason: ex.kind === "consulta" ? "Consulta, sin pedido" : "No relacionado con pedidos" };
    return { action: "borrador", uncertain: true, reason: `La IA lo leyó como «${ex.kind === "consulta" ? "consulta" : "no relacionado"}» pero no con certeza` };
  }
  if (ex.items.length === 0 && !ex.cliente && ex.confidence === "alta") return { action: "omitir", uncertain: false, reason: "Sin productos ni cliente" };
  return { action: "borrador", uncertain: ex.confidence === "baja", reason: "" };
}

/** Mensaje de Gmail legible, SIN datos sensibles (nunca el token ni el cuerpo): qué hacer según el error de Google. */
export function describeGmailError(err: unknown): { message: string; reconnect: boolean } {
  const e = err as { code?: number | string; message?: string; response?: { data?: { error?: string | { message?: string } } } } | null;
  const raw = `${e?.message ?? ""} ${typeof e?.response?.data?.error === "string" ? e.response.data.error : (e?.response?.data?.error as { message?: string } | undefined)?.message ?? ""}`.toLowerCase();
  if (/invalid_grant|token has been expired or revoked|invalid_rapt/.test(raw)) return { message: "El acceso a Gmail venció o fue revocado: reconectá la cuenta de pedidos.", reconnect: true };
  if (/invalid_client|unauthorized_client/.test(raw)) return { message: "Las credenciales OAuth de Gmail (ID de cliente / secreto) no son válidas en este entorno.", reconnect: false };
  if (/insufficient|scope|permission_denied|forbidden/.test(raw) || e?.code === 403) return { message: "Google rechazó el acceso a la casilla (403): la Gmail API no está habilitada en el proyecto o falta el permiso de lectura.", reconnect: true };
  if (/rate|quota|429/.test(raw) || e?.code === 429) return { message: "Google limitó temporalmente las consultas a Gmail (cuota). Se reintenta más tarde.", reconnect: false };
  if (/enotfound|econnreset|etimedout|network|fetch failed/.test(raw)) return { message: "No se pudo conectar con Gmail (red). Se reintenta más tarde.", reconnect: false };
  if (e?.code === 401 || /401|invalid credentials/.test(raw)) return { message: "Gmail rechazó las credenciales (401): reconectá la cuenta de pedidos.", reconnect: true };
  return { message: "No se pudo leer Gmail. Si el problema sigue, reconectá la cuenta.", reconnect: false };
}
