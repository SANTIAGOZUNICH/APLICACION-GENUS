/** Cajas por entrega + aviso de facturación contra Postgres de PRUEBA real (entrega parcial y completa). */
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { assertMarkedDatabase, e2eEnvironmentProblem } from "../../scripts/e2e/e2e-safety.mjs";

const PROBLEM = e2eEnvironmentProblem() ?? (process.env.GENUS_E2E_DATABASE_URL ? null : "falta GENUS_E2E_DATABASE_URL");
const prod = { email: "it-dp-prod@laboratoriogenus.com.ar", sector: "PRODUCCION", displayName: "IT Producción" };
const RUN = Date.now().toString().slice(-6);
const CLIENT = `IT DP CLIENTE ${RUN}`;
const NOTE = `IT-DP-${RUN}`;

describe.skipIf(Boolean(PROBLEM))(`Cajas por entrega en Postgres real${PROBLEM ? ` — saltado: ${PROBLEM}` : ""}`, () => {
  let pool: import("@neondatabase/serverless").Pool;
  const q = async (text: string, params: unknown[] = []) => (await pool.query(text, params)).rows as Record<string, unknown>[];
  const workIds: string[] = [];

  beforeAll(async () => {
    process.env.DATABASE_URL = process.env.GENUS_E2E_DATABASE_URL!;
    const { Pool, neonConfig } = await import("@neondatabase/serverless");
    neonConfig.webSocketConstructor = (await import("ws")).default as never;
    pool = new Pool({ connectionString: process.env.GENUS_E2E_DATABASE_URL });
    await assertMarkedDatabase(q);
    vi.resetModules();
  }, 60_000);

  afterAll(async () => {
    await q("delete from os_notifications where message like $1", [`%${CLIENT}%`]).catch(() => undefined);
    await pool?.end();
  });

  const newWork = async (qty: string) => {
    const { assignWorkItemDurable } = await import("@/lib/planning/work-assignment-service");
    const r = await assignWorkItemDurable(
      { sector: "ENVASADO_MASIVO", client: CLIENT, product: `Crema Facial ${RUN}`, plannedQuantity: qty, unit: "u", plannedDate: "2031-05-05", line: "Línea 1", orderNumber: `OA-2026-${String(700000 + Math.floor(Math.random() * 99999)).padStart(6, "0")}`, packagingLote: "IT-DP", notes: NOTE, idempotencyKey: randomUUID() } as never,
      prod,
      randomUUID()
    );
    workIds.push(r.item.id as string);
    return r.item.id as string;
  };
  const deliver = async (workItemId: string, over: Record<string, unknown>) => {
    const { deliverWorkDurable } = await import("@/lib/planning/work-item-progress-repository");
    return deliverWorkDurable(
      { workItemId, codigo: null, sourceSector: "ENVASADO_MASIVO", plannedDeliveryDate: null, actualDeliveredAt: new Date().toISOString(), remito: null, receivedBy: null, observations: null, ...over } as never,
      { email: prod.email, sector: "PRODUCCION", displayName: prod.displayName }
    );
  };

  it("entrega parcial con cajas distintas: se guarda en la línea, avisa a Administración una sola vez y el replay no duplica", async () => {
    const id = await newWork("1250");
    const key = `dp-${RUN}-1`;
    const boxes = [{ cajas: 8, unidadesPorCaja: 100 }, { cajas: 1, unidadesPorCaja: 50 }];
    const r1 = await deliver(id, { deliverQuantity: 850, idempotencyKey: key, deliveryPackingGroups: boxes });
    expect(r1.complete).toBe(false);
    expect(r1.line?.packingGroups).toEqual(boxes);
    const r2 = await deliver(id, { deliverQuantity: 850, idempotencyKey: key, deliveryPackingGroups: boxes }); // doble clic / reintento
    expect(r2.replayed).toBe(true);
    const lines = await q("select quantity, packing_groups from work_item_delivery_lines where work_item_id = $1 and status = 'ACTIVA'", [id]);
    expect(lines).toHaveLength(1);
    const notes = await q("select message from os_notifications where kind = 'entrega_registrada' and message like $1", [`%${CLIENT}%`]);
    expect(notes).toHaveLength(1);
    expect(String(notes[0]!.message)).toContain("8 cajas de 100 u. + 1 caja de 50 u. = 9 cajas / 850 u.");
    expect(String(notes[0]!.message)).toMatch(/parcial/);
    // Segunda entrega (saldo 400) con otras cajas: no vuelve a contar las 850 ya entregadas.
    const r3 = await deliver(id, { deliverQuantity: 400, idempotencyKey: `${key}-b`, deliveryPackingGroups: [{ cajas: 4, unidadesPorCaja: 100 }] });
    expect(r3.complete).toBe(true);
    expect(r3.delivered).toBe(1250);
    const all = await q("select count(*)::int n from os_notifications where kind = 'entrega_registrada' and message like $1", [`%${CLIENT}%`]);
    expect(Number(all[0]!.n)).toBe(2);
  });

  it("cajas que no suman la cantidad entregada se rechazan y no registran nada", async () => {
    const id = await newWork("500");
    await expect(deliver(id, { deliverQuantity: 500, idempotencyKey: `dp-${RUN}-2`, deliveryPackingGroups: [{ cajas: 4, unidadesPorCaja: 100 }] })).rejects.toThrow(/suman 400 u/);
    const lines = await q("select 1 from work_item_delivery_lines where work_item_id = $1", [id]);
    expect(lines).toHaveLength(0);
    const ok = await deliver(id, { deliverQuantity: 500, idempotencyKey: `dp-${RUN}-3` }); // sin detalle de cajas sigue siendo válido
    expect(ok.complete).toBe(true);
  });
});
