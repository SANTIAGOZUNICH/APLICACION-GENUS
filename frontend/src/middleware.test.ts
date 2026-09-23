import { describe, expect, it } from "vitest";
import { NextRequest } from "next/server";
import { middleware } from "./middleware";

/**
 * Regresión (bug real encontrado en Production): Vercel Cron llama a
 * /api/cron/* con `Authorization: Bearer $CRON_SECRET`, nunca con la cookie
 * `genus_session`. Antes de este fix, `isApi` solo reconocía /api/v1/, así
 * que el gate de sesión trataba /api/cron/* como página y respondía 307 a
 * /login ANTES de que el handler (que valida CRON_SECRET) llegara a
 * ejecutarse — confirmado en vivo contra Production con curl. El cron nunca
 * pudo sincronizar ni una sola vez pese a estar deployado y con
 * CRON_SECRET configurado, porque el middleware lo interceptaba primero.
 */
function req(path: string, opts: { cookie?: string; host?: string } = {}) {
  const url = `https://${opts.host ?? "appgenus.vercel.app"}${path}`;
  const headers = new Headers();
  if (opts.cookie) headers.set("cookie", opts.cookie);
  return new NextRequest(url, { headers });
}

function isPassThrough(res: Response): boolean {
  // NextResponse.next() marca la respuesta internamente con este header —
  // a diferencia de .redirect()/.json(), que nunca lo llevan.
  return res.headers.get("x-middleware-next") === "1";
}

describe("middleware — /api/cron/* nunca pasa por el gate de sesión (bug real de Production)", () => {
  it("sin cookie de sesión, /api/cron/asignacion-lotes-sync sigue de largo (deja que el handler valide CRON_SECRET)", () => {
    const res = middleware(req("/api/cron/asignacion-lotes-sync"));
    expect(res.status).not.toBe(307);
    expect(isPassThrough(res)).toBe(true);
  });

  it("nunca redirige a /login para rutas /api/cron/*, sin importar la sub-ruta", () => {
    const res = middleware(req("/api/cron/otra-tarea-futura"));
    expect(res.headers.get("location")).toBeNull();
    expect(isPassThrough(res)).toBe(true);
  });

  it("con cookie de sesión también sigue de largo (no cambia nada para un caller autenticado)", () => {
    const res = middleware(req("/api/cron/asignacion-lotes-sync", { cookie: "genus_session=abc" }));
    expect(isPassThrough(res)).toBe(true);
  });
});

describe("middleware — comportamiento existente NO cambia para otras rutas (sin regresión)", () => {
  it("API v1 sin sesión sigue respondiendo 401 JSON (nunca redirige)", () => {
    const res = middleware(req("/api/v1/work-items"));
    expect(res.status).toBe(401);
  });

  it("página protegida sin sesión sigue redirigiendo a /login", () => {
    const res = middleware(req("/produccion"));
    expect(res.status).toBe(307);
    expect(res.headers.get("location")).toContain("/login");
  });

  it("/login sigue siendo pública", () => {
    const res = middleware(req("/login"));
    expect(isPassThrough(res)).toBe(true);
  });

  it("/api/health sigue sin requerir sesión", () => {
    const res = middleware(req("/api/health"));
    expect(isPassThrough(res)).toBe(true);
  });
});

describe("middleware — /api/cron/* nunca sufre el redirect de host canónico", () => {
  it("en Production, sobre un alias no-canónico, /api/cron/* NO se redirige (a diferencia de una página)", () => {
    const original = process.env.VERCEL_ENV;
    process.env.VERCEL_ENV = "production";
    try {
      const res = middleware(
        req("/api/cron/asignacion-lotes-sync", {
          host: "aplicacion-genus-santizunich-2879s-projects.vercel.app",
        })
      );
      expect(res.status).not.toBe(308);
      expect(isPassThrough(res)).toBe(true);
    } finally {
      process.env.VERCEL_ENV = original;
    }
  });
});
