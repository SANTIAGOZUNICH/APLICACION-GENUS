/**
 * @vitest-environment happy-dom
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

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

async function loadFreshConnectionMonitor() {
  vi.resetModules();
  return import("./connection-monitor");
}

/**
 * Regresión: "Sesión vencida" seguía apareciendo de forma intermitente aun
 * con sesión válida. El monitor de conexión hacía un único fetch aislado a
 * /api/v1/auth/me por tick y trataba cualquier 401 como sesión vencida sin
 * reconfirmar — un hiccup transitorio bastaba para disparar el banner.
 * Ahora delega en session-authority.ts (confirmación + single-flight).
 */
describe("connection-monitor — sesión autoritativa", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    Object.defineProperty(window, "location", {
      value: { pathname: "/mi-trabajo", hostname: "test.local" },
      writable: true,
      configurable: true,
    });
    Object.defineProperty(window.navigator, "onLine", {
      value: true,
      writable: true,
      configurable: true,
    });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  it("401 aislado en /auth/me que se autocorrige NO dispara Sesión vencida", async () => {
    let authMeCalls = 0;
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL) => {
        const url = String(input);
        if (url.includes("/api/v1/connectivity")) return new Response(null, { status: 200 });
        if (url.includes("/api/v1/auth/me")) {
          authMeCalls += 1;
          return authMeCalls === 1
            ? new Response(null, { status: 401 })
            : jsonResponse({ user: AUTHENTICATED_USER });
        }
        return new Response(null, { status: 404 });
      })
    );

    const { startConnectionMonitor, getConnectionStatus, subscribeConnectionStatus } =
      await loadFreshConnectionMonitor();
    const statuses: string[] = [];
    const unsubscribe = subscribeConnectionStatus((s) => statuses.push(s));
    const stop = startConnectionMonitor();

    await vi.advanceTimersByTimeAsync(600);

    expect(getConnectionStatus()).toBe("CONNECTED");
    expect(statuses).not.toContain("SESION_VENCIDA");
    expect(authMeCalls).toBe(2);

    unsubscribe();
    stop();
  });

  it("401 confirmado dos veces dispara Sesión vencida una única vez", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL) => {
        const url = String(input);
        if (url.includes("/api/v1/connectivity")) return new Response(null, { status: 200 });
        if (url.includes("/api/v1/auth/me")) return new Response(null, { status: 401 });
        return new Response(null, { status: 404 });
      })
    );

    const { startConnectionMonitor, getConnectionStatus, subscribeConnectionStatus } =
      await loadFreshConnectionMonitor();
    const statuses: string[] = [];
    const unsubscribe = subscribeConnectionStatus((s) => statuses.push(s));
    const stop = startConnectionMonitor();

    await vi.advanceTimersByTimeAsync(600);

    expect(getConnectionStatus()).toBe("SESION_VENCIDA");
    // Una sola transición a SESION_VENCIDA (emit() ignora no-cambios de estado).
    expect(statuses.filter((s) => s === "SESION_VENCIDA")).toHaveLength(1);

    unsubscribe();
    stop();
  });

  it("error de red en /connectivity (offline) → SIN_CONEXION, nunca Sesión vencida", async () => {
    Object.defineProperty(window.navigator, "onLine", {
      value: false,
      writable: true,
      configurable: true,
    });
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new TypeError("Failed to fetch");
      })
    );

    const { startConnectionMonitor, getConnectionStatus } = await loadFreshConnectionMonitor();
    const stop = startConnectionMonitor();

    await vi.advanceTimersByTimeAsync(600);

    expect(getConnectionStatus()).toBe("SIN_CONEXION");
    stop();
  });

  it("error de red en /connectivity (online pero server caído) → SERVIDOR_NO_DISPONIBLE, nunca Sesión vencida", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new TypeError("Failed to fetch");
      })
    );

    const { startConnectionMonitor, getConnectionStatus } = await loadFreshConnectionMonitor();
    const stop = startConnectionMonitor();

    await vi.advanceTimersByTimeAsync(600);

    expect(getConnectionStatus()).toBe("SERVIDOR_NO_DISPONIBLE");
    stop();
  });

  it("500 en /auth/me (servidor, no auth) → sesión sigue CONNECTED, no Sesión vencida", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL) => {
        const url = String(input);
        if (url.includes("/api/v1/connectivity")) return new Response(null, { status: 200 });
        if (url.includes("/api/v1/auth/me")) return new Response(null, { status: 500 });
        return new Response(null, { status: 404 });
      })
    );

    const { startConnectionMonitor, getConnectionStatus } = await loadFreshConnectionMonitor();
    const stop = startConnectionMonitor();

    await vi.advanceTimersByTimeAsync(600);

    expect(getConnectionStatus()).toBe("CONNECTED");
    stop();
  });

  it("navegación normal (path /login) no dispara chequeo de sesión", async () => {
    Object.defineProperty(window, "location", {
      value: { pathname: "/login", hostname: "test.local" },
      writable: true,
      configurable: true,
    });
    let authMeCalls = 0;
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL) => {
        const url = String(input);
        if (url.includes("/api/v1/connectivity")) return new Response(null, { status: 200 });
        if (url.includes("/api/v1/auth/me")) {
          authMeCalls += 1;
          return new Response(null, { status: 401 });
        }
        return new Response(null, { status: 404 });
      })
    );

    const { startConnectionMonitor, getConnectionStatus } = await loadFreshConnectionMonitor();
    const stop = startConnectionMonitor();

    await vi.advanceTimersByTimeAsync(600);

    expect(getConnectionStatus()).toBe("CONNECTED");
    expect(authMeCalls).toBe(0);
    stop();
  });
});
