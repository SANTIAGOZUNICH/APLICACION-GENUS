/**
 * Cajas por entrega parcial: cada entrega conserva SU embalaje (Envasado → Producción, Codificado, remitos) — Postgres de PRUEBA real. Datos ficticios «IT CJ»; se SALTA sin base marcada.
 */
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { assertMarkedDatabase, e2eEnvironmentProblem } from "../../scripts/e2e/e2e-safety.mjs";

const PROBLEM = e2eEnvironmentProblem() ?? (process.env.GENUS_E2E_DATABASE_URL ? null : "falta GENUS_E2E_DATABASE_URL");
const RUN = Date.now().toString().slice(-6);
const CLIENT = `IT CJ CLIENTE ${RUN}`;
const prod = { email: "it-id-prod@laboratoriogenus.com.ar", sector: "PRODUCCION" as const, displayName: "IT Producción" };
const masivo = { email: "it-id-masivo@laboratoriogenus.com.ar", sector: "ENVASADO_MASIVO" as const, displayName: "IT Envasado Masivo" };
const premium = { email: "it-id-premium@laboratoriogenus.com.ar", sector: "ENVASADO_PREMIUM" as const, displayName: "IT Envasado Premium" };
const codif = { email: "it-id-cod@laboratoriogenus.com.ar", sector: "CODIFICADO" as const, displayName: "IT Codificado" };
const deposito = { email: "it-id-dep@laboratoriogenus.com.ar", sector: "DEPOSITO" as const, displayName: "IT Depósito" };
const elab = { email: "it-id-elab@laboratoriogenus.com.ar", sector: "ELABORACION" as const, displayName: "IT Elaboración" };

describe.skipIf(Boolean(PROBLEM))(`Cajas por entrega parcial${PROBLEM ? ` — saltado: ${PROBLEM}` : ""}`, () => {
  let pool: import("@neondatabase/serverless").Pool;
  const q = async (text: string, params: unknown[] = []) => (await pool.query(text, params)).rows as Record<string, unknown>[];
  const ids = () => import("@/lib/planning/internal-deliveries-service");
  const trans = () => import("@/lib/planning/codificado-transfer-service");

  beforeAll(async () => {
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

  const newWork = async (sector: "ENVASADO_MASIVO" | "ENVASADO_PREMIUM", qty: string, finished: string | null = null) => {
    const { assignWorkItemDurable } = await import("@/lib/planning/work-assignment-service");
    const r = await assignWorkItemDurable({ sector, client: CLIENT, product: `Serum IT ${RUN}-${Math.random().toString(36).slice(2, 6)}`, plannedQuantity: qty, unit: "un.", plannedDate: "2031-06-10", line: "Línea 1", orderNumber: `OA-2026-${String(700000 + Math.floor(Math.random() * 99999)).padStart(6, "0")}`, packagingLote: "L-IT-ID", idempotencyKey: randomUUID() } as never, prod, randomUUID());
    const id = r.item.id as string;
    if (finished) await q("update work_items set finished_qty = $1 where id = $2", [finished, id]);
    return id;
  };
  const deliver = async (actor: typeof masivo | typeof prod | typeof premium, workItemId: string, qty: number, observations: string | null = null) => {
    const { deliverWorkDurable } = await import("@/lib/planning/work-item-progress-repository");
    return deliverWorkDurable(
      { workItemId, deliverQuantity: qty, partial: true, observations, idempotencyKey: randomUUID(), codigo: null, sourceSector: actor.sector, plannedDeliveryDate: null, actualDeliveredAt: new Date().toISOString(), remito: null, receivedBy: null } as never,
      { email: actor.email, sector: actor.sector, displayName: actor.displayName }
    );
  };
  const transfer = async (actor: typeof masivo | typeof prod | typeof premium, workItemId: string, quantity: number, finishedQty: number | null = null, observation: string | null = null) =>
    (await trans()).transferToCodificadoDurable({ workItemId, quantity, finishedQty, observation, idempotencyKey: randomUUID() }, actor as never);
  const lines = (workItemId: string) => q("select id, sequence, quantity, status, kind, cumulative_after, pending_after, observations from work_item_delivery_lines where work_item_id = $1 order by sequence", [workItemId]);
  const transfers = (workItemId: string) => q("select id, seq, quantity, cumulative, pending, status, note from work_item_codificado_transfers where work_item_id = $1 order by seq", [workItemId]);
  const item = async (id: string) => (await q("select planned_quantity, finished_qty, operational_status, sample_units from work_items where id = $1", [id]))[0]!;
  const changes = (deliveryId: string) => q("select * from internal_delivery_changes where delivery_id = $1 order by created_at", [deliveryId]);

  const deliverBoxes = async (actor: typeof masivo | typeof premium, workItemId: string, qty: number, boxes: Array<{ cajas: number; unidadesPorCaja: number }> | null, observations: string | null = null) => {
    const { deliverWorkDurable } = await import("@/lib/planning/work-item-progress-repository");
    return deliverWorkDurable(
      { workItemId, deliverQuantity: qty, partial: true, observations, deliveryPackingGroups: boxes, idempotencyKey: randomUUID(), codigo: null, sourceSector: actor.sector, plannedDeliveryDate: null, actualDeliveredAt: new Date().toISOString(), remito: null, receivedBy: null } as never,
      { email: actor.email, sector: actor.sector, displayName: actor.displayName }
    );
  };
  const readLines = async (workItemId: string) => (await import("@/lib/planning/work-item-progress-repository")).listDeliveryLinesDurable(workItemId);
  const FOUR = [
    { qty: 500, boxes: [{ cajas: 5, unidadesPorCaja: 100 }], obs: "uno" },
    { qty: 600, boxes: [{ cajas: 6, unidadesPorCaja: 100 }], obs: "dos" },
    { qty: 450, boxes: [{ cajas: 4, unidadesPorCaja: 100 }, { cajas: 1, unidadesPorCaja: 50 }], obs: "tres" },
    { qty: 470, boxes: [{ cajas: 4, unidadesPorCaja: 100 }, { cajas: 1, unidadesPorCaja: 70 }], obs: "cuatro" },
  ];

  for (const withWorkPacking of [false, true]) {
    it(`REPRO) cuatro parciales (500/600/450/470 = 2.020 sobre 2.000), cada una con sus cajas${withWorkPacking ? " — el trabajo ya tiene cajas cargadas en Registrar avance" : ""}`, async () => {
      const id = await newWork("ENVASADO_MASIVO", "2000", "2020");
      if (withWorkPacking) await q("update work_items set packing_groups = $1::jsonb where id = $2", [JSON.stringify([{ cajas: 19, unidadesPorCaja: 100 }, { cajas: 1, unidadesPorCaja: 50 }, { cajas: 1, unidadesPorCaja: 70 }]), id]);
      for (const f of FOUR) await deliverBoxes(masivo, id, f.qty, f.boxes, f.obs);
      const stored = await lines(id);
      console.log("DB", JSON.stringify((await q("select sequence, quantity, packing_groups from work_item_delivery_lines where work_item_id = $1 order by sequence", [id]))));
      const read = await readLines(id);
      console.log("READ", JSON.stringify(read.map((l) => [l.sequence, l.quantity, l.packingGroups])));
      expect(stored).toHaveLength(4);
      expect(read.map((l) => l.packingGroups)).toEqual(FOUR.map((f) => f.boxes));
    }, 60_000);
  }

  const finalDeliver = async (actor: typeof masivo, workItemId: string, qty: number, boxes: Array<{ cajas: number; unidadesPorCaja: number }>) => {
    const { deliverWorkDurable } = await import("@/lib/planning/work-item-progress-repository");
    return deliverWorkDurable(
      { workItemId, deliverQuantity: qty, partial: false, deliveryPackingGroups: boxes, idempotencyKey: randomUUID(), codigo: null, sourceSector: actor.sector, plannedDeliveryDate: null, actualDeliveredAt: new Date().toISOString(), remito: null, receivedBy: null, observations: "final" } as never,
      { email: actor.email, sector: actor.sector, displayName: actor.displayName }
    );
  };
  const asRemitoActor = (a: { email: string; sector: string }) => ({ email: a.email, sector: a.sector }) as never;

  it("entrega FINAL después de parciales (300 + 400 + 350 = 1.050 sobre 1.000): conserva SUS cajas, sin heredar ni exigir las del pedido", async () => {
    const id = await newWork("ENVASADO_PREMIUM", "1000", "1050");
    await deliverBoxes(premium, id, 300, [{ cajas: 3, unidadesPorCaja: 100 }]);
    await deliverBoxes(premium, id, 400, [{ cajas: 4, unidadesPorCaja: 100 }]);
    const r = await finalDeliver(premium, id, 350, [{ cajas: 3, unidadesPorCaja: 100 }, { cajas: 1, unidadesPorCaja: 50 }]);
    expect(r).toMatchObject({ complete: true, delivered: 1050, pending: 0 });
    const read = await readLines(id);
    expect(read.map((l) => [l.sequence, l.kind, l.quantity, l.packingGroups])).toEqual([
      [1, "PARCIAL", 300, [{ cajas: 3, unidadesPorCaja: 100 }]],
      [2, "PARCIAL", 400, [{ cajas: 4, unidadesPorCaja: 100 }]],
      [3, "FINAL", 350, [{ cajas: 3, unidadesPorCaja: 100 }, { cajas: 1, unidadesPorCaja: 50 }]],
    ]);
    expect((await item(id)).operational_status).toBe("entregado");
  }, 60_000);

  it("una entrega sin cajas NO hereda las de otra (queda 'sin detalle'); editar la 2.ª no toca la 1.ª; cancelar una no altera las restantes", async () => {
    const id = await newWork("ENVASADO_MASIVO", "2000", "2020");
    for (const f of FOUR.slice(0, 3)) await deliverBoxes(masivo, id, f.qty, f.boxes, f.obs);
    await deliverBoxes(masivo, id, 470, null, "sin cajas");
    let read = await readLines(id);
    expect(read[3]!.packingGroups).toBeNull(); // faltante visible, no se inventa
    expect(read.slice(0, 3).map((l) => l.packingGroups)).toEqual(FOUR.slice(0, 3).map((f) => f.boxes));
    const svc = await ids();
    // completar el detalle faltante por el flujo autorizado (auditado)
    const four = (await q("select id from work_item_delivery_lines where work_item_id = $1 and sequence = 4", [id]))[0]!.id as string;
    await svc.editInternalDelivery(masivo as never, { kind: "PRODUCCION", id: four, packingGroups: [{ cajas: 4, unidadesPorCaja: 100 }, { cajas: 1, unidadesPorCaja: 70 }], expectedVersion: 0 });
    // editar la 2.ª
    const two = (await q("select id from work_item_delivery_lines where work_item_id = $1 and sequence = 2", [id]))[0]!.id as string;
    const before1 = (await readLines(id))[0]!;
    await svc.editInternalDelivery(masivo as never, { kind: "PRODUCCION", id: two, observations: "dos corregida", packingGroups: [{ cajas: 5, unidadesPorCaja: 100 }, { cajas: 2, unidadesPorCaja: 50 }], expectedVersion: 0 });
    read = await readLines(id);
    expect(read[0]).toEqual(before1);
    expect(read[1]!.packingGroups).toEqual([{ cajas: 5, unidadesPorCaja: 100 }, { cajas: 2, unidadesPorCaja: 50 }]);
    expect(read[3]!.packingGroups).toEqual([{ cajas: 4, unidadesPorCaja: 100 }, { cajas: 1, unidadesPorCaja: 70 }]);
    expect((await q("select count(*)::int n from internal_delivery_changes where delivery_id = any($1)", [[two, four]]))[0]!.n).toBeGreaterThanOrEqual(2);
    // cancelar la 3.ª: las otras conservan sus cajas
    const three = (await q("select id from work_item_delivery_lines where work_item_id = $1 and sequence = 3", [id]))[0]!.id as string;
    await svc.cancelInternalDelivery(masivo as never, { kind: "PRODUCCION", id: three, reason: "error" });
    const rest = (await readLines(id)).filter((l) => l.status === "ACTIVA");
    expect(rest.map((l) => l.sequence)).toEqual([1, 2, 4]);
    expect(rest[0]!.packingGroups).toEqual(FOUR[0]!.boxes);
    expect(rest[2]!.packingGroups).toEqual([{ cajas: 4, unidadesPorCaja: 100 }, { cajas: 1, unidadesPorCaja: 70 }]);
  }, 60_000);

  it("remitos: cada entrega se remite con SUS cajas (2.ª y 3.ª), sin heredar las de la 1.ª y sin duplicar", async () => {
    const id = await newWork("ENVASADO_MASIVO", "2000", "2020");
    for (const f of FOUR) await deliverBoxes(masivo, id, f.qty, f.boxes, f.obs);
    const lineIds = (await q("select id from work_item_delivery_lines where work_item_id = $1 order by sequence", [id])).map((r) => r.id as string);
    const from = await import("@/lib/remitos/from-deliveries");
    const el = await from.listEligibleDeliveries({ lineIds });
    const bySeq = new Map(el.map((e) => [e.sequence, e]));
    expect(bySeq.get(2)).toMatchObject({ quantity: 600, packingGroups: FOUR[1]!.boxes });
    expect(bySeq.get(3)).toMatchObject({ quantity: 450, packingGroups: FOUR[2]!.boxes });
    // remito solo de la 2.ª: lleva 6 × 100 (no las 5 × 100 de la 1.ª)
    const r2 = await from.createRemitoDraftsFromDeliveries(asRemitoActor(prod), [lineIds[1]!]);
    expect(r2.remitos).toHaveLength(1);
    expect(r2.remitos[0]!.lines[0]).toMatchObject({ totalUnits: 600, cajas1: 6, unidades1: 100 });
    // pedirla otra vez no duplica unidades
    const again = await from.createRemitoDraftsFromDeliveries(asRemitoActor(prod), [lineIds[1]!]).catch((e) => e);
    expect(again instanceof Error ? 0 : again.remitos.length).toBe(0); // no se creó otro remito
    expect(again instanceof Error ? [lineIds[1]] : again.skipped).toContain(lineIds[1]);
    // remito de la 3.ª: 4 × 100 + 1 × 50
    const r3 = await from.createRemitoDraftsFromDeliveries(asRemitoActor(prod), [lineIds[2]!]);
    expect(r3.remitos[0]!.lines.find((l) => l.totalUnits === 450)).toMatchObject({ totalUnits: 450, cajas1: 4, unidades1: 100, cajas2: 1, unidades2: 50 });
  }, 60_000);
});
