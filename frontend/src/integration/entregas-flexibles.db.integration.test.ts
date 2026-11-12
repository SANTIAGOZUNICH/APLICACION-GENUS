/**
 * Entregas parciales y totales FLEXIBLES contra Postgres de PRUEBA real (caso JACTANS): la cantidad solicitada es una referencia; las cajas
 * y los acumulados previos no bloquean el registro operativo; las diferencias quedan por conciliar y las unidades realizadas se confirman
 * de forma explícita y auditada. Se corre con
 * `GENUS_E2E_VITEST_FILES=src/integration/entregas-flexibles.db.integration.test.ts npm run test:e2e:semanas-priorities-db`.
 */
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { assertMarkedDatabase, e2eEnvironmentProblem } from "../../scripts/e2e/e2e-safety.mjs";

const PROBLEM = e2eEnvironmentProblem() ?? (process.env.GENUS_E2E_DATABASE_URL ? null : "falta GENUS_E2E_DATABASE_URL");
const RUN = Date.now().toString().slice(-6);
const CLIENT = `IT FLX CLIENTE ${RUN}`;
const prod = { email: "it-flx-prod@laboratoriogenus.com.ar", sector: "PRODUCCION" as const, displayName: "IT CR Producción" };
const masivo = { email: "it-flx-masivo@laboratoriogenus.com.ar", sector: "ENVASADO_MASIVO" as const, displayName: "IT FLX Masivo" };
type Boxes = Array<{ cajas: number; unidadesPorCaja: number }>;

describe.skipIf(Boolean(PROBLEM))(`Entregas flexibles en Postgres real${PROBLEM ? ` — saltado: ${PROBLEM}` : ""}`, () => {
  let pool: import("@neondatabase/serverless").Pool;
  const q = async (text: string, params: unknown[] = []) => (await pool.query(text, params)).rows as Record<string, unknown>[];

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

  const newWork = async (sector: string, qty: string, unit = "un.") => {
    const { assignWorkItemDurable } = await import("@/lib/planning/work-assignment-service");
    const r = await assignWorkItemDurable(
      { sector, client: CLIENT, product: `JACTANS ${RUN}-${Math.random().toString(36).slice(2, 6)}`, plannedQuantity: qty, unit, plannedDate: "2031-06-10", ...(sector === "ELABORACION" ? { branchOwner: "Cristian" } : { line: "Línea 1" }), orderNumber: `${sector === "ELABORACION" ? "OE" : "OA"}-2026-${String(300000 + Math.floor(Math.random() * 99999)).padStart(6, "0")}`, packagingLote: "IT-FLX", idempotencyKey: randomUUID() } as never,
      prod,
      randomUUID()
    );
    return r.item.id as string;
  };
  const deliver = async (actor: { email: string; sector: string; displayName: string }, workItemId: string, over: Record<string, unknown>) => {
    const { deliverWorkDurable } = await import("@/lib/planning/work-item-progress-repository");
    return deliverWorkDurable({ workItemId, codigo: null, sourceSector: actor.sector, plannedDeliveryDate: null, actualDeliveredAt: new Date().toISOString(), remito: null, receivedBy: null, observations: null, idempotencyKey: randomUUID(), ...over } as never, actor as never);
  };
  const partial = (id: string, qty: number, realizadas: number | null, boxes: Boxes | null, extra: Record<string, unknown> = {}) =>
    deliver(masivo, id, { partial: true, deliverQuantity: qty, deliveryPackingGroups: boxes, completion: realizadas == null ? {} : { finishedQty: String(realizadas) }, ...extra });
  const lines = (id: string) => q("select quantity::float8 q, kind, cumulative_after::float8 cum, pending_after::float8 pend, packing_groups from work_item_delivery_lines where work_item_id = $1 and status = 'ACTIVA' order by sequence", [id]);
  const item = async (id: string) => (await q("select operational_status, planned_quantity, finished_qty from work_items where id = $1", [id]))[0]!;
  const events = (id: string, type: string) => q("select note, actor_email from operational_events where work_item_id = $1 and type = $2", [id, type]);
  const stockCount = async () => Number((await q("select (select count(*) from mp_stock_movements) + (select count(*) from inv_me_ingresos) + (select count(*) from inv_me_salidas) n"))[0]!.n);

  it("JACTANS: pedido 1.000, primera entrega ~300 con realizadas desactualizadas (300) → la 2.ª de 700 se pide confirmar y se registra; total 1.000", { timeout: 60_000 }, async () => {
    const id = await newWork("ENVASADO_MASIVO", "1000");
    const stock0 = await stockCount();
    expect(await partial(id, 300, 300, [{ cajas: 3, unidadesPorCaja: 100 }])).toMatchObject({ delivered: 300, pending: 700, complete: false });
    // Antes: «Solo hay 0 unidades realizadas sin entregar… registrá el avance» sin alternativa. Ahora: se explica y se ofrece confirmar.
    await expect(partial(id, 700, 300, [{ cajas: 7, unidadesPorCaja: 100 }])).rejects.toThrow(/Si realmente se produjeron más unidades, confirmalo|realizadas/);
    expect((await lines(id)).map((l) => l.q)).toEqual([300]);
    const r = await partial(id, 700, 300, [{ cajas: 7, unidadesPorCaja: 100 }], { confirmProduced: true });
    expect(r).toMatchObject({ delivered: 1000, pending: 0, complete: true });
    expect((await item(id)).operational_status).toBe("entregado");
    expect(String((await item(id)).finished_qty)).toBe("1000"); // las realizadas se confirmaron de forma explícita
    const ev = await events(id, "PRODUCED_CONFIRMED");
    expect(ev).toHaveLength(1);
    expect(String(ev[0]!.note)).toMatch(/realizadas antes=300 \| realizadas confirmadas=1000/);
    expect(await stockCount()).toBe(stock0); // sin movimientos de stock
  });

  it("305 + 710 = 1.015 sobre un pedido de 1.000, cada una con SUS cajas (3×100 + 1×5 y 7×100 + 1×10); sin pendientes negativos", { timeout: 60_000 }, async () => {
    const id = await newWork("ENVASADO_MASIVO", "1000");
    const r1 = await partial(id, 305, 305, [{ cajas: 3, unidadesPorCaja: 100 }, { cajas: 1, unidadesPorCaja: 5 }]);
    expect(r1).toMatchObject({ delivered: 305, pending: 695, complete: false });
    const r2 = await partial(id, 710, 305, [{ cajas: 7, unidadesPorCaja: 100 }, { cajas: 1, unidadesPorCaja: 10 }], { confirmProduced: true });
    expect(r2).toMatchObject({ delivered: 1015, pending: 0, complete: true });
    const ls = await lines(id);
    expect(ls.map((l) => l.q)).toEqual([305, 710]);
    expect(ls.every((l) => Number(l.pend) >= 0)).toBe(true);
    expect(ls[1]!.packing_groups).toEqual([{ cajas: 7, unidadesPorCaja: 100 }, { cajas: 1, unidadesPorCaja: 10 }]);
    expect(String((await item(id)).planned_quantity)).toBe("1000");
    expect(String((await item(id)).finished_qty)).toBe("1015");
  });

  it("cajas flexibles: sin desglose se registra; con cajas que no suman se registra igual, advierte y deja la diferencia trazada", { timeout: 60_000 }, async () => {
    const id = await newWork("ENVASADO_MASIVO", "1000");
    await partial(id, 300, 1000, null); // cajas pendientes de detallar
    const r = await partial(id, 400, 1000, [{ cajas: 3, unidadesPorCaja: 100 }]); // declara 400, cajas = 300
    expect(r).toMatchObject({ delivered: 700 });
    const ls = await lines(id);
    expect(ls.map((l) => l.q)).toEqual([300, 400]);
    expect(ls[0]!.packing_groups).toBeNull();
    expect(ls[1]!.packing_groups).toEqual([{ cajas: 3, unidadesPorCaja: 100 }]); // las cajas informadas se conservan tal cual (no se inventan)
    const diff = await events(id, "DELIVERY_PACKING_DIFF");
    expect(diff).toHaveLength(1);
    expect(String(diff[0]!.note)).toMatch(/unidades declaradas=400 \| unidades en cajas=300 \| diferencia=100/);
    expect(diff[0]!.actor_email).toBe(masivo.email); // quién la confirmó
  });

  it("«Entregar todo» sin desglose de cajas se registra; y más que lo registrado como realizado pide confirmación explícita", { timeout: 60_000 }, async () => {
    const id = await newWork("ENVASADO_MASIVO", "1000");
    await expect(deliver(masivo, id, { deliverQuantity: 1015, completion: { finishedQty: "1000" } })).rejects.toThrow(/confirmalo|supera/);
    const r = await deliver(masivo, id, { deliverQuantity: 1015, confirmProduced: true, completion: { finishedQty: "1000" } });
    expect(r).toMatchObject({ delivered: 1015, pending: 0, complete: true });
    expect(String((await item(id)).finished_qty)).toBe("1015");
    const id2 = await newWork("ENVASADO_PREMIUM", "500");
    const r2 = await deliver({ ...masivo, sector: "ENVASADO_PREMIUM", email: "it-flx-prem@laboratoriogenus.com.ar" }, id2, { completion: { finishedQty: "500" } }); // sin cajas
    expect(r2).toMatchObject({ delivered: 500, complete: true });
  });

  it("parcial y luego «Entregar todo» sin cajas del trabajo completo ni de la entrega: se registra", { timeout: 60_000 }, async () => {
    const id = await newWork("ENVASADO_MASIVO", "1000");
    await partial(id, 305, 1015, [{ cajas: 3, unidadesPorCaja: 100 }, { cajas: 1, unidadesPorCaja: 5 }]);
    const r = await deliver(masivo, id, { completion: { finishedQty: "1015" } });
    expect(r).toMatchObject({ delivered: 1015, complete: true });
    expect((await lines(id)).map((l) => l.q)).toEqual([305, 710]);
  });

  it("no duplica: misma clave = misma entrega; no se entregan dos veces las mismas unidades; dos entregas simultáneas no pasan lo disponible", { timeout: 60_000 }, async () => {
    const id = await newWork("ENVASADO_MASIVO", "1000");
    const key = randomUUID();
    const a = await partial(id, 300, 1000, null, { idempotencyKey: key });
    const b = await partial(id, 300, 1000, null, { idempotencyKey: key });
    expect(b.replayed).toBe(true);
    expect(b.delivered).toBe(a.delivered);
    const res = await Promise.allSettled([partial(id, 600, 1000, null), partial(id, 600, 1000, null)]);
    expect(res.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    expect((await lines(id)).reduce((s, l) => s + Number(l.q), 0)).toBe(900);
  });

  it("Elaboración: 60 kg solicitados, 70 kg elaborados → Producción registra los 70 kg (confirmando los realizados)", { timeout: 60_000 }, async () => {
    const id = await newWork("ELABORACION", "60", "kg");
    const r = await deliver(prod, id, { partial: true, deliverQuantity: 70, confirmProduced: true, completion: { finishedQty: "60" } });
    expect(r).toMatchObject({ delivered: 70, pending: 0, complete: true });
    expect(String((await item(id)).finished_qty)).toBe("70");
    expect(String((await item(id)).planned_quantity)).toBe("60");
  });

  it("editar y cancelar una parcial con cajas que no suman: se acepta y recalcula; cancelar descuenta", { timeout: 60_000 }, async () => {
    const id = await newWork("ENVASADO_MASIVO", "1000");
    await partial(id, 305, 1015, [{ cajas: 3, unidadesPorCaja: 100 }, { cajas: 1, unidadesPorCaja: 5 }]);
    await partial(id, 710, 1015, [{ cajas: 7, unidadesPorCaja: 100 }, { cajas: 1, unidadesPorCaja: 10 }]);
    const svc = await import("@/lib/planning/internal-deliveries-service");
    const rem = await import("@/lib/remitos/delivery-remittance");
    const [, d2] = (await rem.listDeliveriesOfWork(id)).deliveries;
    const ed = await svc.editInternalDelivery(prod as never, { kind: "PRODUCCION", id: d2!.deliveryLineId, quantity: 700 }); // cajas sin tocar (710 u.): diferencia por conciliar
    expect(ed.delivery).toMatchObject({ quantity: 700 });
    expect((await rem.listDeliveriesOfWork(id)).totals).toMatchObject({ received: 1005 });
    const c = await svc.cancelInternalDelivery(prod as never, { kind: "PRODUCCION", id: d2!.deliveryLineId, reason: "se contó mal" });
    expect(c.delivery.status).toBe("CANCELADA");
    expect((await rem.listDeliveriesOfWork(id)).totals).toMatchObject({ received: 305 });
  });

  it("remitos: el borrador toma las unidades reales de la entrega (cajas que no cierran quedan por completar antes de emitir); protege remitos vigentes", { timeout: 60_000 }, async () => {
    const id = await newWork("ENVASADO_MASIVO", "1000");
    await partial(id, 400, 1000, [{ cajas: 3, unidadesPorCaja: 100 }]);
    const rem = await import("@/lib/remitos/delivery-remittance");
    const [d1] = (await rem.listDeliveriesOfWork(id)).deliveries;
    const actor = { email: prod.email, sector: prod.sector, displayName: prod.displayName } as never;
    const a = await rem.prepareRemitoFromDelivery(actor, { deliveryLineId: d1!.deliveryLineId });
    expect(a.remito.lines[0]).toMatchObject({ totalUnits: 400, cajas1: 0 }); // 400 u. reales; sin cajas inventadas
    await expect(rem.prepareRemitoFromDelivery(actor, { deliveryLineId: d1!.deliveryLineId })).rejects.toThrow();
    const svc = await import("@/lib/planning/internal-deliveries-service");
    await expect(svc.cancelInternalDelivery(prod as never, { kind: "PRODUCCION", id: d1!.deliveryLineId, reason: "x" })).rejects.toThrow(/No se puede cancelar/);
  });

  it("permisos: otros sectores no entregan trabajos ajenos", { timeout: 60_000 }, async () => {
    const id = await newWork("ENVASADO_MASIVO", "1000");
    await expect(deliver({ email: "it-flx-mp@laboratoriogenus.com.ar", sector: "MATERIA_PRIMA", displayName: "MP" }, id, { partial: true, deliverQuantity: 10, confirmProduced: true })).rejects.toThrow(/permiso/i);
    await expect(deliver({ email: "it-flx-dep@laboratoriogenus.com.ar", sector: "DEPOSITO", displayName: "Dep" }, id, { partial: true, deliverQuantity: 10, confirmProduced: true })).rejects.toThrow(/permiso/i);
    expect(await lines(id)).toHaveLength(0);
  });
});
