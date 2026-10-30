/**
 * Entregas PARCIALES de Envasado Masivo / Premium → Producción contra Postgres de PRUEBA real.
 * Trabajo de 2.000 u.: parcial 1.000 → 600 → 400. El trabajo NO se cierra hasta completar lo asignado; cada entrega es un renglón
 * independiente; idempotente; concurrencia sin pasarse del saldo; sin despachos externos (Depósito → Entregas Producción).
 * Se corre con `GENUS_E2E_VITEST_FILES=src/integration/entrega-parcial-envasado.db.integration.test.ts npm run test:e2e:semanas-priorities-db`.
 */
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { assertMarkedDatabase, e2eEnvironmentProblem } from "../../scripts/e2e/e2e-safety.mjs";

const PROBLEM = e2eEnvironmentProblem() ?? (process.env.GENUS_E2E_DATABASE_URL ? null : "falta GENUS_E2E_DATABASE_URL");
const RUN = Date.now().toString().slice(-6);
const CLIENT = `IT EP CLIENTE ${RUN}`;
const NOTE = `IT-EP-${RUN}`;
const prod = { email: "it-ep-prod@laboratoriogenus.com.ar", sector: "PRODUCCION" as const, displayName: "IT Producción" };
const masivo = { email: "it-ep-masivo@laboratoriogenus.com.ar", sector: "ENVASADO_MASIVO" as const, displayName: "IT Envasado Masivo" };
const premium = { email: "it-ep-premium@laboratoriogenus.com.ar", sector: "ENVASADO_PREMIUM" as const, displayName: "IT Envasado Premium" };

describe.skipIf(Boolean(PROBLEM))(`Entregas parciales de Envasado en Postgres real${PROBLEM ? ` — saltado: ${PROBLEM}` : ""}`, () => {
  let pool: import("@neondatabase/serverless").Pool;
  const q = async (text: string, params: unknown[] = []) => (await pool.query(text, params)).rows as Record<string, unknown>[];

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

  const newWork = async (sector: "ENVASADO_MASIVO" | "ENVASADO_PREMIUM", qty: string, product = `Original Black ${RUN}`) => {
    const { assignWorkItemDurable } = await import("@/lib/planning/work-assignment-service");
    const r = await assignWorkItemDurable(
      { sector, client: CLIENT, product, plannedQuantity: qty, unit: "un.", plannedDate: "2031-06-10", line: "Línea 1", orderNumber: `OA-2026-${String(700000 + Math.floor(Math.random() * 99999)).padStart(6, "0")}`, packagingLote: "IT-EP", notes: NOTE, idempotencyKey: randomUUID() } as never,
      prod,
      randomUUID()
    );
    return r.item.id as string;
  };
  const deliver = async (actor: typeof masivo | typeof premium | typeof prod, workItemId: string, over: Record<string, unknown>) => {
    const { deliverWorkDurable } = await import("@/lib/planning/work-item-progress-repository");
    return deliverWorkDurable(
      { workItemId, codigo: null, sourceSector: actor.sector, plannedDeliveryDate: null, actualDeliveredAt: new Date().toISOString(), remito: null, receivedBy: null, observations: null, ...over } as never,
      { email: actor.email, sector: actor.sector, displayName: actor.displayName }
    );
  };
  const partial = (actor: typeof masivo | typeof premium, id: string, qty: number, realizadas: number, key: string) =>
    deliver(actor, id, { partial: true, deliverQuantity: qty, idempotencyKey: key, completion: { finishedQty: String(realizadas) } });
  const item = async (id: string) => (await q("select operational_status, planned_quantity, completed_at from work_items where id = $1", [id]))[0]!;
  const lines = (id: string) => q("select quantity, kind, status, cumulative_after, pending_after, delivered_by, delivered_by_sector, source_sector, sequence from work_item_delivery_lines where work_item_id = $1 order by sequence", [id]);

  for (const [label, actor, sector] of [["Envasado Masivo", masivo, "ENVASADO_MASIVO"], ["Envasado Premium", premium, "ENVASADO_PREMIUM"]] as const) {
    it(`${label}: 2.000 u. → parcial 1.000 / 600 / 400; el trabajo se completa SOLO al entregar las 2.000`, async () => {
      const id = await newWork(sector, "2000");
      const r1 = await partial(actor, id, 1000, 1000, `${RUN}-${sector}-a`);
      expect(r1).toMatchObject({ complete: false, delivered: 1000, pending: 1000 });
      let it1 = await item(id);
      expect(it1.operational_status).not.toBe("entregado");
      expect(it1.completed_at).toBeNull();
      expect(String(it1.planned_quantity)).toBe("2000"); // la cantidad asignada NO se modifica

      const r2 = await partial(actor, id, 600, 1600, `${RUN}-${sector}-b`);
      expect(r2).toMatchObject({ complete: false, delivered: 1600, pending: 400 });
      it1 = await item(id);
      expect(it1.operational_status).not.toBe("entregado");

      const r3 = await partial(actor, id, 400, 2000, `${RUN}-${sector}-c`);
      expect(r3).toMatchObject({ complete: true, delivered: 2000, pending: 0 });
      expect((await item(id)).operational_status).toBe("entregado");

      const ls = await lines(id);
      expect(ls.map((l) => Number(l.quantity))).toEqual([1000, 600, 400]);
      expect(ls.map((l) => l.kind)).toEqual(["PARCIAL", "PARCIAL", "FINAL"]);
      expect(ls.map((l) => Number(l.cumulative_after))).toEqual([1000, 1600, 2000]);
      expect(ls.map((l) => Number(l.pending_after))).toEqual([1000, 400, 0]);
      expect(ls.every((l) => l.delivered_by === actor.displayName && l.delivered_by_sector === sector && l.source_sector === sector)).toBe(true);
      // Una sola fila agregada (entrega vigente) con el total acumulado.
      const agg = await q("select quantity, delivery_complete, pending_balance from work_item_deliveries where work_item_id = $1 and status = 'ENTREGADO'", [id]);
      expect(agg).toHaveLength(1);
      expect(agg[0]).toMatchObject({ delivery_complete: true });
      // Auditoría: eventos de cada entrega.
      const ev = await q("select type from operational_events where work_item_id = $1 and type in ('WORK_DELIVERED','WORK_DELIVERED_PARTIAL') order by created_at", [id]);
      expect(ev.map((e) => e.type)).toEqual(["WORK_DELIVERED_PARTIAL", "WORK_DELIVERED_PARTIAL", "WORK_DELIVERED"]);
    });
  }

  it("doble clic / reintento con la misma clave NO duplica; recargar no repite", async () => {
    const id = await newWork("ENVASADO_MASIVO", "2000");
    const key = `${RUN}-dup`;
    const a = await partial(masivo, id, 1000, 1000, key);
    const b = await partial(masivo, id, 1000, 1000, key);
    expect(b.replayed).toBe(true);
    expect(b.delivered).toBe(a.delivered);
    expect(await lines(id)).toHaveLength(1);
    const notes = await q("select count(*)::int n from os_notifications where kind = 'entrega_registrada' and message like $1", [`%${CLIENT}%`]);
    expect(Number(notes[0]!.n)).toBeGreaterThanOrEqual(1);
  });

  it("no se puede entregar más que el saldo asignado ni más de lo terminado; cantidad inválida se rechaza sin registrar nada", async () => {
    const id = await newWork("ENVASADO_MASIVO", "2000");
    await expect(partial(masivo, id, 2500, 2500, `${RUN}-x1`)).rejects.toThrow(/supera el saldo/);
    await expect(partial(masivo, id, 1000, 800, `${RUN}-x2`)).rejects.toThrow(/terminad/i); // solo 800 realizadas
    await expect(partial(masivo, id, 0, 800, `${RUN}-x3`)).rejects.toThrow();
    await expect(partial(masivo, id, -5, 800, `${RUN}-x4`)).rejects.toThrow();
    await expect(partial(masivo, id, 10.5, 800, `${RUN}-x5`)).rejects.toThrow(/entero/);
    expect(await lines(id)).toHaveLength(0);
    await partial(masivo, id, 800, 800, `${RUN}-ok`);
    await expect(partial(masivo, id, 300, 800, `${RUN}-x6`)).rejects.toThrow(/terminad/i); // ya entregó las 800 terminadas
    expect((await lines(id)).map((l) => Number(l.quantity))).toEqual([800]);
  });

  it("dos usuarios entregando a la vez no superan el saldo (una gana, la otra se rechaza)", async () => {
    const id = await newWork("ENVASADO_MASIVO", "2000");
    const results = await Promise.allSettled([
      partial(masivo, id, 1500, 2000, `${RUN}-c1`),
      partial({ ...masivo, email: "it-ep-masivo2@laboratoriogenus.com.ar", displayName: "IT Envasado 2" }, id, 1500, 2000, `${RUN}-c2`),
    ]);
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    expect(results.filter((r) => r.status === "rejected")).toHaveLength(1);
    const ls = await lines(id);
    expect(ls).toHaveLength(1);
    expect(Number(ls[0]!.cumulative_after)).toBeLessThanOrEqual(2000);
  });

  it("trabajos del mismo pedido: la parcial de uno no toca al otro; Producción ve cada entrega por separado", async () => {
    const a = await newWork("ENVASADO_MASIVO", "2000", `Pedido A ${RUN}`);
    const b = await newWork("ENVASADO_MASIVO", "1000", `Pedido B ${RUN}`);
    await partial(masivo, a, 1000, 1000, `${RUN}-pa`);
    expect((await item(b)).operational_status).not.toBe("entregado");
    expect(await lines(b)).toHaveLength(0);
    const { listDeliveryLinesDurable } = await import("@/lib/planning/work-item-progress-repository");
    const seen = await listDeliveryLinesDurable(a);
    expect(seen).toHaveLength(1);
    expect(Number(seen[0]!.cumulativeAfter)).toBe(1000);
  });

  it("entrega COMPLETA clásica (sin 'parcial') sigue funcionando y una entrega interna no genera despachos externos", async () => {
    const before = await q("select count(*)::int n from deposito_despachos");
    const id = await newWork("ENVASADO_MASIVO", "500");
    const r = await deliver(prod, id, { deliverQuantity: 500, idempotencyKey: `${RUN}-full` });
    expect(r.complete).toBe(true);
    expect((await item(id)).operational_status).toBe("entregado");
    const id2 = await newWork("ENVASADO_MASIVO", "2000");
    await partial(masivo, id2, 1000, 1000, `${RUN}-nd`);
    const after = await q("select count(*)::int n from deposito_despachos");
    expect(after[0]!.n).toBe(before[0]!.n);
  });
});
