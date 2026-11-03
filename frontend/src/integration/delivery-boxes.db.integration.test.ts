/**
 * Cajas en entregas parciales + «Editar trabajo entregado» — Postgres de PRUEBA real (0080). Servicios reales de entrega a Producción,
 * entrega a Codificado, entregas internas y remitos desde entregas. Datos ficticios «IT BX»; se SALTA sin base marcada.
 */
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { assertMarkedDatabase, e2eEnvironmentProblem } from "../../scripts/e2e/e2e-safety.mjs";

const PROBLEM = e2eEnvironmentProblem() ?? (process.env.GENUS_E2E_DATABASE_URL ? null : "falta GENUS_E2E_DATABASE_URL");
const RUN = Date.now().toString().slice(-6);
const CLIENT = `IT BX CLIENTE ${RUN}`;
const prod = { email: "it-bx-prod@laboratoriogenus.com.ar", sector: "PRODUCCION" as const, displayName: "IT Producción" };
const masivo = { email: "it-bx-masivo@laboratoriogenus.com.ar", sector: "ENVASADO_MASIVO" as const, displayName: "IT Envasado Masivo" };
const premium = { email: "it-bx-premium@laboratoriogenus.com.ar", sector: "ENVASADO_PREMIUM" as const, displayName: "IT Envasado Premium" };
const codif = { email: "it-bx-cod@laboratoriogenus.com.ar", sector: "CODIFICADO" as const, displayName: "IT Codificado" };
const deposito = { email: "it-bx-dep@laboratoriogenus.com.ar", sector: "DEPOSITO" as const, displayName: "IT Depósito" };
type Boxes = Array<{ cajas: number; unidadesPorCaja: number }>;

describe.skipIf(Boolean(PROBLEM))(`Cajas en entregas y edición de trabajos entregados${PROBLEM ? ` — saltado: ${PROBLEM}` : ""}`, () => {
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
    const r = await assignWorkItemDurable({ sector, client: CLIENT, product: `Serum IT ${RUN}-${Math.random().toString(36).slice(2, 6)}`, plannedQuantity: qty, unit: "un.", plannedDate: "2031-06-10", line: "Línea 1", orderNumber: `OA-2026-${String(600000 + Math.floor(Math.random() * 99999)).padStart(6, "0")}`, packagingLote: "L-IT-BX", idempotencyKey: randomUUID() } as never, prod, randomUUID());
    const id = r.item.id as string;
    if (finished) await q("update work_items set finished_qty = $1 where id = $2", [finished, id]);
    return id;
  };
  const deliver = async (actor: typeof masivo | typeof prod | typeof premium | typeof codif, workItemId: string, qty: number, boxes: Boxes | null = null, observations: string | null = null) => {
    const { deliverWorkDurable } = await import("@/lib/planning/work-item-progress-repository");
    return deliverWorkDurable(
      { workItemId, deliverQuantity: qty, partial: true, observations, deliveryPackingGroups: boxes, idempotencyKey: randomUUID(), codigo: null, sourceSector: actor.sector, plannedDeliveryDate: null, actualDeliveredAt: new Date().toISOString(), remito: null, receivedBy: null } as never,
      { email: actor.email, sector: actor.sector, displayName: actor.displayName }
    );
  };
  const transfer = async (actor: typeof masivo | typeof premium, workItemId: string, quantity: number, finishedQty: number | null, packingGroups: Boxes | null = null) =>
    (await trans()).transferToCodificadoDurable({ workItemId, quantity, finishedQty, packingGroups, idempotencyKey: randomUUID() }, actor as never);
  const lines = (workItemId: string) => q("select id, sequence, quantity, status, packing_groups, observations from work_item_delivery_lines where work_item_id = $1 order by sequence", [workItemId]);
  const aggregate = async (workItemId: string) => (await q("select quantity, packing_groups, delivery_complete from work_item_deliveries where work_item_id = $1 and status = 'ENTREGADO'", [workItemId]))[0]!;
  const item = async (id: string) => (await q("select planned_quantity, finished_qty, operational_status from work_items where id = $1", [id]))[0]!;

  it("la migración 0080 es aditiva e idempotente", async () => {
    const { readFileSync } = await import("node:fs");
    const sqlText = readFileSync("drizzle/0080_delivery_boxes.sql", "utf8");
    for (let i = 0; i < 2; i++) for (const stmt of sqlText.split("--> statement-breakpoint").map((x) => x.replace(/--[^\n]*\n/g, "").trim()).filter(Boolean)) await q(stmt);
    expect((await q("select count(*)::int n from information_schema.columns where (table_name='work_item_codificado_transfers' and column_name='packing_groups') or (table_name='internal_delivery_changes' and column_name in ('old_packing','new_packing'))"))[0]!.n).toBe(3);
  });

  it("4-6) entrega parcial con 8 × 100, con cajas incompletas (8 × 100 + 1 × 50) y sin información de cajas; cajas que no suman se rechazan", async () => {
    const id = await newWork("ENVASADO_MASIVO", "2000", "2050");
    await deliver(masivo, id, 800, [{ cajas: 8, unidadesPorCaja: 100 }]);
    await deliver(masivo, id, 850, [{ cajas: 8, unidadesPorCaja: 100 }, { cajas: 1, unidadesPorCaja: 50 }]);
    await expect(deliver(masivo, id, 200, [{ cajas: 1, unidadesPorCaja: 100 }])).rejects.toThrow(/Las cajas suman 100 u\./);
    await deliver(masivo, id, 200); // sin detalle de cajas
    const ls = await lines(id);
    expect(ls.map((l) => [Number(l.quantity), l.packing_groups])).toEqual([
      [800, [{ cajas: 8, unidadesPorCaja: 100 }]],
      [850, [{ cajas: 8, unidadesPorCaja: 100 }, { cajas: 1, unidadesPorCaja: 50 }]],
      [200, null],
    ]);
    // el resumen de cajas de la entrega vigente suma cada tipo de caja por separado
    expect((await aggregate(id)).packing_groups).toEqual([{ cajas: 16, unidadesPorCaja: 100 }, { cajas: 1, unidadesPorCaja: 50 }]);
  });

  it("1-3) editar un trabajo ENTREGADO de 2.000 a 2.050 y 20 × 100 → 20 × 100 + 1 × 50, sin crear entregas ni tocar el pedido", async () => {
    const id = await newWork("ENVASADO_MASIVO", "2000", "2000");
    await deliver(masivo, id, 2000, [{ cajas: 20, unidadesPorCaja: 100 }]);
    expect(await item(id)).toMatchObject({ operational_status: "entregado" });
    const svc = await ids();
    const [l] = await lines(id);
    const linesBefore = (await lines(id)).length;
    // cambiar la cantidad sin tocar las cajas: se exige actualizar el desglose
    await expect(svc.editDeliveredWork(prod as never, { workItemId: id, edits: [{ id: String(l!.id), quantity: 2050 }] })).rejects.toThrow(/actualizá también el desglose de cajas/);
    // cajas que no suman la nueva cantidad: rechazado, sin redondear
    await expect(svc.editDeliveredWork(prod as never, { workItemId: id, edits: [{ id: String(l!.id), quantity: 2050, packingGroups: [{ cajas: 21, unidadesPorCaja: 100 }] }] })).rejects.toThrow(/Las cajas suman 2100 u\./);
    const res = await svc.editDeliveredWork(prod as never, { workItemId: id, edits: [{ id: String(l!.id), quantity: 2050, packingGroups: [{ cajas: 20, unidadesPorCaja: 100 }, { cajas: 1, unidadesPorCaja: 50 }], observations: "Se contó una caja más", expectedVersion: 0 }] });
    expect(res.totals).toMatchObject({ delivered: 2050, cajas: 21, finishedQty: "2050" });
    expect(res.deliveries[0]).toMatchObject({ quantity: 2050, cajas: 21, observations: "Se contó una caja más", version: 1 });
    expect(res.deliveries[0]!.boxesText).toMatch(/20 cajas de 100 u\. \+ 1 caja de 50 u\. = 21 cajas \/ 2\.050 u\./);
    // Entregados (registro de la entrega) y trabajo reflejan los valores nuevos
    expect(await aggregate(id)).toMatchObject({ quantity: "2050", delivery_complete: true, packing_groups: [{ cajas: 20, unidadesPorCaja: 100 }, { cajas: 1, unidadesPorCaja: 50 }] });
    expect(await item(id)).toMatchObject({ planned_quantity: "2000", finished_qty: "2050", operational_status: "entregado" });
    expect((await lines(id)).length).toBe(linesBefore); // ninguna entrega nueva
    // auditoría: cantidades y cajas anteriores y nuevas
    const aud = (await q("select old_quantity, new_quantity, old_packing, new_packing, old_observations, new_observations, actor_sector from internal_delivery_changes where delivery_id = $1", [l!.id]))[0]!;
    expect(aud).toMatchObject({ old_quantity: 2000, new_quantity: 2050, old_packing: [{ cajas: 20, unidadesPorCaja: 100 }], new_packing: [{ cajas: 20, unidadesPorCaja: 100 }, { cajas: 1, unidadesPorCaja: 50 }], new_observations: "Se contó una caja más", actor_sector: "PRODUCCION" });
    // vigente y también más de lo solicitado (2.050 de 2.000)
    expect(Number((await lines(id))[0]!.quantity)).toBe(2050);
  });

  it("7-8) editar una parcial con su desglose y cancelar otra: las cajas y unidades dejan de sumar, pero quedan en el historial", async () => {
    const id = await newWork("ENVASADO_PREMIUM", "2000", "2050");
    await deliver(premium, id, 800, [{ cajas: 8, unidadesPorCaja: 100 }]);
    await deliver(premium, id, 800, [{ cajas: 8, unidadesPorCaja: 100 }]);
    await deliver(premium, id, 450, [{ cajas: 4, unidadesPorCaja: 100 }, { cajas: 1, unidadesPorCaja: 50 }]);
    const [l1, l2, l3] = await lines(id);
    const svc = await ids();
    expect((await aggregate(id)).packing_groups).toEqual([{ cajas: 20, unidadesPorCaja: 100 }, { cajas: 1, unidadesPorCaja: 50 }]);
    // Envasado Premium edita SU entrega (700 en 7 cajas)
    const e = await svc.editInternalDelivery(premium as never, { kind: "PRODUCCION", id: String(l1!.id), quantity: 700, packingGroups: [{ cajas: 7, unidadesPorCaja: 100 }] });
    expect(e.delivery).toMatchObject({ quantity: 700, cajas: 7 });
    expect((await aggregate(id)).packing_groups).toEqual([{ cajas: 19, unidadesPorCaja: 100 }, { cajas: 1, unidadesPorCaja: 50 }]);
    // cancelar la 2.ª: sus 800 unidades y 8 cajas dejan de sumar
    const c = await svc.cancelInternalDelivery(prod as never, { kind: "PRODUCCION", id: String(l2!.id), reason: "Nunca salió" });
    expect(c.delivery.status).toBe("CANCELADA");
    expect(c.totals.delivered).toBe(1150);
    expect((await aggregate(id)).packing_groups).toEqual([{ cajas: 11, unidadesPorCaja: 100 }, { cajas: 1, unidadesPorCaja: 50 }]);
    const cancelledRow = (await lines(id)).find((x) => String(x.id) === String(l2!.id))!;
    expect(cancelledRow).toMatchObject({ status: "ANULADA", packing_groups: [{ cajas: 8, unidadesPorCaja: 100 }] }); // no se borra
    expect((await q("select old_packing, new_packing from internal_delivery_changes where delivery_id = $1 and action = 'CANCELAR'", [l2!.id]))[0]).toMatchObject({ old_packing: [{ cajas: 8, unidadesPorCaja: 100 }], new_packing: null });
    void l3;
  });

  it("9-11) Envasado → Codificado con cajas (800 + 800 + 450): Producción recibe el detalle; Codificado entrega sin recargarlas y NO se cuenta dos veces", async () => {
    const id = await newWork("ENVASADO_MASIVO", "2000", "2050");
    await transfer(masivo, id, 800, 2050, [{ cajas: 8, unidadesPorCaja: 100 }]);
    await transfer(masivo, id, 800, null, [{ cajas: 8, unidadesPorCaja: 100 }]);
    const t3 = await transfer(masivo, id, 450, null, [{ cajas: 4, unidadesPorCaja: 100 }, { cajas: 1, unidadesPorCaja: 50 }]);
    await expect(transfer(masivo, id, 1, null, [{ cajas: 1, unidadesPorCaja: 5 }])).rejects.toThrow();
    expect(t3.transfer.packingGroups).toEqual([{ cajas: 4, unidadesPorCaja: 100 }, { cajas: 1, unidadesPorCaja: 50 }]);
    const svc = await ids();
    // Producción ve las tres entregas con su detalle de origen (sin mezclarlas)
    const list = (await svc.listInternalDeliveries(prod as never, { workItemId: id })).filter((d) => d.kind === "CODIFICADO").sort((a, b) => a.sequence - b.sequence);
    expect(list.map((d) => [d.quantity, d.cajas, d.originSector])).toEqual([[800, 8, "ENVASADO_MASIVO"], [800, 8, "ENVASADO_MASIVO"], [450, 5, "ENVASADO_MASIVO"]]);
    // Codificado entrega a Producción TODO lo recibido, sin cargar cajas: se toman las de Envasado
    const childId = String((await q("select id from work_items where parent_work_item_id = $1", [id]))[0]!.id);
    const { deliverFromCodificadoDurable } = await import("@/lib/planning/codificado-handoff-service");
    await deliverFromCodificadoDurable({ workItemId: childId, deliverQuantity: 2050, idempotencyKey: randomUUID() + "-cod" } as never, codif as never);
    const codLines = await lines(childId);
    expect(codLines).toHaveLength(1);
    // remito con cantidades reales: una sola entrega a Producción (2.050), cajas consolidadas por tipo, sin las internas
    const { previewRemitosFromDeliveries } = await import("@/lib/remitos/from-deliveries");
    const prev = await previewRemitosFromDeliveries([String(codLines[0]!.id)]);
    const eligible = prev.groups.flatMap((g) => g.lines);
    expect(eligible).toHaveLength(1);
    expect(eligible[0]).toMatchObject({ quantity: 2050, packingGroups: [{ cajas: 20, unidadesPorCaja: 100 }, { cajas: 1, unidadesPorCaja: 50 }] });
    // las entregas internas a Codificado NO son entregas al cliente: no figuran como elegibles para remito
    const asLines = await q("select count(*)::int n from work_item_delivery_lines where work_item_id = $1", [id]);
    expect(Number(asLines[0]!.n)).toBe(0);
    // editar las cajas de una entrega a Codificado (la 3.ª pasa de 4 × 100 + 1 × 50 a 4 × 100 + 2 × 25)
    const e = await svc.editInternalDelivery(masivo as never, { kind: "CODIFICADO", id: t3.transfer.id, packingGroups: [{ cajas: 4, unidadesPorCaja: 100 }, { cajas: 2, unidadesPorCaja: 25 }] });
    expect(e.delivery).toMatchObject({ quantity: 450, cajas: 6 });
    // cantidades que no suman con las cajas actuales: rechazado
    await expect(svc.editInternalDelivery(masivo as never, { kind: "CODIFICADO", id: t3.transfer.id, quantity: 500 })).rejects.toThrow(/actualizá también el desglose/);
    // cancelar una entrega a Codificado: sus cajas dejan de verse como vigentes pero siguen en el historial
    const t1 = (await svc.listInternalDeliveries(prod as never, { workItemId: id })).find((d) => d.kind === "CODIFICADO" && d.sequence === 1)!;
    const childLines = (await q("select id from work_item_delivery_lines where work_item_id = $1", [childId])).length;
    expect(childLines).toBe(1);
    void t1;
  });

  it("10, 12) remito con las cantidades reales; una entrega ya incluida en un remito no se modifica en silencio", async () => {
    const id = await newWork("ENVASADO_MASIVO", "2000", "2050");
    await deliver(masivo, id, 800, [{ cajas: 8, unidadesPorCaja: 100 }]);
    await deliver(masivo, id, 450, [{ cajas: 4, unidadesPorCaja: 100 }, { cajas: 1, unidadesPorCaja: 50 }]);
    const [l1, l2] = await lines(id);
    const svc = await ids();
    // Producción corrige la 2.ª ANTES del remito; el remito parte de los datos corregidos
    await svc.editInternalDelivery(prod as never, { kind: "PRODUCCION", id: String(l2!.id), quantity: 500, packingGroups: [{ cajas: 5, unidadesPorCaja: 100 }] });
    const { previewRemitosFromDeliveries, createRemitoDraftsFromDeliveries } = await import("@/lib/remitos/from-deliveries");
    const prev = await previewRemitosFromDeliveries([String(l1!.id), String(l2!.id)]);
    const eligible = prev.groups.flatMap((g) => g.lines).sort((a, b) => a.quantity - b.quantity);
    expect(eligible.map((e) => [e.quantity, e.packingGroups])).toEqual([[500, [{ cajas: 5, unidadesPorCaja: 100 }]], [800, [{ cajas: 8, unidadesPorCaja: 100 }]]]);
    // se confecciona el borrador de remito con la 1.ª entrega
    // (el servicio de remitos usa memoria bajo vitest: se simula el vínculo que deja un borrador de remito en la base real)
    void createRemitoDraftsFromDeliveries;
    const [rm] = await q("insert into remitos (remito_number, client_id_normalized, client_display, delivery_date, status) values ($1,'it-bx','IT BX', current_date, 'BORRADOR') returning id", [`IT-BX-${RUN}`]);
    await q("insert into remito_work_links (remito_id, work_item_id) values ($1, $2)", [rm!.id, `dl:${l1!.id}`]);
    const after = (await svc.listInternalDeliveries(prod as never, { workItemId: id })).find((d) => d.id === String(l1!.id))!;
    expect(after.remito).toMatchObject({ status: expect.any(String) });
    await expect(svc.editInternalDelivery(prod as never, { kind: "PRODUCCION", id: String(l1!.id), quantity: 700, packingGroups: [{ cajas: 7, unidadesPorCaja: 100 }] })).rejects.toThrow(/ya figura en el remito/);
    await expect(svc.cancelInternalDelivery(prod as never, { kind: "PRODUCCION", id: String(l1!.id), reason: "x" })).rejects.toThrow(/ya figura en el remito/);
    expect(Number((await lines(id))[0]!.quantity)).toBe(800); // intacta
    // la que no está en un remito sigue pudiendo corregirse
    await svc.editInternalDelivery(prod as never, { kind: "PRODUCCION", id: String(l2!.id), observations: "ok" });
  });

  it("14) permisos: Producción edita trabajos entregados; Envasado/Codificado solo las cajas de SUS entregas; Depósito nada", async () => {
    const id = await newWork("ENVASADO_MASIVO", "2000", "2000");
    await deliver(masivo, id, 1000, [{ cajas: 10, unidadesPorCaja: 100 }]);
    const [l] = await lines(id);
    const svc = await ids();
    await expect(svc.editDeliveredWork(masivo as never, { workItemId: id, edits: [{ id: String(l!.id), observations: "x" }] })).rejects.toThrow(/Solo Producción/);
    await expect(svc.editDeliveredWork(deposito as never, { workItemId: id, edits: [{ id: String(l!.id), observations: "x" }] })).rejects.toThrow(/Solo Producción/);
    await expect(svc.editInternalDelivery(premium as never, { kind: "PRODUCCION", id: String(l!.id), packingGroups: [{ cajas: 5, unidadesPorCaja: 200 }] })).rejects.toThrow(/tu propio sector/);
    await expect(svc.editInternalDelivery(deposito as never, { kind: "PRODUCCION", id: String(l!.id), packingGroups: [{ cajas: 5, unidadesPorCaja: 200 }] })).rejects.toThrow(/permiso/);
    // el sector dueño corrige sus propias cajas (misma cantidad, otra distribución)
    const own = await svc.editInternalDelivery(masivo as never, { kind: "PRODUCCION", id: String(l!.id), packingGroups: [{ cajas: 5, unidadesPorCaja: 200 }] });
    expect(own.delivery).toMatchObject({ cajas: 5, quantity: 1000 });
    // una entrega de otro trabajo no se cuela en el lote de edición
    const other = await newWork("ENVASADO_MASIVO", "100", "100");
    await deliver(masivo, other, 100);
    const lo = (await lines(other))[0]!;
    await expect(svc.editDeliveredWork(prod as never, { workItemId: id, edits: [{ id: String(lo.id), observations: "x" }] })).rejects.toThrow(/no pertenece a este trabajo/);
  });

  it("1, 15) entrega histórica SIN renglones: Producción corrige cantidad y cajas del registro, con auditoría; persiste tras recargar", async () => {
    const id = await newWork("ENVASADO_MASIVO", "2000");
    const [d] = await q(
      `insert into work_item_deliveries (work_item_id, product, client, source_sector, quantity, unit, actual_delivered_at, delivered_by, delivered_by_sector, status, packing_groups)
       values ($1, 'Serum histórico', $2, 'ENVASADO_MASIVO', '2000', 'un.', now(), 'hist', 'ENVASADO_MASIVO', 'ENTREGADO', $3::jsonb) returning id`,
      [id, CLIENT, JSON.stringify([{ cajas: 20, unidadesPorCaja: 100 }])]
    );
    const svc = await ids();
    await expect(svc.editLegacyDelivery(masivo as never, { deliveryId: String(d!.id), quantity: 2050 })).rejects.toThrow(/Solo Producción/);
    await expect(svc.editLegacyDelivery(prod as never, { deliveryId: String(d!.id), quantity: 2050 })).rejects.toThrow(/actualizá también el desglose/);
    const r = await svc.editLegacyDelivery(prod as never, { deliveryId: String(d!.id), quantity: 2050, packingGroups: [{ cajas: 20, unidadesPorCaja: 100 }, { cajas: 1, unidadesPorCaja: 50 }], observations: "Corregida" });
    expect(r).toMatchObject({ quantity: "2050", cajas: 21 });
    vi.resetModules();
    expect((await q("select quantity, observations, packing_groups from work_item_deliveries where id = $1", [d!.id]))[0]).toMatchObject({ quantity: "2050", observations: "Corregida", packing_groups: [{ cajas: 20, unidadesPorCaja: 100 }, { cajas: 1, unidadesPorCaja: 50 }] });
    expect((await q("select old_quantity, new_quantity, kind from internal_delivery_changes where delivery_id = $1", [d!.id]))[0]).toMatchObject({ kind: "ENTREGA", old_quantity: 2000, new_quantity: 2050 });
    expect((await item(id)).planned_quantity).toBe("2000");
    expect(Number((await q("select count(*)::int n from work_item_delivery_lines where work_item_id = $1", [id]))[0]!.n)).toBe(0); // sin renglones nuevos
  });
});
