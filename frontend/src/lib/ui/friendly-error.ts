/**
 * Mensajes de error para el operario: nunca «HTTP 409», «Error 500», «Failed to fetch» ni texto técnico de
 * JavaScript/SQL. Siempre qué pasó y qué hacer. Lo que el servidor ya explica en castellano se muestra tal cual.
 */
const TECNICO = /(failed query|relation "|column "|cannot read|undefined|is not a function|is not defined|typeerror|referenceerror|syntaxerror|unexpected token|json|stack|sql|postgres|neon|drizzle|ECONN|fetch failed)/i;
const RED = /^(failed to fetch|networkerror|load failed|network request failed|the network connection was lost)/i;

export function friendlyHttpStatus(status: number): string {
  if (status === 0) return "Sin conexión con el servidor: el cambio no se guardó. Revisá la conexión y volvé a intentar.";
  if (status === 401) return "Tu sesión venció. Volvé a iniciar sesión (lo que escribiste sigue en pantalla).";
  if (status === 403) return "Tu sector no tiene permiso para hacer este cambio.";
  if (status === 404) return "El registro ya no existe (lo borraron o lo movieron). Recargá la página.";
  if (status === 409) return "Otra persona modificó este registro al mismo tiempo. Recargá y volvé a aplicar tu cambio.";
  if (status === 400 || status === 422) return "Algún dato no es válido. Revisalo y volvé a intentar.";
  if (status === 503) return "El sistema está en mantenimiento o no disponible. Volvé a intentar en unos minutos.";
  if (status >= 500) return "El servidor tuvo un problema y no guardó el cambio. Volvé a intentar en unos segundos; si sigue, avisá a Sistemas.";
  return "No se pudo completar la operación. Volvé a intentar.";
}

/** Mensaje del servidor si es legible; si es técnico o falta, el mensaje simple según el estado HTTP. */
export function friendlyServerMessage(status: number, serverMessage: unknown): string {
  const msg = typeof serverMessage === "string" ? serverMessage.trim() : "";
  if (msg && !TECNICO.test(msg) && !/^(HTTP|Error) \d{3}/.test(msg)) return msg;
  return friendlyHttpStatus(status);
}

/** Para un error ya lanzado (fetch caído, Error con mensaje técnico, «HTTP 409»…). */
export function friendlySaveError(err: unknown, fallback = "No se pudo guardar."): string {
  const e = err as { message?: unknown; status?: unknown } | null;
  const msg = typeof e?.message === "string" ? e.message.trim() : "";
  if (RED.test(msg)) return friendlyHttpStatus(0);
  const coded = /^(?:HTTP|Error) (\d{3})/.exec(msg);
  if (coded) return friendlyHttpStatus(Number(coded[1]));
  if (!msg || TECNICO.test(msg)) {
    return typeof e?.status === "number" ? friendlyHttpStatus(e.status) : `${fallback} Volvé a intentar; si sigue, avisá a Sistemas.`;
  }
  return msg;
}
