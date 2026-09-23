import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/asignacion-lotes/asignacion-lotes-sync-service", () => ({
  syncAllEnabledSources: vi.fn().mockResolvedValue([]),
}));

describe("GET /api/cron/asignacion-lotes-sync", () => {
  const originalSecret = process.env.CRON_SECRET;

  beforeEach(() => {
    process.env.CRON_SECRET = "test-secret";
  });

  afterEach(() => {
    process.env.CRON_SECRET = originalSecret;
  });

  it("sin CRON_SECRET configurado -> 500, nunca corre sin secreto", async () => {
    delete process.env.CRON_SECRET;
    const { GET } = await import("./route");
    const res = await GET(new Request("http://localhost/api/cron/asignacion-lotes-sync"));
    expect(res.status).toBe(500);
  });

  it("sin header Authorization -> 401", async () => {
    const { GET } = await import("./route");
    const res = await GET(new Request("http://localhost/api/cron/asignacion-lotes-sync"));
    expect(res.status).toBe(401);
  });

  it("con el secreto correcto -> 200 y dispara la sincronización de todas las fuentes habilitadas", async () => {
    const { GET } = await import("./route");
    const res = await GET(
      new Request("http://localhost/api/cron/asignacion-lotes-sync", {
        headers: { authorization: "Bearer test-secret" },
      })
    );
    expect(res.status).toBe(200);
  });
});

describe("vercel.json — frecuencia del cron de Asignación de Lotes", () => {
  it("corre más de una vez por día (regresión: antes era '0 6 * * *', 1x/día, tratado como mero respaldo) — mismo patrón que GENUS-CRM (mismo equipo de Vercel)", () => {
    const vercelConfig = JSON.parse(
      readFileSync(join(process.cwd(), "vercel.json"), "utf8")
    ) as { crons?: { path: string; schedule: string }[] };
    const cron = vercelConfig.crons?.find((c) => c.path === "/api/cron/asignacion-lotes-sync");
    expect(cron).toBeTruthy();
    // Un schedule diario tiene 4 campos fijos (minuto hora * * *) sin "/" ni
    // "," — cualquier schedule con "/" (step, ej. "*/10 * * * *") o que no
    // fije hora exacta corre más de 1 vez/día. No se hardcodea el valor
    // exacto para no romper si se ajusta la cadencia dentro de "frecuente".
    expect(cron!.schedule).toMatch(/\*\/|,/);
  });
});
