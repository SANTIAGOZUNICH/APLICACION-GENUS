/**
 * Validación autoritativa de sesión (client-side).
 *
 * Bug real (PR #74, "Sesión vencida" intermitente incluso después de
 * canonicalizar el hostname de Preview): tanto connection-monitor.ts como
 * genus-auth-adapter.ts (hydrateSession) hacían CADA UNO su propio fetch
 * aislado a /api/v1/auth/me y trataban un único 401 como prueba suficiente
 * de sesión vencida — sin reintento ni cruce de evidencia. Un 401
 * transitorio (cold start de función serverless, hiccup breve de Neon,
 * contención bajo carga concurrente) alcanzaba para disparar el banner
 * aunque la sesión siguiera siendo válida un instante después.
 *
 * Este módulo centraliza esa decisión: un único 401 NO es suficiente —
 * se reconfirma una vez antes de declarar la sesión realmente vencida.
 * Single-flight: llamadas concurrentes (p. ej. el tick del monitor de
 * conexión y un hydrateSession en el mismo instante) comparten la misma
 * promesa en vez de disparar N fetches y N reacciones independientes.
 */

export interface AuthenticatedUserPayload {
  email: string;
  displayName: string;
  sector: string;
  role: string;
  roleLabel: string;
  sectorLabel: string;
  jobTitle: string;
  redirectTo: string;
}

export type SessionAuthorityResult =
  | { status: "valid"; user: AuthenticatedUserPayload }
  | { status: "invalid" }
  | { status: "unknown" };

/** Espera antes de reconfirmar un primer 401 — suficiente para dejar pasar
 *  un hiccup puntual sin retrasar de forma perceptible una expiración real. */
const CONFIRM_DELAY_MS = 400;

function isAuthenticatedUserPayload(value: unknown): value is AuthenticatedUserPayload {
  if (!value || typeof value !== "object") return false;
  const u = value as Record<string, unknown>;
  return (
    typeof u.email === "string" &&
    typeof u.displayName === "string" &&
    typeof u.sector === "string" &&
    typeof u.role === "string" &&
    typeof u.roleLabel === "string" &&
    typeof u.sectorLabel === "string" &&
    typeof u.jobTitle === "string" &&
    typeof u.redirectTo === "string"
  );
}

async function checkAuthMeOnce(): Promise<SessionAuthorityResult> {
  try {
    const res = await fetch("/api/v1/auth/me", {
      method: "GET",
      cache: "no-store",
      credentials: "include",
    });
    if (res.status === 401) return { status: "invalid" };
    if (!res.ok) return { status: "unknown" };
    const payload = (await res.json().catch(() => null)) as { user?: unknown } | null;
    if (payload && isAuthenticatedUserPayload(payload.user)) {
      return { status: "valid", user: payload.user };
    }
    return { status: "unknown" };
  } catch {
    // Error de red — no hay evidencia de que la sesión sea inválida.
    return { status: "unknown" };
  }
}

function logDiagnostic(
  event: "confirmed_invalid" | "transient_401_recovered",
  detail: Record<string, unknown>
): void {
  if (typeof window === "undefined") return;
  try {
    // Diagnóstico temporal para trazar falsos "Sesión vencida" — nunca
    // incluye cookie/token/contraseña, solo metadata de la request.
    console.warn("[genus-os:session-authority]", event, {
      at: new Date().toISOString(),
      pathname: window.location.pathname,
      hostname: window.location.hostname,
      ...detail,
    });
  } catch {
    /* noop — el diagnóstico nunca debe romper el flujo de auth */
  }
}

let inFlight: Promise<SessionAuthorityResult> | null = null;

/**
 * Resuelve el estado real de la sesión contra /api/v1/auth/me.
 * - "invalid" solo se devuelve si DOS chequeos consecutivos (con una espera
 *   corta entre medio) confirman 401 — descarta un 401 aislado/transitorio.
 * - "unknown" cubre red caída, 500, o una respuesta 200 con payload
 *   inesperado: nunca se interpreta como sesión vencida.
 * - Single-flight: si ya hay una resolución en curso, la reutiliza.
 */
export function resolveSessionAuthoritatively(): Promise<SessionAuthorityResult> {
  if (inFlight) return inFlight;
  inFlight = (async () => {
    const first = await checkAuthMeOnce();
    if (first.status !== "invalid") return first;

    await new Promise((resolve) => setTimeout(resolve, CONFIRM_DELAY_MS));
    const second = await checkAuthMeOnce();

    if (second.status === "invalid") {
      logDiagnostic("confirmed_invalid", { firstStatus: first.status, secondStatus: second.status });
    } else {
      logDiagnostic("transient_401_recovered", { secondStatus: second.status });
    }
    return second;
  })();
  return inFlight.finally(() => {
    inFlight = null;
  });
}
