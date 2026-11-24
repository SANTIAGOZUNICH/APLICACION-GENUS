/**
 * CAJAS GENUS contra Postgres de PRUEBA real: libro de movimientos, ingresos de Depósito, descuento automático por la entrega final al cliente,
 * clientes con cajas propias, edición/anulación/ocultamiento de entregas, pendientes de revisión, stock inicial, alerta de stock crítico (≤300),
 * idempotencia y concurrencia. Se corre con
 * `GENUS_E2E_VITEST_FILES=src/integration/cajas-genus.db.integration.test.ts npm run test:e2e:semanas-priorities-db`.
 */
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { assertMarkedDatabase, e2eEnvironmentProblem } from "../../scripts/e2e/e2e-safety.mjs";

const PROBLEM = e2eEnvironmentProblem() ?? (process.env.GENUS_E2E_DATABASE_URL ? null : "falta GENUS_E2E_DATABASE_URL");
const RUN = Date.now().toString().slice(-6);
const prod = { email: "it-cj-prod@laboratoriogenus.com.ar", sector: "PRODUCCION" as const, displayName: "IT CJ Producción" };
const masivo = { email: "it-cj-masivo@laboratoriogenus.com.ar", sector: "ENVASADO_MASIVO" as const, displayName: "IT CJ Masivo" };
const dep = { email: "it-cj-dep@laboratoriogenus.com.ar", sector: "DEPOSITO" as const, displayName: "IT CJ Depósito" };
const adm = { email: "it-cj-adm@laboratoriogenus.com.ar", sector: "ADMINISTRACION" as const, displayName: "IT CJ Administración" };
const elab = { email: "it-cj-elab@laboratoriogenus.com.ar", sector: "ELABORACION" as const, displayName: "IT CJ Elaboración" };
type Boxes = Array<{ cajas: number; unidadesPorCaja: number }>;
const B = (cajas: number, u = 100): Boxes => [{ cajas, unidadesPorCaja: u }];

describe.skipIf(Boolean(PROBLEM))(`Cajas Genus en Postgres real${PROBLEM ? ` — saltado: ${PROBLEM}` : ""}`, () => {
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

  const svc = () => import("@/lib/cajas-genus/service");
  const stock = async () => (await (await svc()).getSummary(adm as never)).stock;
  const setBase = async (n: number) => (await svc()).setInitialStock(adm as never, { quantity: n, key: randomUUID() });
  const adjust = async (d: number) => (await svc()).manualAdjust(adm as never, { delta: d, reason: "prueba", key: randomUUID() });

  const newWork = async (sector: string, qty: string, client: string, unit = "un.") => {
    const { assignWorkItemDurable } = await import("@/lib/planning/work-assignment-service");
    const r = await assignWorkItemDurable(
      { sector, client, product: `CAJAS ${RUN}-${Math.random().toString(36).slice(2, 6)}`, plannedQuantity: qty, unit, plannedDate: "2031-06-10", ...(sector === "ELABORACION" ? { branchOwner: "Cristian" } : { line: "Línea 1" }), orderNumber: `${sector === "ELABORACION" ? "OE" : "OA"}-2026-${String(400000 + Math.floor(Math.random() * 99999)).padStart(6, "0")}`, packagingLote: "IT-CJ", idempotencyKey: randomUUID() } as never,
      prod as never,
      randomUUID()
    );
    return r.item.id as string;
  };
  const deliver = async (actor: { email: string; sector: string; displayName: string }, workItemId: string, over: Record<string, unknown>) => {
    const { deliverWorkDurable } = await import("@/lib/planning/work-item-progress-repository");
    return deliverWorkDurable({ workItemId, codigo: null, sourceSector: actor.sector, plannedDeliveryDate: null, actualDeliveredAt: new Date().toISOString(), remito: null, receivedBy: null, observations: null, idempotencyKey: randomUUID(), ...over } as never, actor as never);
  };
  /** Entrega parcial de `units` unidades con `boxes` (o sin detalle de cajas si null). */
  const partial = (id: string, units: number, total: number, boxes: Boxes | null, extra: Record<string, unknown> = {}) =>
    deliver(masivo, id, { partial: true, deliverQuantity: units, deliveryPackingGroups: boxes, completion: { finishedQty: String(total) }, ...extra });
  const lineIds = async (id: string) => (await q("select id::text id from work_item_delivery_lines where work_item_id = $1 order by sequence", [id])).map((r) => String(r.id));
  const movesOf = (lineId: string) => q("select kind, delta from cajas_genus_movements where delivery_line_id = $1 and status = 'ACTIVO' order by seq", [lineId]);
  const net = async (lineId: string) => (await movesOf(lineId)).reduce((a, m) => a + Number(m.delta), 0);
  const notifCount = () => q("select count(*)::int n from os_notifications where kind = 'cajas_genus_critico'").then((r) => Number(r[0]!.n));

  it("stock inicial + ingreso de 10 bultos × 50 cajas = +500, con total calculado en el servidor y sin duplicar al reintentar", { timeout: 60_000 }, async () => {
    const s = await svc();
    await setBase(1000);
    const key = randomUUID();
    const a = await s.registerIngresos(dep as never, [{ fecha: "2026-11-24", bultos: 10, cantidad: 50, key }]);
    expect(a.results[0]).toMatchObject({ total: 500, replayed: false });
    expect(a.stock.stock).toBe(1500);
    const b = await s.registerIngresos(dep as never, [{ fecha: "2026-11-24", bultos: 10, cantidad: 50, key }]); // reintento
    expect(b.results[0]).toMatchObject({ replayed: true });
    expect(await stock()).toBe(1500);
    await expect(s.registerIngresos(dep as never, [{ bultos: 0, cantidad: 50, key: randomUUID() }])).rejects.toThrow(/BULTOS/);
    await expect(s.registerIngresos(dep as never, [{ bultos: 2.5, cantidad: 50, key: randomUUID() }])).rejects.toThrow(/BULTOS/);
    await expect(s.registerIngresos(dep as never, [{ bultos: 2, cantidad: -1, key: randomUUID() }])).rejects.toThrow(/CANTIDAD/);
    // El total que mande el cliente no se usa: solo bultos × cantidad.
    const c = await s.registerIngresos(dep as never, [{ bultos: 3, cantidad: 10, key: randomUUID(), total: 99999 } as never]);
    expect(c.results[0]!.total).toBe(30);
    await adjust(-30); // vuelve a 1500 para los casos siguientes
    expect(await stock()).toBe(1500);
  });

  it("permisos en backend: Depósito registra ingresos; Administración/Dirección ajustan; los demás sectores no ven ni tocan nada", { timeout: 60_000 }, async () => {
    const s = await svc();
    await expect(s.registerIngresos(adm as never, [{ bultos: 1, cantidad: 1, key: randomUUID() }])).rejects.toThrow(/Depósito/);
    await expect(s.registerIngresos(masivo as never, [{ bultos: 1, cantidad: 1, key: randomUUID() }])).rejects.toThrow(/Depósito/);
    await expect(s.manualAdjust(dep as never, { delta: 5, reason: "x", key: randomUUID() })).rejects.toThrow(/Administración/);
    await expect(s.setInitialStock(dep as never, { quantity: 5, key: randomUUID() })).rejects.toThrow(/Administración/);
    await expect(s.getSummary(elab as never)).rejects.toThrow(/permiso/);
    await expect(s.listMovements(prod as never)).rejects.toThrow(/permiso/);
    await expect(s.report(dep as never)).rejects.toThrow(/Administración/);
    // Depósito ve solo sus ingresos
    const mine = await s.listMovements(dep as never, {});
    expect(mine.items.every((m) => m.kind === "INGRESO")).toBe(true);
  });

  it("entrega a cliente normal: −5 cajas; el replay de la misma entrega no vuelve a descontar", { timeout: 60_000 }, async () => {
    const before = (await stock())!;
    const id = await newWork("ENVASADO_MASIVO", "500", `Cliente Normal ${RUN}`);
    const key = randomUUID();
    await partial(id, 500, 500, B(5), { idempotencyKey: key });
    expect(await stock()).toBe(before - 5);
    await partial(id, 500, 500, B(5), { idempotencyKey: key }).catch(() => undefined); // replay
    expect(await stock()).toBe(before - 5);
    const [lid] = await lineIds(id);
    expect(await net(lid!)).toBe(-5);
  });

  it("los seis clientes con cajas propias NO descuentan (uno por uno) y una variante de escritura tampoco; un cliente parecido pero distinto SÍ", { timeout: 120_000 }, async () => {
    const before = (await stock())!;
    for (const name of ["BIOESENCIA", "ORIGINAL BLACK", "TRC", "JACTANS", "BL COSMETICS", "BAHIA EVANS", "Bahía Evans S.A.", "B.L. Cosmetics"]) {
      const id = await newWork("ENVASADO_MASIVO", "1000", name);
      await partial(id, 1000, 1000, B(10));
      const [lid] = await lineIds(id);
      expect(await net(lid!), name).toBe(0);
      expect((await movesOf(lid!)).length, `${name}: queda el renglón en 0 en el historial`).toBe(1);
    }
    expect(await stock()).toBe(before);
    const id = await newWork("ENVASADO_MASIVO", "300", "TRC Cosmetics Otro");
    await partial(id, 300, 300, B(3));
    expect(await stock()).toBe(before - 3);
  });

  it("entregas parciales múltiples con distintas cantidades por caja: suma las CAJAS de todos los grupos (5 + 5 = 10)", { timeout: 60_000 }, async () => {
    const before = (await stock())!;
    const id = await newWork("ENVASADO_MASIVO", "950", `Cliente Parciales ${RUN}`);
    await partial(id, 500, 950, B(5, 100));
    await partial(id, 450, 950, [{ cajas: 4, unidadesPorCaja: 100 }, { cajas: 1, unidadesPorCaja: 50 }]);
    expect(await stock()).toBe(before - 10);
    const ids = await lineIds(id);
    expect([await net(ids[0]!), await net(ids[1]!)]).toEqual([-5, -5]);
  });

  it("editar una entrega ajusta SOLO la diferencia (10 → 12 = −2); anular la revierte; ocultar del historial NO toca el stock", { timeout: 90_000 }, async () => {
    const before = (await stock())!;
    const id = await newWork("ENVASADO_MASIVO", "1200", `Cliente Edición ${RUN}`);
    await partial(id, 1000, 1200, B(10));
    const [lid] = await lineIds(id);
    expect(await stock()).toBe(before - 10);
    const isvc = await import("@/lib/planning/internal-deliveries-service");
    await isvc.editInternalDelivery(prod as never, { kind: "PRODUCCION", id: lid!, quantity: 1200, packingGroups: B(12) } as never);
    expect(await stock()).toBe(before - 12);
    const mv = await movesOf(lid!);
    expect(mv.map((m) => Number(m.delta))).toEqual([-10, -2]);
    await isvc.setInternalDeliveryHidden(masivo as never, { kind: "PRODUCCION", id: lid!, hidden: true } as never);
    expect(await stock()).toBe(before - 12); // ocultar = visual
    await isvc.setInternalDeliveryHidden(masivo as never, { kind: "PRODUCCION", id: lid!, hidden: false } as never);
    await isvc.cancelInternalDelivery(prod as never, { kind: "PRODUCCION", id: lid!, reason: "se contó mal" } as never);
    expect(await stock()).toBe(before);
    expect(await net(lid!)).toBe(0);
    const again = await (await svc()).reconcileCajas(adm as never, { onlyMissing: false });
    expect(again.moved).toBe(0); // la barrida no cambia nada: ya está consistente
    expect(await stock()).toBe(before);
  });

  it("anular la entrega completa del trabajo (anulación durable) también revierte las cajas", { timeout: 90_000 }, async () => {
    const before = (await stock())!;
    const id = await newWork("ENVASADO_MASIVO", "600", `Cliente Anula ${RUN}`);
    await partial(id, 600, 600, B(6));
    expect(await stock()).toBe(before - 6);
    const [d] = await q("select id::text id from work_item_deliveries where work_item_id = $1 and status = 'ENTREGADO'", [id]);
    const { annulDeliveryDurable } = await import("@/lib/planning/work-item-progress-repository");
    await annulDeliveryDurable(String(d!.id), "anulada por error", "Producción");
    expect(await stock()).toBe(before);
  });

  it("entregas internas / Elaboración NO descuentan cajas (sector no final); Envasado sí", { timeout: 60_000 }, async () => {
    const before = (await stock())!;
    const id = await newWork("ELABORACION", "200", `Cliente Granel ${RUN}`, "kg");
    await deliver(elab, id, { partial: true, deliverQuantity: 200, completion: { finishedQty: "200" } }).catch(() => undefined);
    expect(await stock()).toBe(before);
    const lines = await lineIds(id);
    for (const l of lines) expect(await movesOf(l)).toHaveLength(0);
  });

  it("entrega SIN detalle de cajas o SIN cliente: pendiente de revisión, no inventa ni descuenta; al completar las cajas se resuelve solo", { timeout: 90_000 }, async () => {
    const s = await svc();
    const before = (await stock())!;
    const id = await newWork("ENVASADO_MASIVO", "400", `Cliente Sin Detalle ${RUN}`);
    await partial(id, 400, 400, null);
    const [lid] = await lineIds(id);
    expect(await stock()).toBe(before);
    expect((await s.listPending(adm as never)).some((p) => p.deliveryLineId === lid && p.reason === "SIN_DETALLE")).toBe(true);
    expect((await s.getSummary(adm as never)).pendingReviews).toBeGreaterThan(0);
    const isvc = await import("@/lib/planning/internal-deliveries-service");
    await isvc.editInternalDelivery(prod as never, { kind: "PRODUCCION", id: lid!, quantity: 400, packingGroups: B(4) } as never);
    expect(await stock()).toBe(before - 4);
    expect((await s.listPending(adm as never)).some((p) => p.deliveryLineId === lid)).toBe(false);
    // Sin cliente identificado
    const id2 = await newWork("ENVASADO_MASIVO", "200", "sin cliente");
    await partial(id2, 200, 200, B(2));
    const [l2] = await lineIds(id2);
    expect(await stock()).toBe(before - 4);
    expect((await s.listPending(adm as never)).some((p) => p.deliveryLineId === l2 && p.reason === "SIN_CLIENTE")).toBe(true);
  });

  it("cambiar «utiliza cajas propias» no reescribe el historial: solo las entregas futuras; «reclasificar» genera movimientos de diferencia auditados", { timeout: 90_000 }, async () => {
    const s = await svc();
    const name = `Cliente Cambiante ${RUN}`;
    const id = await newWork("ENVASADO_MASIVO", "500", name);
    const before = (await stock())!;
    await partial(id, 500, 500, B(5));
    expect(await stock()).toBe(before - 5);
    await s.setClientOwnBoxes(adm as never, { name, usesOwnBoxes: true });
    expect(await stock()).toBe(before - 5); // el historial no cambió en silencio
    const id2 = await newWork("ENVASADO_MASIVO", "300", name);
    await partial(id2, 300, 300, B(3));
    expect(await stock()).toBe(before - 5); // la futura ya no descuenta
    const out = await s.reclassifyClient(adm as never, name);
    expect(out.moved).toBeGreaterThanOrEqual(1);
    expect(await stock()).toBe(before); // reversión auditada de las 5
    const audit = await s.listAudit(adm as never);
    expect(audit.some((a) => a.action === "CLIENTE_RECLASIFICADO")).toBe(true);
    expect(audit.some((a) => a.action === "CLIENTE_CAJAS_PROPIAS")).toBe(true);
    const cli = await s.listClientSettings(adm as never);
    expect(cli.items.filter((c) => c.source === "INICIAL").map((c) => c.clientKey).sort()).toEqual(["bahiaevans", "bioesencia", "blcosmetics", "jactans", "originalblack", "trc"]);
  });

  it("alerta de stock crítico: 301 normal; 300, 299, 0 y negativo críticos; UNA notificación por episodio; reposición la desactiva; vuelve a activarse con otra notificación", { timeout: 120_000 }, async () => {
    const s = await svc();
    const n0 = await notifCount();
    await setBase(301);
    let sum = await s.getSummary(adm as never);
    expect(sum).toMatchObject({ stock: 301, alertState: "NORMAL", critical: false });
    expect(await notifCount()).toBe(n0);
    await adjust(-1); // 300
    sum = await s.getSummary(adm as never);
    expect(sum).toMatchObject({ stock: 300, alertState: "CRITICO", critical: true });
    expect(await notifCount()).toBe(n0 + 1);
    const [nt] = await q("select title, message, sectors, href from os_notifications where kind = 'cajas_genus_critico' order by created_at desc limit 1");
    expect(String(nt!.message)).toBe("STOCK CRÍTICO DE CAJAS GENUS. Quedan solamente 300 cajas disponibles. Es necesario realizar una reposición");
    expect(nt!.sectors).toEqual(["ADMINISTRACION"]);
    expect(nt!.href).toBe("/cajas-genus");
    await adjust(-1); // 299: sigue crítico, sin notificación nueva
    await adjust(-299); // 0
    expect(await s.getSummary(adm as never)).toMatchObject({ stock: 0, critical: true });
    await adjust(-5); // negativo
    expect(await s.getSummary(adm as never)).toMatchObject({ stock: -5, critical: true, negative: true });
    expect(await notifCount()).toBe(n0 + 1);
    await s.registerIngresos(dep as never, [{ bultos: 10, cantidad: 50, key: randomUUID() }]); // +500 → 495
    expect(await s.getSummary(adm as never)).toMatchObject({ stock: 495, critical: false, alertState: "NORMAL" });
    await adjust(-195); // 300 de nuevo → episodio nuevo
    expect(await s.getSummary(adm as never)).toMatchObject({ stock: 300, critical: true });
    expect(await notifCount()).toBe(n0 + 2);
  });

  it("concurrencia: la misma entrega sincronizada en paralelo mueve el stock UNA vez; ingresos concurrentes con la misma clave no se duplican; ingresos distintos suman bien", { timeout: 120_000 }, async () => {
    const s = await svc();
    await setBase(5000);
    const id = await newWork("ENVASADO_MASIVO", "800", `Cliente Concurrente ${RUN}`);
    await partial(id, 800, 800, B(8));
    const [lid] = await lineIds(id);
    const { getDb } = await import("@/lib/db/client");
    await Promise.all(Array.from({ length: 6 }, () => getDb().transaction(async (tx) => s.syncDeliveryLine(tx, lid!))));
    expect(await net(lid!)).toBe(-8);
    expect(await stock()).toBe(4992);
    const key = randomUUID();
    await Promise.all(Array.from({ length: 5 }, () => s.registerIngresos(dep as never, [{ bultos: 2, cantidad: 10, key }])));
    expect(await stock()).toBe(5012);
    await Promise.all(Array.from({ length: 5 }, () => s.registerIngresos(dep as never, [{ bultos: 1, cantidad: 10, key: randomUUID() }])));
    expect(await stock()).toBe(5062);
    // entregas simultáneas de trabajos distintos
    const ids = await Promise.all(Array.from({ length: 4 }, () => newWork("ENVASADO_MASIVO", "100", `Cliente Par ${RUN}`)));
    await Promise.all(ids.map((w) => partial(w, 100, 100, B(1))));
    expect(await stock()).toBe(5058);
  });

  it("anular un ingreso (auditado) baja el stock; los egresos por entrega no se anulan a mano; persistencia y reportes", { timeout: 90_000 }, async () => {
    const s = await svc();
    await setBase(2000);
    const r = await s.registerIngresos(dep as never, [{ fecha: "2026-11-23", bultos: 4, cantidad: 25, key: randomUUID() }]);
    expect(await stock()).toBe(2100);
    await expect(s.voidMovement(adm as never, r.results[0]!.id, "")).rejects.toThrow(/motivo/);
    await s.voidMovement(adm as never, r.results[0]!.id, "ingreso cargado por error");
    expect(await stock()).toBe(2000);
    await expect(s.voidMovement(adm as never, r.results[0]!.id, "otra vez")).rejects.toThrow(/anulado/);
    const id = await newWork("ENVASADO_MASIVO", "200", `Cliente Reporte ${RUN}`);
    await partial(id, 200, 200, B(2));
    const [lid] = await lineIds(id);
    const eg = (await q("select id::text id from cajas_genus_movements where delivery_line_id = $1 limit 1", [lid]))[0]!;
    await expect(s.voidMovement(adm as never, String(eg.id), "x")).rejects.toThrow(/entrega/);
    // persistencia: otro "proceso" ve lo mismo
    vi.resetModules();
    const s2 = await import("@/lib/cajas-genus/service");
    expect((await s2.getSummary(adm as never)).stock).toBe(1998);
    const rep = await s2.report(adm as never, { period: "mes" });
    expect(rep.porCliente.find((c) => c.cliente === `Cliente Reporte ${RUN}`)).toMatchObject({ cajas: 2, entregas: 1 });
    const mv = await s2.listMovements(adm as never, { includeVoided: true });
    expect(mv.items.some((m) => m.status === "ANULADO" && m.kind === "INGRESO" && m.voidReason === "ingreso cargado por error")).toBe(true);
    const filtered = await s2.listMovements(adm as never, { kind: "INGRESO", from: "2026-11-23", to: "2026-11-23" });
    expect(filtered.items.every((m) => m.kind === "INGRESO" && m.fecha === "2026-11-23")).toBe(true);
    const audit = await s2.listAudit(adm as never);
    expect(audit.some((a) => a.action === "MOVIMIENTO_ANULADO" && a.reason === "ingreso cargado por error")).toBe(true);
  });
});
