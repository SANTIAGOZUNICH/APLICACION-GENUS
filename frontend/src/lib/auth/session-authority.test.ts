import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { resolveSessionAuthoritatively } from "./session-authority";

const AUTHENTICATED_USER = {
  email: "produccion@laboratoriogenus.com.ar",
  displayName: "Agustina Zunich",
  sector: "PRODUCCION",
  role: "ROL-SU",
  roleLabel: "Supervisora",
  sectorLabel: "Producción",
  jobTitle: "Supervisora de Planta",
  redirectTo: "/mi-trabajo",
};

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status });
}

/**
 * Regresión: "Sesión vencida" seguía apareciendo de forma intermitente
 * incluso después de canonicalizar el hostname de Preview. Causa raíz real:
 * un único 401 aislado de /api/v1/auth/me (cold start, hiccup transitorio)
 * se trataba como prueba suficiente de sesión vencida, sin reintento ni
 * cruce de evidencia. Esta suite prueba la semántica correcta: solo dos
 * 401 consecutivos confirman sesión vencida; red/500/403-de-otro-endpoint
 * nunca deben confundirse con sesión vencida; validaciones concurrentes
 * comparten una sola resolución (single-flight).
 */
describe("resolveSessionAuthoritatively", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.stubGlobal("fetch", vi.fn());
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  it("401 aislado que se autocorrige (segundo chequeo 200) → sesión sigue válida", async () => {
    vi.mocked(fetch)
      .mockResolvedValueOnce(new Response(null, { status: 401 }))
      .mockResolvedValueOnce(jsonResponse({ user: AUTHENTICATED_USER }));

    const promise = resolveSessionAuthoritatively();
    await vi.runAllTimersAsync();
    const result = await promise;

    expect(result.status).toBe("valid");
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it("401 confirmado dos veces → sesión realmente vencida", async () => {
    vi.mocked(fetch).mockResolvedValue(new Response(null, { status: 401 }));

    const promise = resolveSessionAuthoritatively();
    await vi.runAllTimersAsync();
    const result = await promise;

    expect(result.status).toBe("invalid");
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it("500 del endpoint autoritativo → 'unknown', nunca sesión vencida", async () => {
    vi.mocked(fetch).mockResolvedValue(new Response(null, { status: 500 }));

    const result = await resolveSessionAuthoritatively();

    expect(result.status).toBe("unknown");
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it("error de red → 'unknown', nunca sesión vencida", async () => {
    vi.mocked(fetch).mockRejectedValue(new TypeError("Failed to fetch"));

    const result = await resolveSessionAuthoritatively();

    expect(result.status).toBe("unknown");
  });

  it("200 con payload inesperado → 'unknown', nunca sesión vencida", async () => {
    vi.mocked(fetch).mockResolvedValue(jsonResponse({ user: { email: "x" } }));

    const result = await resolveSessionAuthoritatively();

    expect(result.status).toBe("unknown");
  });

  it("validaciones concurrentes comparten una sola resolución (single-flight)", async () => {
    vi.mocked(fetch).mockResolvedValue(jsonResponse({ user: AUTHENTICATED_USER }));

    const [a, b, c] = await Promise.all([
      resolveSessionAuthoritatively(),
      resolveSessionAuthoritatively(),
      resolveSessionAuthoritatively(),
    ]);

    expect(a.status).toBe("valid");
    expect(b.status).toBe("valid");
    expect(c.status).toBe("valid");
    // Tres llamadas concurrentes → un solo fetch real, no tres.
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it("una validación confirmada no reutiliza resultado stale para la siguiente ronda", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(jsonResponse({ user: AUTHENTICATED_USER }));
    const first = await resolveSessionAuthoritatively();
    expect(first.status).toBe("valid");

    vi.mocked(fetch).mockResolvedValue(new Response(null, { status: 401 }));
    const promise = resolveSessionAuthoritatively();
    await vi.runAllTimersAsync();
    const second = await promise;

    expect(second.status).toBe("invalid");
  });
});
