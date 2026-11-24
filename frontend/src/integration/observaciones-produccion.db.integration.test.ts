/**
 * Observaciones transversales de Producción contra Postgres de PRUEBA real (migración 0089 + servicios reales de entrega).
 * Entregas parciales con distintas observaciones, entrega total, visibilidad inmediata, cadena Elaboración → Envasado → Codificado →
 * Producción, programaciones múltiples sin duplicados, historial tras finalizar, entrega anulada, permisos, indicador de nuevas y aviso
 * idempotente. Se corre con `GENUS_E2E_VITEST_FILES=src/integration/observaciones-produccion.db.integration.test.ts` (ver
 * scripts/e2e/run-observaciones-produccion-db-local.sh). Datos ficticios «IT OBS»; nunca se toca nada real.
 */
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { assertMarkedDatabase, e2eEnvironmentProblem } from "../../scripts/e2e/e2e-safety.mjs";

const PROBLEM = e2eEnvironmentProblem() ?? (process.env.GENUS_E2E_DATABASE_URL ? null : "falta GENUS_E2E_DATABASE_URL");
const RUN = Date.now().toString().slice(-6);
const CLIENT = `IT OBS CLIENTE ${RUN}`;
const mk = (k: string, sector: string, name: string) => ({ email: `it-obs-${k}@laboratoriogenus.com.ar`, sector, displayName: name });
const prod = mk("prod", "PRODUCCION", "IT Producción");
const dir = mk("dir", "DIRECCION", "IT Dirección");
const elab = mk("elab", "ELABORACION", "IT Elaboración");
const masivo = mk("masivo", "ENVASADO_MASIVO", "IT Envasado Masivo");
const premium = mk("premium", "ENVASADO_PREMIUM", "IT Envasado Premium");
const codif = mk("cod", "CODIFICADO", "IT Codificado");
const calidad = mk("cal", "CALIDAD", "IT Calidad");

describe.skipIf(Boolean(PROBLEM))(`Observaciones de Producción en Postgres real${PROBLEM ? ` — saltado: ${PROBLEM}` : ""}`, () => {
  let pool: import("@neondatabase/serverless").Pool;
  const q = async (text: string, params: unknown[] = []) => (await pool.query(text, params)).rows as Record<string, unknown>[];
  const svc = () => import("@/lib/observations/production-observations-service");

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
    await q("delete from production_observation_seen where user_key like 'it-obs-%'").catch(() => undefined);
    await pool?.end();
  });

  const newPedido = async (op: string) => String((await q("insert into production_pedidos (op, cliente, producto, q, estado) values ($1,$2,'Serum IT',1000,'INGRESO') returning id", [op, CLIENT]))[0]!.id);
  const newWork = async (sector: string, qty: string, extra: Record<string, unknown> = {}, unit = "un.") => {
    const { assignWorkItemDurable } = await import("@/lib/planning/work-assignment-service");
    const pre = sector === "ELABORACION" ? "OE" : "OA";
    const r = await assignWorkItemDurable(
      { sector, client: CLIENT, product: `Serum IT ${RUN}-${Math.random().toString(36).slice(2, 6)}`, plannedQuantity: qty, unit, plannedDate: "2031-06-10", ...(sector === "ELABORACION" ? { branchOwner: "Cristian" } : sector === "CODIFICADO" ? {} : { line: "Línea 1" }), orderNumber: `${pre}-2026-${String(600000 + Math.floor(Math.random() * 99999)).padStart(6, "0")}`, packagingLote: "L-IT-OBS", idempotencyKey: randomUUID(), ...extra } as never,
      prod as never,
      randomUUID()
    );
    return r.item.id as string;
  };
  const deliver = async (actor: typeof masivo, workItemId: string, over: Record<string, unknown>) => {
    const { deliverWorkDurable } = await import("@/lib/planning/work-item-progress-repository");
    return deliverWorkDurable({ workItemId, codigo: null, plannedDeliveryDate: null, actualDeliveredAt: new Date().toISOString(), remito: null, receivedBy: null, observations: null, ...over } as never, { email: actor.email, sector: actor.sector, displayName: actor.displayName });
  };
  const partial = (actor: typeof masivo, id: string, qty: number, realizadas: number, obs: string | null, key = randomUUID()) =>
    deliver(actor, id, { partial: true, deliverQuantity: qty, idempotencyKey: key, observations: obs, completion: { finishedQty: String(realizadas) } });
  const texts = (r: { items: Array<{ text: string }> }) => r.items.map((o) => o.text);

  it("la migración 0089 es aditiva e idempotente (se aplica dos veces sin error)", async () => {
    const sqlText = readFileSync("drizzle/0089_production_observation_seen.sql", "utf8");
    for (let i = 0; i < 2; i++) for (const stmt of sqlText.split("--> statement-breakpoint").map((x) => x.replace(/--[^\n]*\n/g, "").trim()).filter(Boolean)) await q(stmt);
    expect((await q("select table_name from information_schema.tables where table_name='production_observation_seen'")).length).toBe(1);
  });

  it("entregas parciales con distintas observaciones + entrega total: llegan de inmediato a Producción, ordenadas, sin pisarse, con todos los datos", async () => {
    const pedido = await newPedido(`OP-A-${RUN}`);
    const id = await newWork("ENVASADO_MASIVO", "1000", { productionPedidoId: pedido });
    const r1 = await partial(masivo, id, 400, 400, "Faltan tapas en el lote");
    await partial(masivo, id, 300, 700, "Etiquetas manchadas, se reimprimen");
    await partial(masivo, id, 100, 800, null); // sin observación: no genera nada
    const r4 = await partial(masivo, id, 200, 1000, "Entrega total sin novedades");
    expect(r4.complete).toBe(true);

    const feed = await (await svc()).getObservationFeed(prod as never, { q: CLIENT });
    expect(texts(feed)).toEqual(["Entrega total sin novedades", "Etiquetas manchadas, se reimprimen", "Faltan tapas en el lote"]); // recientes primero; la entrega sin texto no aparece
    const first = feed.items[2]!;
    expect(first).toMatchObject({ origin: "ENTREGA_PRODUCCION", sector: "ENVASADO_MASIVO", sectorLabel: "Envasado Masivo", deliveredBy: masivo.displayName, tipo: "PARCIAL", quantity: 400, client: CLIENT, pedidoId: pedido, pedidoOp: `OP-A-${RUN}`, workItemId: id, lote: "L-IT-OBS", deliveryId: r1.line!.id, anulada: false });
    expect(first.orderNumber).toMatch(/^OA-2026-/);
    expect(first.at).toBe(new Date(first.at).toISOString());
    expect(feed.items[0]).toMatchObject({ tipo: "TOTAL", quantity: 200 });

    // Historial del trabajo: cronológico, y sigue disponible DESPUÉS de finalizar (trabajo entregado).
    expect((await q("select operational_status from work_items where id = $1", [id]))[0]!.operational_status).toBe("entregado");
    const w = await (await svc()).getWorkObservations(masivo as never, id);
    expect(texts(w)).toEqual(["Faltan tapas en el lote", "Etiquetas manchadas, se reimprimen", "Entrega total sin novedades"]);
    expect(w.total).toBe(3);
    // Reprogramar / cambiar de día no pierde nada (vínculo por id).
    await q("update work_items set planned_date = '2031-09-01' where id = $1", [id]);
    expect((await (await svc()).getWorkObservations(prod as never, id)).total).toBe(3);
  });

  it("aviso a Producción: uno por observación, idempotente (reintento/replay no duplica), no avisa sin observación y no bloquea la entrega", async () => {
    const id = await newWork("ENVASADO_PREMIUM", "500");
    const key = randomUUID();
    const a = await partial(premium, id, 200, 200, `Caja golpeada ${RUN}`, key);
    const b = await partial(premium, id, 100, 300, null);
    const replay = await partial(premium, id, 200, 200, `Caja golpeada ${RUN}`, key); // misma clave: replay
    expect(replay.replayed).toBe(true);
    const rows = await q("select id, kind, message, sectors, href from os_notifications where kind = 'observacion_entrega' and message like $1", [`%Caja golpeada ${RUN}%`]);
    expect(rows).toHaveLength(1);
    expect(rows[0]!.sectors).toEqual(["PRODUCCION", "DIRECCION"]);
    expect(String(rows[0]!.message)).toContain(CLIENT);
    expect(String(rows[0]!.message)).toContain("Envasado Premium");
    expect(String(rows[0]!.message)).toContain("Entrega parcial");
    expect(String(rows[0]!.href)).toContain(encodeURIComponent(`native:${id}`));
    const { buildObservationNotification } = await import("@/lib/notifications/observation-notification-builder");
    expect(String(rows[0]!.id)).toBe(buildObservationNotification({ source: "LINEA", eventKey: a.line!.id, workItemId: id, sector: "ENVASADO_PREMIUM", actorName: "x", observation: "x", at: new Date() })!.id);
    expect(b.line!.observations).toBeNull();
    // Una falla del aviso nunca revierte ni bloquea: la entrega ya está registrada.
    expect(Number((await q("select count(*)::int n from work_item_delivery_lines where work_item_id = $1", [id]))[0]!.n)).toBe(2);
    // Reintento directo del mismo evento: no lanza y no duplica.
    const { emitObservationNotification } = await import("@/lib/notifications/observation-notifications");
    await expect(emitObservationNotification({ source: "LINEA", eventKey: a.line!.id, workItemId: id, sector: "ENVASADO_PREMIUM", actorName: "x", observation: "repetida", at: new Date() })).resolves.toMatchObject({ ok: true });
    expect(await q("select 1 from os_notifications where kind = 'observacion_entrega' and message like $1", [`%Caja golpeada ${RUN}%`])).toHaveLength(1);
  });

  it("cadena Elaboración → Envasado → Codificado → Producción: la observación de una etapa se ve en las demás, sin duplicar", async () => {
    const pedido = await newPedido(`OP-C-${RUN}`);
    const e = await newWork("ELABORACION", "60", { productionPedidoId: pedido }, "kg");
    const { sendElaboracionToEnvasadoDurable } = await import("@/lib/planning/circuit/elaboracion-handoff");
    const sent = await sendElaboracionToEnvasadoDurable({ workItemId: e, destination: "ENVASADO_MASIVO", producedQuantity: "60", unitsToPackage: "1000", observation: `Granel con leve espuma ${RUN}`, idempotencyKey: `obs-${RUN}-e2e` }, elab as never);
    const env = sent.destination.id as string;
    // Envasado entrega 600 a Codificado (con observación) y Codificado entrega a Producción (con observación).
    const t = await (await import("@/lib/planning/codificado-transfer-service")).transferToCodificadoDurable({ workItemId: env, quantity: 600, finishedQty: 1000, observation: `Tapas flojas, revisar ${RUN}`, idempotencyKey: randomUUID() }, masivo as never);
    const child = t.view.childId!;
    const { deliverFromCodificadoDurable } = await import("@/lib/planning/codificado-handoff-service");
    await deliverFromCodificadoDurable({ workItemId: child, observation: `Codificado: 3 cajas sin fecha ${RUN}`, deliverQuantity: 600, idempotencyKey: randomUUID() }, codif as never);

    const s = await svc();
    // Producción ve las tres en la cadena desde cualquiera de los trabajos.
    for (const from of [e, env, child]) {
      const w = await s.getWorkObservations(prod as never, from);
      expect(texts(w)).toEqual([`Granel con leve espuma ${RUN}`, `Tapas flojas, revisar ${RUN}`, `Codificado: 3 cajas sin fecha ${RUN}`]);
      expect(w.chain.map((c) => c.id).sort()).toEqual([e, env, child].sort());
    }
    // Codificado ve la de Envasado (y la de Elaboración) en SU trabajo; Envasado ve la de Codificado.
    const wc = await s.getWorkObservations(codif as never, child);
    expect(wc.items.map((o) => o.sector)).toEqual(["ELABORACION", "ENVASADO_MASIVO", "CODIFICADO"]);
    expect(wc.items.map((o) => o.origin)).toEqual(["ENVIO_ENVASADO", "ENTREGA_CODIFICADO", "ENTREGA_PRODUCCION"]);
    expect(wc.items[1]).toMatchObject({ tipo: "PARCIAL", quantity: 600, deliveryId: t.transfer.id, pedidoOp: `OP-C-${RUN}` });
    expect(texts(await s.getWorkObservations(masivo as never, env))).toContain(`Codificado: 3 cajas sin fecha ${RUN}`);
    // El listado general no duplica (cada texto una sola vez).
    const feed = await s.getObservationFeed(prod as never, { q: `OP-C-${RUN}` });
    expect(feed.items).toHaveLength(3);
    expect(new Set(feed.items.map((o) => o.id)).size).toBe(3);
    // Avisos: uno por observación (envío de Elaboración, entrega a Codificado y entrega de Codificado).
    const n = await q("select message from os_notifications where kind = 'observacion_entrega' and message like $1", [`%${RUN}%`]);
    expect(n.filter((r) => /espuma|Tapas flojas|sin fecha/.test(String(r.message)))).toHaveLength(3);
    // Resumen para las tarjetas (una consulta): las tres etapas ven 3.
    const sum = await s.getObservationSummary(prod as never, [e, env, child]);
    expect(sum[e]!.total).toBe(3);
    expect(sum[child]!.total).toBe(3);
  });

  it("programaciones múltiples del mismo trabajo: entregar una entrega todas; la observación sale UNA vez (las sincronizadas no tienen renglón)", async () => {
    const pedido = await newPedido(`OP-S-${RUN}`);
    const a = await newWork("ENVASADO_MASIVO", "800", { productionPedidoId: pedido });
    const b = await newWork("ENVASADO_MASIVO", "800", { productionPedidoId: pedido });
    await q("update work_items set schedule_root_id = $1, order_id = (select order_id from work_items where id = $1), order_number = (select order_number from work_items where id = $1) where id = $2", [a, b]);
    const r = await deliver(masivo, a, { idempotencyKey: randomUUID(), deliverQuantity: 800, observations: `Todo el lote conforme ${RUN}`, completion: { finishedQty: "800" } });
    expect(r.complete).toBe(true);
    expect((await q("select operational_status from work_items where id = $1", [b]))[0]!.operational_status).toBe("entregado"); // sincronizada
    expect(Number((await q("select count(*)::int n from work_item_delivery_lines where work_item_id = $1", [b]))[0]!.n)).toBe(0);
    const s = await svc();
    for (const id of [a, b]) {
      const w = await s.getWorkObservations(prod as never, id);
      expect(texts(w)).toEqual([`Todo el lote conforme ${RUN}`]);
      expect(w.chain.map((c) => c.id).sort()).toEqual([a, b].sort());
    }
    const feed = await s.getObservationFeed(prod as never, { q: `OP-S-${RUN}` });
    expect(feed.items).toHaveLength(1);
    // La entrega agregada sincronizada (con marca) NO aparece como observación propia.
    expect((await s.getObservationFeed(prod as never, { q: "sincronizada" })).items.filter((o) => o.workItemId === b)).toHaveLength(0);
  });

  it("registro histórico sin renglones: aparece vinculado por id del trabajo; sin vínculo inequívoco no se inventa", async () => {
    const id = await newWork("ENVASADO_MASIVO", "100");
    await q("insert into work_item_deliveries (work_item_id, product, source_sector, quantity, actual_delivered_at, observations, status, delivered_by, delivered_by_sector, delivery_complete) values ($1,'P','ENVASADO_MASIVO','100', now() - interval '3 days', $2, 'ENTREGADO', 'Beto histórico', 'ENVASADO_MASIVO', true)", [id, `Observación histórica ${RUN}`]);
    const w = await (await svc()).getWorkObservations(prod as never, id);
    expect(w.items).toHaveLength(1);
    expect(w.items[0]).toMatchObject({ origin: "ENTREGA_HISTORICA", text: `Observación histórica ${RUN}`, tipo: "TOTAL", deliveredBy: "Beto histórico", workItemId: id });
  });

  it("entrega anulada: la observación se conserva marcada como anulada y deja de contar", async () => {
    const id = await newWork("ENVASADO_MASIVO", "300");
    const r = await partial(masivo, id, 100, 300, `Observación a anular ${RUN}`);
    const s = await svc();
    expect((await s.getWorkObservations(prod as never, id)).total).toBe(1);
    const { cancelInternalDelivery } = await import("@/lib/planning/internal-deliveries-service");
    await cancelInternalDelivery(prod as never, { kind: "PRODUCCION", id: r.line!.id, reason: "Cargada por error" } as never);
    const w = await s.getWorkObservations(prod as never, id);
    expect(w.items).toHaveLength(1);
    expect(w.items[0]).toMatchObject({ anulada: true, text: `Observación a anular ${RUN}` });
    expect(w).toMatchObject({ total: 0, anuladas: 1 });
  });

  it("permisos: Producción y Dirección ven todo; cada sector productivo solo su cadena; el resto, nada", async () => {
    const pedido = await newPedido(`OP-P-${RUN}`);
    const mine = await newWork("ENVASADO_MASIVO", "100", { productionPedidoId: pedido });
    const other = await newWork("ENVASADO_PREMIUM", "100");
    await partial(masivo, mine, 100, 100, `Obs masivo ${RUN}`);
    await partial(premium, other, 100, 100, `Obs premium ${RUN}`);
    const s = await svc();
    const prodFeed = await s.getObservationFeed(prod as never, { q: RUN });
    expect(texts(prodFeed)).toEqual(expect.arrayContaining([`Obs masivo ${RUN}`, `Obs premium ${RUN}`]));
    expect(texts(await s.getObservationFeed(dir as never, { q: RUN }))).toEqual(expect.arrayContaining([`Obs masivo ${RUN}`, `Obs premium ${RUN}`]));
    const mFeed = await s.getObservationFeed(masivo as never, { q: RUN });
    expect(texts(mFeed)).toContain(`Obs masivo ${RUN}`);
    expect(texts(mFeed)).not.toContain(`Obs premium ${RUN}`);
    await expect(s.getWorkObservations(masivo as never, other)).rejects.toThrow(/no pertenece a tu sector/);
    await expect(s.getWorkObservations(codif as never, mine)).rejects.toThrow(/no pertenece a tu sector/);
    await expect(s.getObservationFeed(calidad as never)).rejects.toThrow(/No tenés permiso/);
    await expect(s.getWorkObservations(calidad as never, mine)).rejects.toThrow(/No tenés permiso/);
    expect(await s.getObservationSummary(masivo as never, [mine, other])).toEqual({ [mine]: expect.objectContaining({ total: 1 }) });
    await expect(s.markObservationsSeen(masivo as never, other)).rejects.toThrow(/no pertenece/);
    // Formato inválido
    await expect(s.getWorkObservations(prod as never, "no-es-uuid")).rejects.toThrow(/inválido/);
  });

  it("indicador de nuevas por usuario: marcar visto lo limpia solo para ese usuario y vuelve con una observación posterior", async () => {
    const id = await newWork("ENVASADO_MASIVO", "300");
    await partial(masivo, id, 100, 300, `Nueva 1 ${RUN}`);
    const s = await svc();
    expect(await s.getObservationSummary(prod as never, [id])).toEqual({ [id]: { total: 1, news: 1 } });
    expect((await s.getWorkObservations(prod as never, id)).items[0]!.isNew).toBe(true);
    const seen = await s.markObservationsSeen(prod as never, id);
    expect(seen.scope).toBe(`WORK:${id}`);
    expect(await s.getObservationSummary(prod as never, [id])).toEqual({ [id]: { total: 1, news: 0 } });
    expect(await s.getObservationSummary(dir as never, [id])).toEqual({ [id]: { total: 1, news: 1 } }); // otro usuario: sigue nueva
    await new Promise((r) => setTimeout(r, 30));
    await partial(masivo, id, 100, 300, `Nueva 2 ${RUN}`);
    expect(await s.getObservationSummary(prod as never, [id])).toEqual({ [id]: { total: 2, news: 1 } });
    // Listado: «solo nuevas» y «marcar todas como vistas».
    const feed = await s.getObservationFeed(prod as never, { q: RUN, onlyNew: true });
    expect(feed.items.every((o) => o.isNew)).toBe(true);
    expect(feed.news).toBeGreaterThan(0);
    await s.markObservationsSeen(prod as never, "FEED");
    const after = await s.getObservationFeed(prod as never, { q: RUN, onlyNew: true });
    expect(after.items).toHaveLength(0);
    expect(after.news).toBe(0);
    expect((await s.getObservationFeed(dir as never, { q: RUN, onlyNew: true })).items.length).toBeGreaterThan(0);
    await expect(s.markObservationsSeen(prod as never, "cualquier cosa")).rejects.toThrow(/inválido/);
  });

  it("filtros del listado: por sector y por cliente/pedido", async () => {
    const s = await svc();
    const onlyCod = await s.getObservationFeed(prod as never, { sector: "CODIFICADO", q: RUN });
    expect(onlyCod.items.every((o) => o.sector === "CODIFICADO")).toBe(true);
    expect(onlyCod.items.length).toBeGreaterThan(0);
    expect((await s.getObservationFeed(prod as never, { q: `OP-A-${RUN}` })).items).toHaveLength(3);
    expect((await s.getObservationFeed(prod as never, { q: `no-existe-${RUN}` })).items).toHaveLength(0);
  });
});
