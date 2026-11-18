/**
 * Envasado → pestaña «Entregados» (0085): listado paginado de las entregas del sector y «Quitar del listado» como soft-hide, contra un Postgres
 * de PRUEBA real y con los servicios reales (entrega parcial a Producción / a Codificado). Datos ficticios «IT ID»; se SALTA sin base marcada.
 */
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { assertMarkedDatabase, e2eEnvironmentProblem } from "../../scripts/e2e/e2e-safety.mjs";

const PROBLEM = e2eEnvironmentProblem() ?? (process.env.GENUS_E2E_DATABASE_URL ? null : "falta GENUS_E2E_DATABASE_URL");
const RUN = Date.now().toString().slice(-6);
const CLIENT = `IT ENT CLIENTE ${RUN}`;
const prod = { email: "it-id-prod@laboratoriogenus.com.ar", sector: "PRODUCCION" as const, displayName: "IT Producción" };
const masivo = { email: "it-id-masivo@laboratoriogenus.com.ar", sector: "ENVASADO_MASIVO" as const, displayName: "IT Envasado Masivo" };
const premium = { email: "it-id-premium@laboratoriogenus.com.ar", sector: "ENVASADO_PREMIUM" as const, displayName: "IT Envasado Premium" };
const codif = { email: "it-id-cod@laboratoriogenus.com.ar", sector: "CODIFICADO" as const, displayName: "IT Codificado" };
const deposito = { email: "it-id-dep@laboratoriogenus.com.ar", sector: "DEPOSITO" as const, displayName: "IT Depósito" };
const elab = { email: "it-id-elab@laboratoriogenus.com.ar", sector: "ELABORACION" as const, displayName: "IT Elaboración" };

describe.skipIf(Boolean(PROBLEM))(`Envasado → Entregados: historial por sector y ocultar/restaurar sin tocar la entrega${PROBLEM ? ` — saltado: ${PROBLEM}` : ""}`, () => {
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

  const page = (actor: Parameters<typeof newWorkActor>[0], f: Record<string, unknown> = {}) => ids().then((m) => m.listInternalDeliveriesPage(actor as never, { q: CLIENT, hidden: "exclude", limit: 100, ...f } as never));
  function newWorkActor(a: typeof masivo | typeof premium | typeof prod | typeof codif | typeof deposito | typeof elab) { return a; }
  const snapshot = async (workItemId: string) => ({
    lines: await lines(workItemId),
    transfers: await transfers(workItemId),
    item: await item(workItemId),
    remitos: (await q("select count(*)::int n from remitos"))[0]!.n,
    inv: (await q("select (select count(*)::int from inv_me_salidas) a, (select count(*)::int from inv_me_ingresos) b, (select count(*)::int from inv_mp_ingresos) c"))[0],
    changes: (await q("select count(*)::int n from internal_delivery_changes"))[0]!.n,
  });

  it("0) la migración 0085 es aditiva e idempotente", async () => {
    const { readFileSync } = await import("node:fs");
    const sqlText = readFileSync("drizzle/0085_envasado_delivery_list_hides.sql", "utf8");
    for (let i = 0; i < 2; i++) for (const stmt of sqlText.split("--> statement-breakpoint").map((x) => x.replace(/--[^\n]*\n/g, "").trim()).filter(Boolean)) await q(stmt);
    expect((await q("select count(*)::int n from information_schema.tables where table_name='internal_delivery_hides'"))[0]!.n).toBe(1);
  });

  it("1) entrega parcial 300 de 1.000: aparece en Entregados como Parcial y el trabajo SIGUE pendiente; la segunda (700) no reemplaza a la primera", async () => {
    const id = await newWork("ENVASADO_MASIVO", "1000", "1000");
    await deliver(masivo, id, 300);
    let mine = (await page(masivo)).items.filter((d) => d.workItemId === id);
    expect(mine.map((d) => [d.quantity, d.tipo, d.destination])).toEqual([[300, "PARCIAL", "PRODUCCION"]]);
    expect((await item(id)).operational_status).not.toBe("entregado"); // sigue en Pendientes (saldo real 700)
    await deliver(masivo, id, 700);
    mine = (await page(masivo)).items.filter((d) => d.workItemId === id);
    expect(mine.map((d) => [d.quantity, d.tipo]).sort()).toEqual([[300, "PARCIAL"], [700, "TOTAL"]].sort());
    expect(mine[0]).toMatchObject({ client: CLIENT, originSector: "ENVASADO_MASIVO", deliveredBy: masivo.displayName });
    expect((await item(id)).operational_status).toBe("entregado");
  });

  it("2) las cantidades reales se muestran tal cual (305 + 710 = 1.015 sobre un pedido de 1.000)", async () => {
    const id = await newWork("ENVASADO_PREMIUM", "1000", "1015");
    await deliver(premium, id, 305, "primera");
    await deliver(premium, id, 710, "segunda");
    const mine = (await page(premium)).items.filter((d) => d.workItemId === id);
    expect(mine.map((d) => d.quantity).sort((a, b) => a - b)).toEqual([305, 710]);
    expect(mine.reduce((s, d) => s + d.quantity, 0)).toBe(1015);
    expect(mine.find((d) => d.quantity === 710)).toMatchObject({ tipo: "TOTAL", observations: "segunda" });
  });

  it("3) cada sector ve solo lo suyo; Producción ve todo; las entregas a Codificado figuran con su destino", async () => {
    const m = await newWork("ENVASADO_MASIVO", "500", "500");
    const p = await newWork("ENVASADO_PREMIUM", "500", "500");
    await deliver(masivo, m, 200);
    await deliver(premium, p, 100);
    await transfer(masivo, m, 150, 500, "para codificar");
    const vm = (await page(masivo)).items;
    const vp = (await page(premium)).items;
    expect(vm.every((d) => d.originSector === "ENVASADO_MASIVO")).toBe(true);
    expect(vp.every((d) => d.originSector === "ENVASADO_PREMIUM")).toBe(true);
    expect(vm.filter((d) => d.workItemId === m).map((d) => d.destination).sort()).toEqual(["CODIFICADO", "PRODUCCION"]);
    expect(vm.some((d) => d.workItemId === p)).toBe(false);
    expect(vp.some((d) => d.workItemId === m)).toBe(false);
    const all = (await page(prod)).items.map((d) => d.workItemId);
    expect(all).toEqual(expect.arrayContaining([m, p]));
  });

  it("4) Quitar del listado: oculta solo de ese listado y NO modifica entrega, trabajo, remitos, recepciones, stock ni historial de cambios; restaurar la devuelve", async () => {
    const id = await newWork("ENVASADO_MASIVO", "400", "400");
    await deliver(masivo, id, 150);
    await transfer(masivo, id, 100, null, "a codificado");
    const before = await snapshot(id);
    const list = (await page(masivo)).items.filter((d) => d.workItemId === id);
    expect(list).toHaveLength(2);
    for (const d of list) await (await ids()).setInternalDeliveryHidden(masivo as never, { kind: d.kind, id: d.id, hidden: true });
    await (await ids()).setInternalDeliveryHidden(masivo as never, { kind: list[0]!.kind, id: list[0]!.id, hidden: true }); // idempotente
    const after = await snapshot(id);
    expect(after).toEqual(before);
    expect((await page(masivo)).items.filter((d) => d.workItemId === id)).toHaveLength(0);
    const hidden = await page(masivo, { hidden: "only" });
    expect(hidden.items.filter((d) => d.workItemId === id).map((d) => d.hidden)).toEqual([true, true]);
    expect(hidden.hiddenCount).toBeGreaterThanOrEqual(2);
    // Producción conserva el historial completo; Premium no ve nada de Masivo
    expect((await page(prod)).items.filter((d) => d.workItemId === id)).toHaveLength(2);
    expect((await page(prod, { hidden: "exclude" })).items.filter((d) => d.workItemId === id)).toHaveLength(2);
    // el trabajo no vuelve ni sale de Pendientes por ocultar
    expect((await item(id)).operational_status).toBe(before.item.operational_status);
    // otra entrega nueva del mismo trabajo se ve normalmente
    await deliver(masivo, id, 50);
    expect((await page(masivo)).items.filter((d) => d.workItemId === id)).toHaveLength(1);
    // restaurar
    for (const d of list) await (await ids()).setInternalDeliveryHidden(masivo as never, { kind: d.kind, id: d.id, hidden: false });
    expect((await page(masivo)).items.filter((d) => d.workItemId === id)).toHaveLength(3);
    expect((await page(masivo, { hidden: "only" })).items.filter((d) => d.workItemId === id)).toHaveLength(0);
    // persiste (otra «instancia»)
    vi.resetModules();
    expect((await page(masivo)).items.filter((d) => d.workItemId === id)).toHaveLength(3);
    expect((await q("select count(*)::int n from internal_delivery_hides where delivery_id = any($1)", [list.map((d) => d.id)]))[0]!.n).toBe(2);
  });

  it("5) permisos en el servidor: Masivo no oculta lo de Premium (ni al revés); Producción, Dirección, Codificado, Elaboración y Depósito no ocultan", async () => {
    const m = await newWork("ENVASADO_MASIVO", "300", "300");
    const p = await newWork("ENVASADO_PREMIUM", "300", "300");
    await deliver(masivo, m, 100);
    await deliver(premium, p, 100);
    const dm = (await page(masivo)).items.find((d) => d.workItemId === m)!;
    const dp = (await page(premium)).items.find((d) => d.workItemId === p)!;
    const svc = await ids();
    await expect(svc.setInternalDeliveryHidden(premium as never, { kind: dm.kind, id: dm.id, hidden: true })).rejects.toThrow(/propio sector/);
    await expect(svc.setInternalDeliveryHidden(masivo as never, { kind: dp.kind, id: dp.id, hidden: true })).rejects.toThrow(/propio sector/);
    for (const other of [prod, codif, elab, deposito, { ...prod, sector: "DIRECCION" as never }]) {
      await expect(svc.setInternalDeliveryHidden(other as never, { kind: dm.kind, id: dm.id, hidden: true })).rejects.toThrow();
    }
    await expect(svc.setInternalDeliveryHidden(masivo as never, { kind: "PRODUCCION", id: randomUUID(), hidden: true })).rejects.toThrow(/no encontrada/i);
    expect((await q("select count(*)::int n from internal_delivery_hides where delivery_id = any($1)", [[dm.id, dp.id]]))[0]!.n).toBe(0);
    // ocultar lo de Masivo no afecta el listado de Premium ni viceversa
    await svc.setInternalDeliveryHidden(masivo as never, { kind: dm.kind, id: dm.id, hidden: true });
    expect((await page(premium)).items.some((d) => d.id === dp.id)).toBe(true);
  });

  it("6) una entrega cancelada por el flujo autorizado se refleja como Cancelada (no se duplica ni se pierde) y sigue oculta si estaba oculta", async () => {
    const id = await newWork("ENVASADO_PREMIUM", "300", "300");
    await deliver(premium, id, 120);
    const d = (await page(premium)).items.find((x) => x.workItemId === id)!;
    await (await ids()).setInternalDeliveryHidden(premium as never, { kind: d.kind, id: d.id, hidden: true });
    await (await ids()).cancelInternalDelivery(premium as never, { kind: d.kind, id: d.id, reason: "error de carga" });
    const hidden = (await page(premium, { hidden: "only" })).items.find((x) => x.id === d.id)!;
    expect(hidden).toMatchObject({ status: "CANCELADA", hidden: true, quantity: 120 });
    expect((await page(premium)).items.some((x) => x.id === d.id)).toBe(false);
  });

  it("7) paginación, búsqueda por cliente/producto/lote y filtro Parcial/Total", async () => {
    const id = await newWork("ENVASADO_MASIVO", "100", "100");
    for (const n of [10, 20, 30, 40]) await deliver(masivo, id, n);
    const p1 = await page(masivo, { limit: 2, offset: 0, q: CLIENT });
    expect(p1.items).toHaveLength(2);
    expect(p1.hasMore).toBe(true);
    const all: string[] = [];
    for (let off = 0; ; off += 2) {
      const pg = await page(masivo, { limit: 2, offset: off, q: CLIENT });
      all.push(...pg.items.map((d) => d.id));
      if (!pg.hasMore) break;
    }
    expect(new Set(all).size).toBe(all.length); // sin repetidos entre páginas
    expect(all.length).toBeGreaterThanOrEqual(4);
    const sorted = (await page(masivo, { q: CLIENT })).items.map((d) => d.date);
    expect([...sorted].sort().reverse()).toEqual(sorted); // más recientes primero
    const mine = (await page(masivo, { q: CLIENT, tipo: "TOTAL" })).items.filter((d) => d.workItemId === id);
    expect(mine.map((d) => d.quantity)).toEqual([40]);
    expect((await page(masivo, { q: CLIENT, tipo: "PARCIAL" })).items.filter((d) => d.workItemId === id)).toHaveLength(3);
    expect((await page(masivo, { q: "L-IT-ID" })).items.length).toBeGreaterThan(0); // lote
    expect((await page(masivo, { q: "ZZZ-NO-EXISTE" })).items).toHaveLength(0);
  });
});
