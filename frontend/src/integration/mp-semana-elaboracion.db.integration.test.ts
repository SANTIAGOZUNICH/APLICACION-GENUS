/**
 * Materias Primas → «Semana de Elaboración» contra Postgres de PRUEBA real: cifras y estado reales (kg elaborados / entregados / pendientes),
 * actualización por entregas parciales, correcciones y cancelaciones, y solo lectura en el servidor.
 * Se corre con `GENUS_E2E_VITEST_FILES=src/integration/mp-semana-elaboracion.db.integration.test.ts npm run test:e2e:semanas-priorities-db`.
 */

import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { assertMarkedDatabase, e2eEnvironmentProblem } from "../../scripts/e2e/e2e-safety.mjs";

const PROBLEM = e2eEnvironmentProblem() ?? (process.env.GENUS_E2E_DATABASE_URL ? null : "falta GENUS_E2E_DATABASE_URL");
const RUN = Date.now().toString().slice(-6);
const CLIENT = `IT SEM CLIENTE ${RUN}`;
const prod = { email: "it-sem-prod@laboratoriogenus.com.ar", sector: "PRODUCCION" as const, displayName: "IT CR Producción" };
const elab = { email: "it-sem-elab@laboratoriogenus.com.ar", sector: "ELABORACION" as const, displayName: "IT CR Elaboración" };

describe.skipIf(Boolean(PROBLEM))(`MP: Semana de Elaboración — cifras reales y solo lectura en Postgres real${PROBLEM ? ` — saltado: ${PROBLEM}` : ""}`, () => {
  let pool: import("@neondatabase/serverless").Pool;
  const q = async (text: string, params: unknown[] = []) => (await pool.query(text, params)).rows as Record<string, unknown>[];
  const mp = { email: "it-sem-mp@laboratoriogenus.com.ar", sector: "MATERIA_PRIMA" as const, displayName: "IT MP" };

  beforeAll(async () => {
    process.env.VITEST = "false";
    (process.env as Record<string, string | undefined>).NODE_ENV = "development";
    delete process.env.GENUS_FEATURE_MEMORY;
    process.env.DATABASE_URL = process.env.GENUS_E2E_DATABASE_URL!;
    const { Pool, neonConfig } = await import("@neondatabase/serverless");
    neonConfig.webSocketConstructor = (await import("ws")).default as never;
    pool = new Pool({ connectionString: process.env.GENUS_E2E_DATABASE_URL });
    await assertMarkedDatabase(q);
    vi.resetModules();
  }, 60_000);
  afterAll(async () => {
    await pool?.end();
  });

  const newElab = async (kg = "60") => {
    const { assignWorkItemDurable } = await import("@/lib/planning/work-assignment-service");
    const r = await assignWorkItemDurable(
      { sector: "ELABORACION", client: CLIENT, product: `Serum SEM ${RUN}-${Math.random().toString(36).slice(2, 6)}`, plannedQuantity: kg, unit: "kg", plannedDate: "2031-06-10", branchOwner: "Cristian", orderNumber: `OE-2026-${String(400000 + Math.floor(Math.random() * 99999)).padStart(6, "0")}`, packagingLote: "IT-SEM", idempotencyKey: randomUUID() } as never,
      prod,
      randomUUID()
    );
    return r.item.id as string;
  };
  const figures = async (id: string) => {
    const { loadElaboracionFigures } = await import("@/lib/planning/elaboracion-figures-service");
    const [row] = await q("select id, planned_quantity, finished_qty, operational_status, status, unit from work_items where id = $1", [id]);
    return (await loadElaboracionFigures([{ id, plannedQuantity: row!.planned_quantity as string, finishedQty: (row!.finished_qty as string | null) ?? null, operationalStatus: row!.operational_status as string, status: (row!.status as string) ?? null, unit: row!.unit as string }])).get(id)!;
  };
  const saveProgress = async (id: string, kg: string) => {
    const { saveWorkProgressDurable } = await import("@/lib/planning/work-item-progress-repository");
    return saveWorkProgressDurable(id, { finishedQty: kg, observation: "", updatedBy: elab.displayName } as never, elab.sector);
  };
  const deliverAs = async (actor: { email: string; sector: string; displayName: string }, workItemId: string, qty: number | null, kg: number) => {
    const { deliverWorkDurable } = await import("@/lib/planning/work-item-progress-repository");
    return deliverWorkDurable({ workItemId, codigo: null, sourceSector: actor.sector, plannedDeliveryDate: null, actualDeliveredAt: new Date().toISOString(), remito: null, receivedBy: null, observations: null, idempotencyKey: randomUUID(), partial: qty != null, deliverQuantity: qty, completion: { finishedQty: String(kg) } } as never, actor as never);
  };

  it("pendiente → en elaboración → 70 kg sobre 60 solicitados; Producción registra 40 kg y luego 30 kg (parcial → entregado)", { timeout: 90_000 }, async () => {
    const id = await newElab("60");
    expect(await figures(id)).toMatchObject({ state: "PENDIENTE", requestedKg: 60, elaboratedKg: null, deliveredKg: 0, pendingKg: null });
    await saveProgress(id, "70");
    expect(await figures(id)).toMatchObject({ state: "EN_ELABORACION", requestedKg: 60, elaboratedKg: 70, pendingKg: 70 });
    await deliverAs(prod, id, 40, 70);
    expect(await figures(id)).toMatchObject({ state: "ENTREGADO_PARCIAL", requestedKg: 60, elaboratedKg: 70, deliveredKg: 40, pendingKg: 30 });
    await deliverAs(prod, id, 30, 70);
    expect(await figures(id)).toMatchObject({ state: "ENTREGADO", deliveredKg: 70, pendingKg: 0 });
    expect(String((await q("select planned_quantity from work_items where id = $1", [id]))[0]!.planned_quantity)).toBe("60"); // lo solicitado no se toca
  });

  it("corregir y cancelar una entrega actualiza kg y estado en MP (misma fuente)", { timeout: 90_000 }, async () => {
    const id = await newElab("60");
    await saveProgress(id, "70");
    await deliverAs(prod, id, 40, 70);
    await deliverAs(prod, id, 30, 70);
    const svc = await import("@/lib/planning/internal-deliveries-service");
    const lines = await q("select id from work_item_delivery_lines where work_item_id = $1 order by sequence", [id]);
    await svc.editInternalDelivery(prod as never, { kind: "PRODUCCION", id: String(lines[1]!.id), quantity: 20 });
    expect(await figures(id)).toMatchObject({ state: "ENTREGADO_PARCIAL", deliveredKg: 60, pendingKg: 10 });
    await svc.cancelInternalDelivery(prod as never, { kind: "PRODUCCION", id: String(lines[0]!.id), reason: "se contó mal" });
    expect(await figures(id)).toMatchObject({ state: "ENTREGADO_PARCIAL", deliveredKg: 20, pendingKg: 50 });
  });

  it("Elaboración envía los 70 kg a Envasado: en MP queda Entregado con 70 kg entregados y 0 pendientes", { timeout: 90_000 }, async () => {
    const id = await newElab("60");
    const { sendElaboracionToEnvasadoDurable } = await import("@/lib/planning/circuit/elaboracion-handoff");
    await sendElaboracionToEnvasadoDurable({ workItemId: id, destination: "ENVASADO_MASIVO", producedQuantity: "70", unitsToPackage: "1235", idempotencyKey: `sem-${RUN}-70` }, elab as never);
    expect(await figures(id)).toMatchObject({ state: "ENTREGADO", requestedKg: 60, elaboratedKg: 70, deliveredKg: 70, pendingKg: 0 });
  });

  it("MP es de SOLO LECTURA en el servidor: no avanza, no entrega, no envía, no edita ni cancela entregas", { timeout: 90_000 }, async () => {
    const id = await newElab("60");
    await saveProgress(id, "70");
    const before = await figures(id);
    const { saveWorkProgressDurable } = await import("@/lib/planning/work-item-progress-repository");
    await expect(saveWorkProgressDurable(id, { finishedQty: "1", observation: "", updatedBy: "MP" } as never, mp.sector)).rejects.toThrow(/permiso/i);
    await expect(deliverAs(mp, id, 10, 70)).rejects.toThrow(/permiso/i);
    const { sendElaboracionToEnvasadoDurable } = await import("@/lib/planning/circuit/elaboracion-handoff");
    await expect(sendElaboracionToEnvasadoDurable({ workItemId: id, destination: "ENVASADO_MASIVO", producedQuantity: "70", idempotencyKey: `sem-${RUN}-mp` }, mp as never)).rejects.toThrow(/permiso/i);
    const svc = await import("@/lib/planning/internal-deliveries-service");
    await deliverAs(prod, id, 10, 70);
    const [line] = await q("select id from work_item_delivery_lines where work_item_id = $1", [id]);
    await expect(svc.editInternalDelivery(mp as never, { kind: "PRODUCCION", id: String(line!.id), quantity: 5 })).rejects.toThrow();
    await expect(svc.cancelInternalDelivery(mp as never, { kind: "PRODUCCION", id: String(line!.id), reason: "x" })).rejects.toThrow();
    const after = await figures(id);
    expect(after).toMatchObject({ elaboratedKg: before.elaboratedKg, deliveredKg: 10 }); // nada cambió por los intentos de MP
    expect(Number((await q("select count(*)::int n from work_item_delivery_lines where work_item_id = $1 and status = 'ACTIVA'", [id]))[0]!.n)).toBe(1);
  });
});
