/**
 * Guardas de seguridad del E2E local (Plan semanal y futuros).
 *
 * El E2E escribe en la base (crea semanas/trabajos, edita celdas). Por eso SOLO corre si TODO esto se cumple:
 *   1. No estamos en Vercel ni en un entorno marcado como producción (VERCEL, VERCEL_ENV, GENUS_ENV, NODE_ENV).
 *   2. Confirmación explícita: GENUS_E2E_CONFIRM_DISPOSABLE_DB=yes.
 *   3. La base es local (localhost / 127.0.0.1 / ::1). Una base remota exige además GENUS_E2E_ALLOW_REMOTE_DB=yes
 *      (pensado para una rama Neon DESCARTABLE, nunca la principal).
 *   4. La app bajo prueba es local (http://localhost o http://127.0.0.1): nunca un deploy de Vercel.
 *   5. La base tiene la marca `genus_e2e_marker`, que el setup SOLO crea en una base vacía.
 *      Una base con datos y sin marca (p. ej. Production o Preview) se rechaza siempre.
 */

export const E2E_MARKER_TABLE = "genus_e2e_marker";
const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1", "::1", "[::1]"]);

export class E2eSafetyError extends Error {
  constructor(message) {
    super(`[e2e-safety] ${message}`);
    this.name = "E2eSafetyError";
  }
}

/**
 * Motivo por el que el entorno NO es apto (null = apto). No lanza: lo usan los tests para saltarse solos.
 * @param {Record<string, string | undefined>} [env]
 * @returns {string | null}
 */
export function e2eEnvironmentProblem(env = process.env) {
  if (env.VERCEL || env.VERCEL_ENV) return "corre dentro de Vercel (VERCEL/VERCEL_ENV definidos)";
  if (env.GENUS_ENV === "production") return "GENUS_ENV=production";
  if (env.NODE_ENV === "production") return "NODE_ENV=production en el proceso del E2E";
  if (env.GENUS_E2E_CONFIRM_DISPOSABLE_DB !== "yes") return "falta GENUS_E2E_CONFIRM_DISPOSABLE_DB=yes";
  const dbUrl = env.GENUS_E2E_DATABASE_URL?.trim();
  if (!dbUrl) return "falta GENUS_E2E_DATABASE_URL";
  let dbHost;
  try {
    dbHost = new URL(dbUrl).hostname;
  } catch {
    return "GENUS_E2E_DATABASE_URL no es una URL válida";
  }
  if (!LOCAL_HOSTS.has(dbHost) && env.GENUS_E2E_ALLOW_REMOTE_DB !== "yes") {
    return `la base no es local (${dbHost}); para una rama Neon descartable usar GENUS_E2E_ALLOW_REMOTE_DB=yes`;
  }
  const baseUrl = env.GENUS_E2E_BASE_URL?.trim();
  if (baseUrl) {
    let u;
    try {
      u = new URL(baseUrl);
    } catch {
      return "GENUS_E2E_BASE_URL no es una URL válida";
    }
    if (u.protocol !== "http:" || !LOCAL_HOSTS.has(u.hostname)) {
      return `GENUS_E2E_BASE_URL debe ser una app local (http://localhost:PUERTO), no ${u.origin}`;
    }
  }
  return null;
}

/** @param {Record<string, string | undefined>} [env] */
export function assertE2eEnvironment(env = process.env) {
  const problem = e2eEnvironmentProblem(env);
  if (problem) throw new E2eSafetyError(`entorno no apto para escribir: ${problem}`);
}

/**
 * La base debe tener la marca creada por el setup (nunca existe en Production/Preview).
 * @param {(sql: string) => Promise<Record<string, unknown>[]>} query
 */
export async function assertMarkedDatabase(query) {
  const rows = await query(`select to_regclass('public.${E2E_MARKER_TABLE}') as reg`);
  if (!rows[0]?.reg) {
    throw new E2eSafetyError(
      `la base no tiene la marca ${E2E_MARKER_TABLE}: no es una base de prueba creada por scripts/e2e/setup-e2e-db.mjs`
    );
  }
  const marks = await query(`select purpose from ${E2E_MARKER_TABLE} limit 1`);
  if (marks[0]?.purpose !== "genus-e2e-disposable") {
    throw new E2eSafetyError(`marca ${E2E_MARKER_TABLE} inválida`);
  }
}
