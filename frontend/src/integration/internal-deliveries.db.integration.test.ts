/**
 * Entregas INTERNAS: más de lo pedido, editar y cancelar — contra un Postgres de PRUEBA real (0079). Usa los servicios reales
 * (entrega parcial a Producción, entrega parcial a Codificado) y el servicio de correcciones. Datos ficticios «IT ID»; se SALTA sin base marcada.
 */
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { assertMarkedDatabase, e2eEnvironmentProblem } from "../../scripts/e2e/e2e-safety.mjs";

const PROBLEM = e2eEnvironmentProblem() ?? (process.env.GENUS_E2E_DATABASE_URL ? null : "falta GENUS_E2E_DATABASE_URL");
const RUN = Date.now().toString().slice(-6);
const CLIENT = `IT ID CLIENTE ${RUN}`;
const prod = { email: "it-id-prod@laboratoriogenus.com.ar", sector: "PRODUCCION" as const, displayName: "IT Producción" };
const masivo = { email: "it-id-masivo@laboratoriogenus.com.ar", sector: "ENVASADO_MASIVO" as const, displayName: "IT Envasado Masivo" };
const premium = { email: "it-id-premium@laboratoriogenus.com.ar", sector: "ENVASADO_PREMIUM" as const, displayName: "IT Envasado Premium" };
const codif = { email: "it-id-cod@laboratoriogenus.com.ar", sector: "CODIFICADO" as const, displayName: "IT Codificado" };
const deposito = { email: "it-id-dep@laboratoriogenus.com.ar", sector: "DEPOSITO" as const, displayName: "IT Depósito" };
const elab = { email: "it-id-elab@laboratoriogenus.com.ar", sector: "ELABORACION" as const, displayName: "IT Elaboración" };

describe.skipIf(Boolean(PROBLEM))(`Entregas internas: más de lo pedido, editar y cancelar${PROBLEM ? ` — saltado: ${PROBLEM}` : ""}`, () => {
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

  it("la migración 0079 es aditiva e idempotente", async () => {
    const { readFileSync } = await import("node:fs");
    const sqlText = readFileSync("drizzle/0079_internal_delivery_changes.sql", "utf8");
    for (let i = 0; i < 2; i++) for (const stmt of sqlText.split("--> statement-breakpoint").map((x) => x.replace(/--[^\n]*\n/g, "").trim()).filter(Boolean)) await q(stmt);
    expect((await q("select count(*)::int n from information_schema.tables where table_name='internal_delivery_changes'"))[0]!.n).toBe(1);
  });

  it("1) pedido 2.000 con 2.050 realizadas: se entregan 2.050 (con observación opcional), se completa sin pendiente negativo y no cambia el pedido", async () => {
    const id = await newWork("ENVASADO_MASIVO", "2000", "2050");
    const r = await deliver(masivo, id, 2050, "50 unidades de más");
    expect(r).toMatchObject({ complete: true, delivered: 2050, pending: 0 });
    expect((await lines(id))[0]).toMatchObject({ quantity: 2050, status: "ACTIVA", observations: "50 unidades de más" });
    expect(await item(id)).toMatchObject({ planned_quantity: "2000", operational_status: "entregado" });
    // sin la observación también (no es obligatoria) y sin textos automáticos de excedente
    const id2 = await newWork("ENVASADO_MASIVO", "2000", "2050");
    await deliver(masivo, id2, 2050);
    expect((await lines(id2))[0]!.observations).toBeNull();
    // el listado muestra 2.050 entregadas sin ninguna columna de excedente
    const list = (await (await ids()).listInternalDeliveries(prod as never, { q: CLIENT })).filter((d) => d.workItemId === id);
    expect(list).toHaveLength(1);
    expect(list[0]).toMatchObject({ client: CLIENT, quantity: 2050, observations: "50 unidades de más", status: "ACTIVA" });
    expect(JSON.stringify(list[0])).not.toMatch(/exced|sobreprod|adicional/i);
  });

  it("2) entregas parciales 1.000 + 800 + 250 = 2.050: las tres se aceptan y el trabajo se completa en la tercera", async () => {
    const id = await newWork("ENVASADO_PREMIUM", "2000", "2050");
    expect(await deliver(premium, id, 1000)).toMatchObject({ complete: false, pending: 1000 });
    expect(await deliver(premium, id, 800)).toMatchObject({ complete: false, pending: 200 });
    expect(await deliver(premium, id, 250)).toMatchObject({ complete: true, delivered: 2050, pending: 0 });
    expect((await lines(id)).map((l) => Number(l.quantity))).toEqual([1000, 800, 250]);
    expect((await item(id)).planned_quantity).toBe("2000");
    // no se puede entregar más de lo realizado
    await expect(deliver(premium, id, 1)).resolves.toMatchObject({ complete: true }); // ya estaba entregado: reintento sin efecto
    expect((await lines(id)).length).toBe(3);
  });

  it("sin realizadas registradas no se inventan unidades: 2.050 sobre un pedido de 2.000 se rechaza pidiendo registrarlas", async () => {
    const id = await newWork("ENVASADO_MASIVO", "2000");
    await expect(deliver(masivo, id, 2050)).rejects.toThrow(/Registrá el avance|registralas primero/);
    expect((await lines(id)).length).toBe(0);
  });

  it("5) editar una entrega de 2.000 a 2.050: actualiza totales, declara las realizadas, queda auditado y no toca el pedido", async () => {
    const id = await newWork("ENVASADO_MASIVO", "2000", "2000");
    await deliver(masivo, id, 2000);
    const [l] = await lines(id);
    const res = await (await ids()).editInternalDelivery(masivo as never, { kind: "PRODUCCION", id: String(l!.id), quantity: 2050, observations: "50 unidades de más", expectedVersion: 0 });
    expect(res.delivery).toMatchObject({ quantity: 2050, observations: "50 unidades de más", status: "ACTIVA", version: 1 });
    expect(res.totals).toMatchObject({ delivered: 2050, finishedQty: "2050" });
    expect(res.notice).toMatch(/2050 unidades realizadas/);
    expect(await item(id)).toMatchObject({ planned_quantity: "2000", finished_qty: "2050", operational_status: "entregado" });
    expect((await lines(id))[0]).toMatchObject({ quantity: 2050, cumulative_after: 2050, pending_after: 0 });
    const aud = await changes(String(l!.id));
    expect(aud).toHaveLength(1);
    expect(aud[0]).toMatchObject({ kind: "PRODUCCION", action: "EDITAR", old_quantity: 2000, new_quantity: 2050, old_observations: null, new_observations: "50 unidades de más", finished_before: "2000", finished_after: "2050", actor_email: masivo.email, actor_sector: "ENVASADO_MASIVO" });
  });

  it("7-8) cancelar una entrega de 800: deja de sumar, recalcula pendientes y estado, sigue visible como CANCELADA y permite una nueva entrega sin duplicar", async () => {
    const id = await newWork("ENVASADO_MASIVO", "2000", "2000");
    await deliver(masivo, id, 1200);
    await deliver(masivo, id, 800);
    expect((await item(id)).operational_status).toBe("entregado");
    const l2 = (await lines(id))[1]!;
    await expect((await ids()).cancelInternalDelivery(masivo as never, { kind: "PRODUCCION", id: String(l2.id), reason: "  " })).rejects.toThrow(/motivo/);
    const res = await (await ids()).cancelInternalDelivery(prod as never, { kind: "PRODUCCION", id: String(l2.id), reason: "Nunca se entregó" });
    expect(res.delivery).toMatchObject({ status: "CANCELADA", cancelReason: "Nunca se entregó", quantity: 800 });
    expect(res.totals.delivered).toBe(1200);
    expect(await item(id)).toMatchObject({ operational_status: "en_curso", planned_quantity: "2000" });
    expect((await lines(id)).map((l) => [Number(l.quantity), l.status])).toEqual([[1200, "ACTIVA"], [800, "ANULADA"]]);
    expect(Number((await lines(id))[0]!.pending_after)).toBe(800);
    const visible = (await (await ids()).listInternalDeliveries(prod as never, { q: CLIENT })).filter((d) => d.workItemId === id);
    expect(visible.map((d) => [d.quantity, d.status])).toEqual(expect.arrayContaining([[800, "CANCELADA"], [1200, "ACTIVA"]]));
    // cancelar dos veces: ya cancelada
    await expect((await ids()).cancelInternalDelivery(prod as never, { kind: "PRODUCCION", id: String(l2.id), reason: "otra vez" })).rejects.toThrow(/ya está cancelada/);
    // se puede entregar de nuevo lo que faltaba (800), sin duplicar cantidades
    expect(await deliver(masivo, id, 800)).toMatchObject({ complete: true, delivered: 2000 });
    expect((await lines(id)).filter((l) => l.status === "ACTIVA").reduce((s, l) => s + Number(l.quantity), 0)).toBe(2000);
    // cancelar TODAS las vigentes anula el agregado y permite empezar de cero
    for (const l of (await lines(id)).filter((x) => x.status === "ACTIVA")) await (await ids()).cancelInternalDelivery(prod as never, { kind: "PRODUCCION", id: String(l.id), reason: "error de carga" });
    expect((await q("select status from work_item_deliveries where work_item_id = $1", [id])).every((r) => r.status === "ANULADO")).toBe(true);
    expect(await deliver(masivo, id, 500)).toMatchObject({ complete: false, delivered: 500 });
  });

  it("6, 8-10) entregas a Codificado 800 + 700: Producción edita la 2.ª a 900 (1.700 recibidas) y cancela la 1.ª (900); Codificado ve las cantidades corregidas", async () => {
    const id = await newWork("ENVASADO_MASIVO", "2000");
    const t1 = (await transfer(masivo, id, 800, 800)).transfer;
    const t2 = (await transfer(masivo, id, 700, 1500)).transfer;
    const childId = String((await q("select id from work_items where parent_work_item_id = $1", [id]))[0]!.id);
    expect((await (await trans()).getCodificadoTransferView(childId, codif as never)).summary.received).toBe(1500);

    const e = await (await ids()).editInternalDelivery(prod as never, { kind: "CODIFICADO", id: t2.id, quantity: 900 });
    expect(e.delivery).toMatchObject({ quantity: 900, version: 1, originSector: "ENVASADO_MASIVO", destination: "CODIFICADO" });
    expect(e.totals.transferredToCodificado).toBe(1700);
    // 800 + 900 = 1.700 supera las 1.500 realizadas: la corrección declara las 1.700 (queda en el historial)
    expect(e.notice).toMatch(/1700 unidades realizadas/);
    expect(e.totals.finishedQty).toBe("1700");
    const v = await (await trans()).getCodificadoTransferView(childId, codif as never);
    expect(v.summary.received).toBe(1700);
    expect((await transfers(id)).map((t) => [Number(t.seq), Number(t.quantity), Number(t.cumulative), t.status])).toEqual([[1, 800, 800, "ACTIVA"], [2, 900, 1700, "ACTIVA"]]);
    expect((await (await trans()).listCodificadoReceipts(codif as never)).filter((r) => r.workItemId === id).map((r) => r.quantity).sort()).toEqual([800, 900]);

    const c = await (await ids()).cancelInternalDelivery(masivo as never, { kind: "CODIFICADO", id: t1.id, reason: "No se envió" });
    expect(c.delivery.status).toBe("CANCELADA");
    expect(c.totals.transferredToCodificado).toBe(900);
    expect((await (await trans()).getCodificadoTransferView(childId, codif as never)).summary.received).toBe(900);
    expect((await (await trans()).listCodificadoReceipts(codif as never)).filter((r) => r.workItemId === id).map((r) => r.quantity)).toEqual([900]);
    expect((await transfers(id)).find((t) => Number(t.seq) === 2)).toMatchObject({ cumulative: 900 });
    expect((await item(id)).planned_quantity).toBe("2000");
    // trazabilidad
    expect((await changes(t1.id))[0]).toMatchObject({ action: "CANCELAR", reason: "No se envió", actor_sector: "ENVASADO_MASIVO", old_quantity: 800 });
    expect((await changes(t2.id))[0]).toMatchObject({ action: "EDITAR", old_quantity: 700, new_quantity: 900, actor_sector: "PRODUCCION", actor_email: prod.email });
  });

  it("11) no se reduce ni se cancela por debajo de lo que Codificado ya procesó; sin dependientes se corrige normalmente", async () => {
    const id = await newWork("ENVASADO_PREMIUM", "2000");
    const t = (await transfer(premium, id, 1000, 1000)).transfer;
    const childId = String((await q("select id from work_items where parent_work_item_id = $1", [id]))[0]!.id);
    await (await trans()).recordCodificadoProgressDurable({ workItemId: childId, codedUnits: 900 }, codif as never);
    await expect((await ids()).editInternalDelivery(premium as never, { kind: "CODIFICADO", id: t.id, quantity: 500 })).rejects.toThrow("No se puede reducir esta entrega porque Codificado ya procesó 900 unidades");
    await expect((await ids()).cancelInternalDelivery(prod as never, { kind: "CODIFICADO", id: t.id, reason: "x" })).rejects.toThrow("No se puede cancelar esta entrega porque Codificado ya procesó 900 unidades");
    expect(Number((await transfers(id))[0]!.quantity)).toBe(1000);
    expect((await q("select status from work_items where id = $1", [childId]))[0]).toBeTruthy();
    // reducir sin bajar de lo procesado sí se puede
    expect((await (await ids()).editInternalDelivery(premium as never, { kind: "CODIFICADO", id: t.id, quantity: 950 })).totals.transferredToCodificado).toBe(950);
    // y subir: 1.000 realizadas → declarar 1.100 realizadas al corregir a 1.100
    const up = await (await ids()).editInternalDelivery(premium as never, { kind: "CODIFICADO", id: t.id, quantity: 1100 });
    expect(up.totals).toMatchObject({ transferredToCodificado: 1100, finishedQty: "1100" });
  });

  it("12-13) doble clic y ediciones simultáneas: una sola modificación; la otra se rechaza por versión vieja", async () => {
    const id = await newWork("ENVASADO_MASIVO", "2000", "2000");
    await deliver(masivo, id, 1000);
    const l = (await lines(id))[0]!;
    const svc = await ids();
    const results = await Promise.allSettled([
      svc.editInternalDelivery(masivo as never, { kind: "PRODUCCION", id: String(l.id), quantity: 1100, expectedVersion: 0 }),
      svc.editInternalDelivery(prod as never, { kind: "PRODUCCION", id: String(l.id), quantity: 1200, expectedVersion: 0 }),
    ]);
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    const rejected = results.find((r) => r.status === "rejected") as PromiseRejectedResult;
    expect(rejected.reason).toBeInstanceOf(svc.InternalDeliveryConflictError);
    expect((await changes(String(l.id))).length).toBe(1);
    // mismo envío repetido con la versión vieja: no modifica de nuevo
    await expect(svc.editInternalDelivery(masivo as never, { kind: "PRODUCCION", id: String(l.id), quantity: 1100, expectedVersion: 0 })).rejects.toBeInstanceOf(svc.InternalDeliveryConflictError);
    // sin cambios: rechazado (no ensucia el historial)
    const cur = Number((await lines(id))[0]!.quantity);
    await expect(svc.editInternalDelivery(masivo as never, { kind: "PRODUCCION", id: String(l.id), quantity: cur, expectedVersion: 1 })).rejects.toThrow(/No hay cambios/);
    // cancelaciones simultáneas: una sola
    const cancels = await Promise.allSettled([1, 2, 3].map(() => svc.cancelInternalDelivery(prod as never, { kind: "PRODUCCION", id: String(l.id), reason: "doble clic" })));
    expect(cancels.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    expect((await changes(String(l.id))).filter((c) => c.action === "CANCELAR")).toHaveLength(1);
  });

  it("14) permisos en el servidor: cada sector solo las suyas; Producción todas; Depósito/Calidad no consultan; cantidades inválidas rechazadas", async () => {
    const svc = await ids();
    const idM = await newWork("ENVASADO_MASIVO", "1000", "1000");
    await deliver(masivo, idM, 400);
    const lm = String((await lines(idM))[0]!.id);
    await expect(svc.editInternalDelivery(premium as never, { kind: "PRODUCCION", id: lm, quantity: 300 })).rejects.toThrow(/tu propio sector/);
    await expect(svc.cancelInternalDelivery(codif as never, { kind: "PRODUCCION", id: lm, reason: "x" })).rejects.toThrow(/tu propio sector/);
    await expect(svc.editInternalDelivery(deposito as never, { kind: "PRODUCCION", id: lm, quantity: 300 })).rejects.toThrow(/permiso/);
    await expect(svc.listInternalDeliveries(deposito as never)).rejects.toThrow(/permiso/);
    await expect(svc.getInternalDeliveryHistory(premium as never, "PRODUCCION", lm)).rejects.toThrow(/tu sector/);
    for (const bad of [0, -5, 10.5]) await expect(svc.editInternalDelivery(masivo as never, { kind: "PRODUCCION", id: lm, quantity: bad })).rejects.toThrow(/mayor que 0|entero/);
    expect(Number((await lines(idM))[0]!.quantity)).toBe(400);
    // cada sector ve solo lo suyo; Producción ve todo; Elaboración (sin entregas internas registradas) ve vacío
    const mine = (await svc.listInternalDeliveries(masivo as never, { q: CLIENT })).map((d) => d.originSector);
    expect(mine.length).toBeGreaterThan(0);
    expect(new Set(mine)).toEqual(new Set(["ENVASADO_MASIVO"]));
    expect((await svc.listInternalDeliveries(prod as never, { q: CLIENT })).some((d) => d.originSector === "ENVASADO_PREMIUM")).toBe(true);
    expect(await svc.listInternalDeliveries(elab as never, { q: CLIENT })).toEqual([]);
    expect((await svc.listInternalDeliveries(prod as never, { q: CLIENT })).find((d) => d.id === lm)).toMatchObject({ canManage: true });
    expect((await svc.listInternalDeliveries(masivo as never, { q: CLIENT })).find((d) => d.id === lm)).toMatchObject({ canManage: true });
    expect((await svc.listInternalDeliveries(prod as never, { q: CLIENT, status: "CANCELADA" })).every((d) => d.status === "CANCELADA")).toBe(true);
    // historial visible para quien corresponde
    await svc.editInternalDelivery(masivo as never, { kind: "PRODUCCION", id: lm, quantity: 450 });
    expect((await svc.getInternalDeliveryHistory(prod as never, "PRODUCCION", lm))[0]).toMatchObject({ action: "EDITAR", oldQuantity: 400, newQuantity: 450, actorSectorLabel: "Envasado Masivo" });
  });

  it("15-19) persiste tras recargar, no toca entregas externas ni stock, y las muestras no generan errores de conciliación", async () => {
    const stock = async () => JSON.stringify([(await q("select count(*)::int n from inv_me_ingresos"))[0], (await q("select count(*)::int n from inv_me_salidas"))[0], (await q("select count(*)::int n from inv_ajustes"))[0]]);
    const before = await stock();
    const id = await newWork("ENVASADO_MASIVO", "2000", "2000");
    await q("update work_items set sample_units = 20 where id = $1", [id]);
    await deliver(masivo, id, 1500);
    const l = String((await lines(id))[0]!.id);
    const svc = await ids();
    const extDeliveriesBefore = Number((await q("select count(*)::int n from work_item_deliveries where work_item_id = $1", [id]))[0]!.n);
    await svc.editInternalDelivery(masivo as never, { kind: "PRODUCCION", id: l, quantity: 1600 });
    vi.resetModules(); // «recargar»
    const again = (await (await ids()).listInternalDeliveries(prod as never, { q: CLIENT })).find((d) => d.id === l)!;
    expect(again).toMatchObject({ quantity: 1600, version: 1, status: "ACTIVA" });
    expect(await item(id)).toMatchObject({ planned_quantity: "2000", sample_units: 20 }); // pedido y muestras intactos
    expect(Number((await q("select count(*)::int n from work_item_deliveries where work_item_id = $1", [id]))[0]!.n)).toBe(extDeliveriesBefore); // sin entregas nuevas
    expect(await stock()).toBe(before); // sin movimientos de inventario
    expect(Number((await q("select count(*)::int n from internal_delivery_changes where delivery_id = $1", [l]))[0]!.n)).toBe(1);
  });
});
