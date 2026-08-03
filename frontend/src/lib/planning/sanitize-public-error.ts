/**
 * Errores públicos: nunca SQL, stack, Neon, Vercel ni "Failed query".
 */

const SENSITIVE =
  /failed query|neon|vercel|postgres|sql|drizzle|stack|ECONN|password|DATABASE_URL|connection string|relation "|column "|syntax error/i;

export function sanitizePublicErrorMessage(
  err: unknown,
  fallback = "No se pudo completar la operación. Reintentá."
): string {
  if (!(err instanceof Error)) return fallback;
  const message = err.message?.trim() || "";
  if (!message || SENSITIVE.test(message) || message.length > 220) {
    return fallback;
  }
  return message;
}

export function logSanitizedError(
  operationId: string,
  scope: string,
  err: unknown
): void {
  const raw = err instanceof Error ? err.message : String(err);
  const safe = SENSITIVE.test(raw)
    ? `[redacted:${raw.slice(0, 24).replace(/\s+/g, "_")}]`
    : raw.slice(0, 180);
  console.error(`[${scope}] operationId=${operationId} ${safe}`);
}
