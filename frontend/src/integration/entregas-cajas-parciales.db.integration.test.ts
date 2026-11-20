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
});
