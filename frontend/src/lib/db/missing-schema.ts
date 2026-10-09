/**
 * Detección de "la base no tiene la estructura que espera este código" (migración pendiente).
 *
 * Por qué existe (bug de Production, Asignación de lotes tras el PR #112): el código nuevo lee columnas/tablas de la
 * migración 0043. Si el deploy corre ese código contra una base sin 0043, Postgres responde `42703 undefined_column`
 * o `42P01 undefined_table`; eso terminaba en un 500 genérico ("No se pudo completar la operación"), sin rastro en
 * los logs (solo "sanitized server error") y la pantalla caía en silencio a la caché local, donde nada se guarda.
 * Con esto el error se reconoce, se responde 503 con un motivo claro y se registra el código de Postgres (sin SQL ni
 * datos) para poder diagnosticarlo.
 */

/** Códigos SQLSTATE de objeto inexistente (columna, tabla/relación). */
const MISSING_SCHEMA_CODES = new Set(["42703", "42P01"]);

function pgCodeOf(err: unknown): string | null {
  let cur: unknown = err;
  // Drizzle envuelve el error del driver en `cause` (DrizzleQueryError); el driver Neon expone `code`.
  for (let i = 0; i < 4 && cur && typeof cur === "object"; i++) {
    const code = (cur as { code?: unknown }).code;
    if (typeof code === "string" && /^[0-9A-Z]{5}$/.test(code)) return code;
    cur = (cur as { cause?: unknown }).cause;
  }
  return null;
}

/** true si el error es "columna/tabla inexistente" (la base no tiene una migración que este código necesita). */
export function isMissingSchemaError(err: unknown): boolean {
  const code = pgCodeOf(err);
  return code !== null && MISSING_SCHEMA_CODES.has(code);
}

/** Código SQLSTATE del error (si lo hay), para registrar sin exponer SQL ni datos. */
export function sqlStateOf(err: unknown): string | null {
  return pgCodeOf(err);
}
