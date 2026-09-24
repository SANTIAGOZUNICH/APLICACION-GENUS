import { beforeEach, describe, expect, it, vi } from "vitest";
import { resetAsignacionLoteSourcesMemoryForTests } from "@/lib/asignacion-lotes/asignacion-lote-sources-service";
import { OrdersValidationError } from "@/lib/orders/types";

vi.mock("@/lib/orders/actor", () => ({
  resolveOrdersActor: (request: Request) => {
    const email = request.headers.get("x-genus-actor-email");
    const sector = (request.headers.get("x-genus-actor-sector") || "PRODUCCION").toUpperCase();
    if (!email) throw new OrdersValidationError("Sesión requerida.");
    return { email, sector, displayName: "Test" };
  },
}));

const calidad = { "x-genus-actor-email": "calidad@x.com", "x-genus-actor-sector": "CALIDAD" };
const codificado = { "x-genus-actor-email": "codificado@x.com", "x-genus-actor-sector": "CODIFICADO" };
const deposito = { "x-genus-actor-email": "deposito@x.com", "x-genus-actor-sector": "DEPOSITO" };

async function get(headers: Record<string, string>) {
  const { GET } = await import("./route");
  return GET(new Request("http://localhost/api/v1/asignacion-lotes/official-status", { headers }));
}

describe("GET /api/v1/asignacion-lotes/official-status", () => {
  beforeEach(() => {
    resetAsignacionLoteSourcesMemoryForTests();
  });

  it("visible para Calidad y Codificado (no solo Producción/Dirección) — es solo lectura, sección 12 del pedido", async () => {
    const resCalidad = await get(calidad);
    expect(resCalidad.status).toBe(200);
    const resCodificado = await get(codificado);
    expect(resCodificado.status).toBe(200);
  });

  it("bloquea sectores sin acceso a Asignación de Lotes", async () => {
    const res = await get(deposito);
    expect(res.status).toBe(403);
  });

  it("antes de la primera corrida del cron, reporta las dos fuentes oficiales como no conectadas todavía", async () => {
    const res = await get(calidad);
    const body = (await res.json()) as {
      sources: Array<{ year: string; connected: boolean; syncStatus: string }>;
      syncFrequencyMinutes: number;
    };
    expect(body.sources).toHaveLength(2);
    expect(body.sources.map((s) => s.year).sort()).toEqual(["2025", "2026"]);
    expect(body.sources.every((s) => s.connected === false)).toBe(true);
    expect(body.syncFrequencyMinutes).toBe(10);
  });

  it("después de que el cron corrió (ensureOfficialSourcesAndRetireRedundant), refleja las fuentes ya creadas", async () => {
    const { ensureOfficialSourcesAndRetireRedundant } = await import("@/lib/asignacion-lotes/official-sources");
    await ensureOfficialSourcesAndRetireRedundant({ email: "sync@sistema", displayName: "Sync" });
    const res = await get(calidad);
    const body = (await res.json()) as { sources: Array<{ connected: boolean; enabled: boolean }> };
    expect(body.sources.every((s) => s.connected === true && s.enabled === true)).toBe(true);
  });
});
