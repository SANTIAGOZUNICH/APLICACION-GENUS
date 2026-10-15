import { beforeEach, describe, expect, it, vi } from "vitest";

const queue: Array<{ rows: unknown[] }> = [];
const execute = vi.fn(async () => queue.shift() ?? { rows: [] });
vi.mock("@/lib/db/client", () => ({
  isDatabaseConfigured: () => true,
  getDb: () => ({ execute, transaction: async (fn: (tx: unknown) => unknown) => fn({ execute }) }),
}));

import { entregasRecoveryStats, entregasService } from "./service";

/** Fila como la devuelve WORK_FACT_COLS (el SQL real corre en el E2E con Postgres descartable). */
const row = (o: Record<string, unknown> = {}) => ({
  work_id: "w1", client: "FIRMEA", product: "CREMA", sector: "ENVASADO_MASIVO", line: "Línea 1", responsible: "Línea 1",
  planned_date: "2026-10-01", planned_date_to: null, planned_quantity: "1000", unit: "un.", delivery_date: "2026-10-15", packaging_lote: "L-1",
  packaging_vto: "10/2028", operational_status: "completo", finished_qty: "1000", deliverable_units: null, order_number: "OA-1",
  completed_on: "2026-10-02", notes: null, is_cancelled: false, real_deliveries: [], is_linked: false, container_date: null, container_status: null, ...o,
});

const produccion = { email: "p@x", sector: "PRODUCCION" };

beforeEach(() => {
  queue.length = 0;
  execute.mockClear();
});

describe("entregasService.list — une programadas + recuperadas de los trabajos", () => {
  it("devuelve el trabajo con fecha de entrega aunque nunca se cargó en Entregas; lo ya entregado NO aparece (agenda de pendientes)", async () => {
    queue.push({ rows: [] }); // scheduled_deliveries del rango: ninguna cargada a mano
    queue.push({
      rows: [
        row({ work_id: "a", delivery_date: "2026-10-15" }),
        row({ work_id: "b", product: "SERUM", delivery_date: null, real_deliveries: [{ id: "r1", date: "2026-10-03", quantity: "1000", unit: "un.", remito: "R-9", receivedBy: "Ana", lote: null, vto: null, observations: null }], operational_status: "entregado" }),
      ],
    });
    const out = await entregasService.list(produccion, { from: "2026-10-01", to: "2026-10-31" });
    expect(out.map((d) => [d.origin, d.deliveryDate, d.client])).toEqual([["desde_trabajo", "2026-10-15", "FIRMEA"]]);
  });

  it("también acepta real_deliveries como texto JSON (parcial: queda el saldo en su fecha)", async () => {
    queue.push({ rows: [] });
    queue.push({ rows: [row({ delivery_date: "2026-10-20", real_deliveries: JSON.stringify([{ id: "r1", date: "2026-10-03", quantity: "400" }]) })] });
    const out = await entregasService.list(produccion, { from: "2026-10-01", to: "2026-10-31" });
    expect(out.map((d) => [d.origin, d.deliveryDate])).toEqual([["desde_trabajo", "2026-10-20"]]);
    expect(out[0]!.items[0]!.works[0]!.deliveredQty).toBe(400);
  });

  it("Envasado ve solo lo de su sector; Depósito ve todo; Calidad no tiene acceso", async () => {
    const rows = [row({ work_id: "a", sector: "ENVASADO_MASIVO" }), row({ work_id: "b", sector: "ENVASADO_PREMIUM", product: "PREMIUM" }), row({ work_id: "c", sector: "ELABORACION", product: "GRANEL" })];
    queue.push({ rows: [] }, { rows });
    const masivo = await entregasService.list({ email: "m@x", sector: "ENVASADO_MASIVO" }, { from: "2026-10-01", to: "2026-10-31" });
    expect(masivo.flatMap((d) => d.items.map((i) => i.product))).toEqual(["CREMA"]);

    queue.push({ rows: [] }, { rows });
    const deposito = await entregasService.list({ email: "d@x", sector: "DEPOSITO" }, { from: "2026-10-01", to: "2026-10-31" });
    expect(deposito.flatMap((d) => d.items.map((i) => i.product)).sort()).toEqual(["CREMA", "GRANEL", "PREMIUM"]);

    await expect(entregasService.list({ email: "q@x", sector: "CALIDAD" }, { from: "2026-10-01", to: "2026-10-31" })).rejects.toThrow(/acceso/);
  });
});

describe("entregasRecoveryStats (solo lectura)", () => {
  it("cuenta históricas, futuras y los trabajos que quedan fuera con su motivo", async () => {
    queue.push({
      rows: [
        row({ work_id: "h", delivery_date: null, real_deliveries: [{ id: "r", date: "2026-09-20", quantity: "1000" }], operational_status: "entregado" }),
        row({ work_id: "f", delivery_date: "2026-10-20" }),
        row({ work_id: "s", delivery_date: null, operational_status: "entregado" }), // entregado sin fecha real
        row({ work_id: "c", delivery_date: "2026-10-20", is_cancelled: true }),
      ].map((r) => ({ ...r, today: "2026-10-14" })),
    });
    queue.push({ rows: [{ n: 5, today: "2026-10-14" }] });
    const s = await entregasRecoveryStats();
    expect(s.historicas).toEqual({ total: 1, sueltas: 1, enEntregaProgramada: 0 });
    expect(s.futuras).toEqual({ total: 1, sueltas: 1, enEntregaProgramada: 0 });
    expect(s.fuera).toEqual({ entregadoSinFechaReal: 1, sinFechaDeEntrega: 5, canceladosOEliminados: 1 });
    // Solo lecturas: dos SELECT y nada más.
    expect(execute).toHaveBeenCalledTimes(2);
  });

  it("Envasado (vista recortada) no recibe cifras globales; Calidad no accede", async () => {
    expect(await entregasService.recoveryStats({ email: "m@x", sector: "ENVASADO_PREMIUM" })).toBeNull();
    expect(execute).not.toHaveBeenCalled();
    await expect(entregasService.recoveryStats({ email: "q@x", sector: "CALIDAD" })).rejects.toThrow(/acceso/);
  });
});
