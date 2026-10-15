// E2E (Chromium real + API autenticada, base DESCARTABLE): circuito operativo SIN Calidad.
//  1. Elaboración → Envasado Masivo y Premium (crea o enlaza, idempotente, notifica a Producción).
//  2. Envasado → Codificado SIN cajas (backend) y Envasado → Entrega final CON validación de cajas.
//  3. Codificado → Entrega final; unidades no se duplican; pedido ENTREGADO solo al completar todos los trabajos.
//  4. Entregas parciales: saldo, parcial posterior, no marcar entregado hasta completar, sin duplicados por reintento.
//  5. Permisos por sector (Envasado lo suyo, Producción/Dirección todo, Elaboración y Calidad nunca).
//  6. Calidad fuera del circuito: quality_decision/quality_annul → 410; menú sin Calidad; historial conservado.
//  7. Pendientes en Calidad reubicados (evento auditable idempotente) sin marcarlos entregados.
//  8. Notificaciones a Producción: contenido, idempotencia, leídas/todas, no bloquean.
//  9. Capturas en escritorio 1440, tablet 820 y celular 390 sin scroll horizontal.
import { mkdirSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { createRequire } from "node:module";
import { chromium } from "playwright";
import { assertE2eEnvironment, assertMarkedDatabase } from "./e2e-safety.mjs";
import { E2E_PASSWORD, E2E_USERS } from "./e2e-fixtures.mjs";

const require = createRequire(import.meta.url);
const { Pool, neonConfig } = require("@neondatabase/serverless");
neonConfig.webSocketConstructor = require("ws");

assertE2eEnvironment();
const BASE = process.env.GENUS_E2E_BASE_URL ?? "http://localhost:3280";
const OUT = process.env.OUT ?? "/tmp/circuito-e2e";
mkdirSync(OUT, { recursive: true });
const results = [];
const check = (name, ok, extra = "") => {
  results.push({ name, ok: Boolean(ok) });
  console.log(`${ok ? "OK  " : "FAIL"} ${name}${extra ? " — " + extra : ""}`);
};
const pool = new Pool({ connectionString: process.env.GENUS_E2E_DATABASE_URL });
const q = async (text, params = []) => (await pool.query(text, params)).rows;
await assertMarkedDatabase(q);
const browser = await chromium.launch({ executablePath: process.env.GENUS_E2E_CHROMIUM_PATH || undefined });

const TAG = "E2E Circuito";
const DAY = "2026-05-06";
const CLIENT = `${TAG} Cliente`;

async function openAs(user, viewport = { width: 1440, height: 900 }) {
  const ctx = await browser.newContext({ baseURL: BASE, viewport });
  const page = await ctx.newPage();
  await page.goto("/login");
  await page.locator('input[type="email"]').fill(user.email);
  await page.locator('input[type="password"]').fill(E2E_PASSWORD);
  await page.locator('button[type="submit"]').click();
  await page.waitForURL((u) => !u.pathname.startsWith("/login"), { timeout: 60_000 });
  return { ctx, page, user };
}
const json = async (res) => res.json().catch(() => ({}));
const post = (u, url, data) => u.page.request.post(url, { data });
const live = (u, data) => post(u, "/api/v1/live-sync/operations", data);

async function cleanup() {
  const ids = (await q("select id from work_items where client like $1", [`${TAG}%`])).map((r) => r.id);
  if (ids.length) {
    await q("delete from work_item_delivery_lines where work_item_id = any($1)", [ids]);
    await q("delete from work_item_deliveries where work_item_id = any($1)", [ids]);
    await q("delete from operational_events where work_item_id = any($1)", [ids]);
    await q("delete from production_pedido_status_events where work_item_id = any($1)", [ids]);
    await q("delete from work_items where id = any($1)", [ids]);
  }
  await q("delete from production_pedidos where cliente like $1", [`${TAG}%`]);
  await q("delete from os_notifications where kind = 'circuito_movimiento'");
}

async function assign(u, data) {
  const res = await post(u, "/api/v1/work-assignments", {
    unit: "un.",
    plannedDate: DAY,
    plannedDateTo: DAY,
    idempotencyKey: randomUUID(),
    ...data,
  });
  const body = await json(res);
  return { res, item: body.item ?? body.workItem ?? null, body };
}
async function newPedido(op, producto) {
  const [row] = await q("insert into production_pedidos (op, cliente, producto, estado, q) values ($1,$2,$3,'EN_ELABORACION', 1000) returning id", [op, CLIENT, producto]);
  return row.id;
}
const wi = async (id) => (await q("select * from work_items where id = $1", [id]))[0];
const lines = async (id) => q("select * from work_item_delivery_lines where work_item_id = $1 order by sequence", [id]);
const notifs = async () => q("select * from os_notifications where kind = 'circuito_movimiento' order by created_at");

try {
  await cleanup();
  const produccion = await openAs(E2E_USERS.produccion);
  const direccion = await openAs(E2E_USERS.direccion);
  const elab = await openAs(E2E_USERS.elaboracion);
  const masivo = await openAs(E2E_USERS.envasado);
  const premium = await openAs(E2E_USERS.envasadoPremium);
  const cod = await openAs(E2E_USERS.codificado);
  const calidad = await openAs(E2E_USERS.calidad);

  // ===== 1. Elaboración → Envasado Masivo / Premium =====
  const pedido1 = await newPedido("OP-E2E-9001", "Shampoo Uno");
  const e1 = await assign(produccion, { sector: "ELABORACION", branchOwner: "Cristian", client: CLIENT, product: "Shampoo Uno", plannedQuantity: "500", unit: "kg", productionPedidoId: pedido1 });
  check("Producción asigna Elaboración", e1.res.ok() && e1.item, String(e1.res.status()));
  const noDest = await post(elab, `/api/v1/work-items/${e1.item.id}/envasado`, { idempotencyKey: randomUUID(), producedQuantity: "500" });
  check("Sin destino deducible se pide elegir Masivo/Premium (400)", noDest.status() === 400 && /Masivo o Premium/i.test((await json(noDest)).error ?? ""));
  const sug = await json(await elab.page.request.get(`/api/v1/work-items/${e1.item.id}/envasado`));
  check("Sugerencia de destino sin datos previos: no determinable", sug.sector === null && sug.reason === "NO_DETERMINABLE");
  const k1 = `e2e-${randomUUID()}`;
  const s1 = await post(elab, `/api/v1/work-items/${e1.item.id}/envasado`, { destination: "ENVASADO_MASIVO", line: "Línea 2", producedQuantity: "500", unitsToPackage: "1000", idempotencyKey: k1 });
  const s1b = await json(s1);
  check("Elaboración envía directo a Envasado Masivo", s1.ok() && s1b.destinationSector === "ENVASADO_MASIVO" && s1b.replayed === false, String(s1.status()) + JSON.stringify(s1b).slice(0, 120));
  const srcRow = await wi(e1.item.id);
  const dest = (await q("select * from work_items where client = $1 and product = 'Shampoo Uno' and sector = 'ENVASADO_MASIVO'", [CLIENT]))[0];
  check("Elaboración queda completa (no entregada) y el pedido NO se entrega", srcRow.operational_status === "completo" && srcRow.completed_by && (await q("select estado from production_pedidos where id = $1", [pedido1]))[0].estado === "EN_ENVASADO");
  check("Se creó UN trabajo de Envasado Masivo con misma identidad (cliente/producto/pedido) y línea elegida", dest && dest.production_pedido_id === pedido1 && dest.line === "Línea 2" && dest.planned_quantity === "1000" && dest.operational_status === "pendiente");
  const ev = await q("select type, actor_email, actor_sector from operational_events where work_item_id = any($1) and type in ('SENT_TO_ENVASADO','RECEIVED_FROM_ELABORACION')", [[e1.item.id, dest.id]]);
  check("Evento operativo con quién/cuándo en ambos trabajos", ev.length === 2 && ev.every((e) => e.actor_email === E2E_USERS.elaboracion.email));
  const s1r = await post(elab, `/api/v1/work-items/${e1.item.id}/envasado`, { destination: "ENVASADO_MASIVO", producedQuantity: "500", idempotencyKey: k1 });
  check("Reintento idempotente: no duplica el trabajo de Envasado", s1r.ok() && (await json(s1r)).replayed === true && (await q("select count(*)::int n from work_items where client = $1 and sector = 'ENVASADO_MASIVO'", [CLIENT]))[0].n === 1);
  const n1 = (await notifs()).filter((n) => n.title.includes("Elaboración"));
  check("Notificación única a Producción/Dirección (id determinístico) con cliente, producto, cantidad, lote opcional y responsable", n1.length === 1 && n1[0].sectors.includes("PRODUCCION") && n1[0].sectors.includes("DIRECCION") && /Cliente/.test(n1[0].message) && /Shampoo Uno/.test(n1[0].message) && /E2E Elaboración/.test(n1[0].message) && /Envasado Masivo/.test(n1[0].message) && n1[0].href.includes("workItemId=native%3A"), JSON.stringify(n1[0]?.message).slice(0, 200));

  // Premium (otro producto) y enlace con trabajo existente
  const pedido2 = await newPedido("OP-E2E-9002", "Crema Premium");
  const e2 = await assign(produccion, { sector: "ELABORACION", branchOwner: "Nicolás", client: CLIENT, product: "Crema Premium", plannedQuantity: "80", unit: "kg", productionPedidoId: pedido2 });
  const existing = await assign(produccion, { sector: "ENVASADO_PREMIUM", line: "Línea 1", client: CLIENT, product: "Crema Premium", plannedQuantity: "300", productionPedidoId: pedido2 });
  const s2 = await json(await post(elab, `/api/v1/work-items/${e2.item.id}/envasado`, { destination: "ENVASADO_PREMIUM", producedQuantity: "80", idempotencyKey: randomUUID() }));
  check("Elaboración → Envasado Premium enlaza el trabajo existente del mismo pedido/producto (sin duplicar)", s2.linked === true && s2.destinationWorkItem.nativeId === existing.item.id && (await q("select count(*)::int n from work_items where client = $1 and product = 'Crema Premium' and sector = 'ENVASADO_PREMIUM'", [CLIENT]))[0].n === 1);
  const sugAfter = await json(await elab.page.request.get(`/api/v1/work-items/${(await assign(produccion, { sector: "ELABORACION", branchOwner: "Cristian", client: CLIENT, product: "Crema Premium", plannedQuantity: "10", unit: "kg", productionPedidoId: pedido2 })).item.id}/envasado`));
  check("El destino se deduce del pedido+producto (Premium)", sugAfter.sector === "ENVASADO_PREMIUM");

  // ===== 2. Envasado → Codificado SIN cajas =====
  const destM = dest.id;
  const over = await post(masivo, `/api/v1/work-items/${destM}/codificado`, { action: "send", totalUnits: 5000, idempotencyKey: randomUUID() });
  check("Total que supera lo disponible del trabajo se rechaza (compatibilidad con cantidades)", over.status() === 400 && /disponible/i.test((await json(over)).error ?? ""));
  const kc = `cod-${randomUUID()}`;
  const toCod = await post(masivo, `/api/v1/work-items/${destM}/codificado`, { action: "send", totalUnits: 1000, idempotencyKey: kc });
  const afterCod = await wi(destM);
  check("Envasado → Codificado SIN cajas, distribución ni unidades por caja: solo cantidad total (backend)", toCod.ok() && afterCod.sector === "CODIFICADO" && Number(afterCod.packaging_total_units) === 1000 && (afterCod.packing_groups === null || (Array.isArray(afterCod.packing_groups) && afterCod.packing_groups.length === 0)), `${toCod.status()} sector=${afterCod.sector} total=${afterCod.packaging_total_units} groups=${JSON.stringify(afterCod.packing_groups)}`);
  const toCodR = await post(masivo, `/api/v1/work-items/${destM}/codificado`, { action: "send", totalUnits: 1000, idempotencyKey: kc });
  check("Reintento del envío a Codificado: no duplica ni cambia unidades", toCodR.ok() && (await json(toCodR)).replayed === true);
  check("No se cuentan unidades entregadas por enviar a Codificado", (await lines(destM)).length === 0 && (await q("select count(*)::int n from work_item_deliveries where work_item_id = $1", [destM]))[0].n === 0);
  check("Notificación a Producción: Envasado → Codificado", (await notifs()).some((n) => n.title.includes("Envasado Masivo → Codificado")));

  // ===== 3. Codificado → Entrega final (sin cajas) =====
  const noPerm = await post(masivo, `/api/v1/work-items/${destM}/codificado`, { action: "deliver", idempotencyKey: randomUUID() });
  check("Envasado ya no puede entregar un trabajo que está en Codificado (403)", noPerm.status() === 403);
  const kd = `deliv-${randomUUID()}`;
  const d1 = await post(cod, `/api/v1/work-items/${destM}/codificado`, { action: "deliver", idempotencyKey: kd, remito: "R-E2E-1", receivedBy: "Cliente" });
  const d1b = await json(d1);
  const afterDel = await wi(destM);
  check("Codificado ENTREGAR registra la entrega final automáticamente (sin aprobación) y el trabajo queda entregado", d1.ok() && d1b.delivery?.complete === true && afterDel.operational_status === "entregado", String(d1.status()) + (d1b.error ?? ""));
  const ln = await lines(destM);
  check("Una sola línea y fila agregada con las unidades reales (1000), sin duplicar Envasado+Codificado", ln.length === 1 && Number(ln[0].quantity) === 1000 && (await q("select quantity, delivery_complete from work_item_deliveries where work_item_id = $1 and status = 'ENTREGADO'", [destM])).length === 1);
  const d1r = await post(cod, `/api/v1/work-items/${destM}/codificado`, { action: "deliver", idempotencyKey: kd });
  check("Reintento/doble clic de la entrega con la misma clave: misma entrega, sin duplicados", d1r.ok() && (await json(d1r)).replayed === true && (await lines(destM)).length === 1);
  const pedAfter1 = (await q("select estado from production_pedidos where id = $1", [pedido1]))[0].estado;
  check("Pedido pasa a ENTREGADO cuando todos sus trabajos de despacho están entregados (con evento)", pedAfter1 === "ENTREGADO" && (await q("select 1 from production_pedido_status_events where pedido_id = $1 and to_estado = 'ENTREGADO'", [pedido1])).length === 1);
  check("Notificación a Producción: entrega final desde Codificado", (await notifs()).some((n) => n.title.startsWith("Entrega final") && /Codificado/.test(n.message)));

  // ===== 4. Envasado → Entrega final CON validación de cajas + parciales =====
  const pedido3 = await newPedido("OP-E2E-9003", "Tonico Tres");
  const b = (await assign(produccion, { sector: "ENVASADO_MASIVO", line: "Línea 1", client: CLIENT, product: "Tonico Tres", plannedQuantity: "1000", productionPedidoId: pedido3 })).item;
  const b2 = (await assign(produccion, { sector: "ENVASADO_MASIVO", line: "Línea 3", client: CLIENT, product: "Tonico Tres", plannedQuantity: "400", productionPedidoId: pedido3 })).item;
  const dNoBox = await live(masivo, { action: "deliver_work", workItemId: `native:${b.id}`, actorSectorId: "ENVASADO_MASIVO", idempotencyKey: randomUUID(), sourceSector: "ENVASADO_MASIVO", actualDeliveredAt: new Date().toISOString(), completion: { finishedQty: "1000" } });
  check("Entregar desde Envasado SIN cajas se rechaza (server-side)", dNoBox.status() === 400 && /cajas/i.test((await json(dNoBox)).error ?? ""));
  const dBadBox = await live(masivo, { action: "deliver_work", workItemId: `native:${b.id}`, actorSectorId: "ENVASADO_MASIVO", idempotencyKey: randomUUID(), sourceSector: "ENVASADO_MASIVO", actualDeliveredAt: new Date().toISOString(), completion: { finishedQty: "1000", packingGroups: [{ cajas: 9, unidadesPorCaja: 100 }] } });
  check("Distribución que no coincide con lo producido se rechaza sin observación", dBadBox.status() === 400 && /no coincide/i.test((await json(dBadBox)).error ?? ""));
  check("Nada se escribió con los rechazos", (await lines(b.id)).length === 0 && (await wi(b.id)).operational_status !== "entregado");
  const completion = { finishedQty: "1000", packingGroups: [{ cajas: 10, unidadesPorCaja: 100 }], packagingTotalUnits: 1000 };
  const kp1 = `p1-${randomUUID()}`;
  const p1 = await live(masivo, { action: "deliver_work", workItemId: `native:${b.id}`, actorSectorId: "ENVASADO_MASIVO", idempotencyKey: kp1, deliverQuantity: 400, sourceSector: "ENVASADO_MASIVO", actualDeliveredAt: new Date().toISOString(), completion });
  const p1b = await json(p1);
  const bAfter1 = await wi(b.id);
  check("Entrega PARCIAL (400 de 1000): saldo 600, el trabajo NO se marca entregado", p1.ok() && p1b.complete === false && Number(p1b.pending) === 600 && bAfter1.operational_status !== "entregado", String(p1.status()) + (p1b.error ?? ""));
  const agg1 = (await q("select id, quantity, delivery_complete, pending_balance from work_item_deliveries where work_item_id = $1 and status = 'ENTREGADO'", [b.id]))[0];
  check("Agregado acumula lo entregado y conserva el saldo pendiente", agg1 && agg1.quantity === "400" && agg1.delivery_complete === false && Number(agg1.pending_balance) === 600);
  const p1r = await live(masivo, { action: "deliver_work", workItemId: `native:${b.id}`, actorSectorId: "ENVASADO_MASIVO", idempotencyKey: kp1, deliverQuantity: 400, sourceSector: "ENVASADO_MASIVO", actualDeliveredAt: new Date().toISOString() });
  check("Doble clic/reintento (misma clave): una sola entrega parcial", p1r.ok() && (await json(p1r)).replayed === true && (await lines(b.id)).length === 1);
  const tooMuch = await live(masivo, { action: "deliver_work", workItemId: `native:${b.id}`, actorSectorId: "ENVASADO_MASIVO", idempotencyKey: randomUUID(), deliverQuantity: 700, sourceSector: "ENVASADO_MASIVO", actualDeliveredAt: new Date().toISOString() });
  check("No se puede entregar más que el saldo (sin 'stock negativo')", tooMuch.status() === 400 && /saldo/i.test((await json(tooMuch)).error ?? ""));
  check("Pedido NO queda ENTREGADO con una parcial pendiente ni con otro trabajo sin entregar", (await q("select estado from production_pedidos where id = $1", [pedido3]))[0].estado !== "ENTREGADO");
  const arch = await live(produccion, { action: "archive_delivery", id: agg1.id, actorSectorId: "PRODUCCION", actorName: "E2E" });
  check("Una entrega PARCIAL no se puede archivar (400) y sigue vigente", arch.status() === 400 && (await q("select archived from work_item_deliveries where id = $1", [agg1.id]))[0].archived === false, String(arch.status()));
  const p2 = await live(masivo, { action: "deliver_work", workItemId: `native:${b.id}`, actorSectorId: "ENVASADO_MASIVO", idempotencyKey: randomUUID(), sourceSector: "ENVASADO_MASIVO", actualDeliveredAt: new Date().toISOString() });
  const p2b = await json(p2);
  check("Parcial posterior por el saldo completa la cantidad: trabajo entregado", p2.ok() && p2b.complete === true && (await wi(b.id)).operational_status === "entregado" && (await lines(b.id)).length === 2 && (await lines(b.id)).reduce((s, l) => s + Number(l.quantity), 0) === 1000);
  check("Pedido sigue sin ENTREGADO mientras falte el otro trabajo", (await q("select estado from production_pedidos where id = $1", [pedido3]))[0].estado !== "ENTREGADO");
  const dirB2 = await live(direccion, { action: "deliver_work", workItemId: `native:${b2.id}`, actorSectorId: "DIRECCION", idempotencyKey: randomUUID(), sourceSector: "ENVASADO_MASIVO", actualDeliveredAt: new Date().toISOString() });
  check("Dirección puede registrar la entrega de cualquier trabajo; con el último trabajo el pedido pasa a ENTREGADO (monótono)", dirB2.ok() && (await q("select estado from production_pedidos where id = $1", [pedido3]))[0].estado === "ENTREGADO", String(dirB2.status()) + (await json(dirB2)).error);
  check("Notificaciones de entrega parcial y final a Producción", (await notifs()).some((n) => /parcial/i.test(n.title)) && (await notifs()).some((n) => n.title.startsWith("Entrega final") && /Envasado Masivo/.test(n.message)));

  // ===== 5. Permisos por sector =====
  const c = (await assign(produccion, { sector: "ENVASADO_MASIVO", line: "Línea 1", client: CLIENT, product: "Permisos", plannedQuantity: "100" })).item;
  const withBoxes = { finishedQty: "100", packingGroups: [{ cajas: 1, unidadesPorCaja: 100 }] };
  const perm = async (u, sec) => (await live(u, { action: "deliver_work", workItemId: `native:${c.id}`, actorSectorId: sec, idempotencyKey: randomUUID(), sourceSector: "ENVASADO_MASIVO", actualDeliveredAt: new Date().toISOString(), completion: withBoxes })).status();
  check("Envasado Premium no entrega un trabajo de Envasado Masivo (403)", (await perm(premium, "ENVASADO_PREMIUM")) === 403);
  check("Elaboración no entrega a cliente (403)", (await perm(elab, "ELABORACION")) === 403);
  check("Calidad no entrega (403)", (await perm(calidad, "CALIDAD")) === 403);
  check("Nada se entregó con los intentos no autorizados", (await lines(c.id)).length === 0);
  check("Envasado Masivo sí entrega lo suyo", (await perm(masivo, "ENVASADO_MASIVO")) === 200);

  const getForeign = await premium.page.request.get(`/api/v1/work-items/${e1.item.id}/envasado`);
  check("GET destino de Envasado: un sector ajeno al trabajo recibe 403", getForeign.status() === 403, String(getForeign.status()));
  const handoffDelivered = await post(produccion, `/api/v1/work-items/${destM}/codificado`, { action: "send", totalUnits: 1000, idempotencyKey: randomUUID() });
  check("No se puede enviar a Codificado un trabajo ya entregado (400)", handoffDelivered.status() === 400, String(handoffDelivered.status()));

  // ===== 6. Calidad fuera del circuito =====
  for (const action of ["quality_decision", "quality_annul"]) {
    const r = await live(produccion, { action, itemId: `native:${c.id}`, status: "aprobado", actorSectorId: "PRODUCCION", reason: "x" });
    const body = await json(r);
    check(`${action} retirada (410 QUALITY_CIRCUIT_RETIRED)`, r.status() === 410 && body.code === "QUALITY_CIRCUIT_RETIRED");
  }
  const calidadPending = await calidad.page.request.get("/api/v1/work-items/pending-definition");
  check("Calidad no accede a pendientes de definir (403)", calidadPending.status() === 403);

  // ===== 7. Pendientes en Calidad reubicados =====
  const weekId = (await q("select planning_week_id from work_items where client = $1 limit 1", [CLIENT]))[0].planning_week_id;
  const legacy = async (sector, line, product, extra = "") =>
    (await q(`insert into work_items (planning_week_id, planned_date, client, product, planned_quantity, unit, sector, line, status, created_by, source, operational_status, completed_at, completed_by, finished_qty, quality_status ${extra ? "," + extra.split("=")[0] : ""}) values ($1,$2,$3,$4,'200','un.',$5,$6,'PUBLICADO','legacy@genus.test','native','revision', now(), 'legacy', '200', 'pendiente' ${extra ? "," + extra.split("=")[1] : ""}) returning id`, [weekId, DAY, CLIENT, product, sector, line]))[0].id;
  const l1 = await legacy("ENVASADO_MASIVO", "Línea 2", "Legacy Uno");
  const l2 = await legacy("CODIFICADO", null, "Legacy Dos");
  await q("update work_items set quality_status = 'aprobado', quality_decided_by = 'Calidad histórica', quality_observation = 'ok histórica' where id = $1", [l2]);
  const pd = await json(await produccion.page.request.get("/api/v1/work-items/pending-definition"));
  const ids = (pd.items ?? []).map((i) => i.workItem.nativeId);
  check("Producción ve los pendientes de Calidad en «Pendientes de definir» con acciones por sector", ids.includes(l1) && ids.includes(l2) && pd.items.find((i) => i.workItem.nativeId === l1).info.actions.includes("ENVIAR_A_CODIFICADO") && pd.items.find((i) => i.workItem.nativeId === l1).info.actions.includes("REGISTRAR_ENTREGA"));
  const retired1 = await q("select count(*)::int n from operational_events where type = 'QUALITY_CIRCUIT_RETIRED' and work_item_id = $1", [l1]);
  await produccion.page.request.get("/api/v1/work-items/pending-definition");
  const retired2 = await q("select count(*)::int n from operational_events where type = 'QUALITY_CIRCUIT_RETIRED' and work_item_id = $1", [l1]);
  check("Evento QUALITY_CIRCUIT_RETIRED idempotente por ítem (una sola vez)", retired1[0].n === 1 && retired2[0].n === 1);
  check("Los de decisión histórica NO se reubican como «pendiente de Calidad» (conservan su decisión)", (await q("select count(*)::int n from operational_events where type = 'QUALITY_CIRCUIT_RETIRED' and work_item_id = $1", [l2]))[0].n === 0 && (await wi(l2)).quality_status === "aprobado" && (await wi(l2)).quality_observation === "ok histórica");
  const stillRev = await q("select operational_status from work_items where id = any($1)", [[l1, l2]]);
  check("NO se marcaron entregados ni finalizados automáticamente; sin entregas creadas", stillRev.every((r) => r.operational_status === "revision") && (await q("select count(*)::int n from work_item_deliveries where work_item_id = any($1)", [[l1, l2]]))[0].n === 0);
  console.log(`INFO trabajos pendientes en Calidad reubicados en la base de prueba: ${pd.legacyQualityPending}`);
  const toC = await post(produccion, `/api/v1/work-items/${l1}/codificado`, { action: "send", totalUnits: 200, idempotencyKey: randomUUID() });
  check("Producción envía un pendiente a Codificado (vuelve a estar en curso, sin entregar)", toC.ok() && (await wi(l1)).sector === "CODIFICADO" && (await wi(l1)).operational_status === "en_curso", String(toC.status()) + (await json(toC)).error);
  const regDel = await live(produccion, { action: "deliver_work", workItemId: `native:${l2}`, actorSectorId: "PRODUCCION", idempotencyKey: randomUUID(), sourceSector: "CODIFICADO", actualDeliveredAt: new Date().toISOString() });
  check("Producción registra la entrega de un pendiente histórico (sin aprobación)", regDel.ok() && (await wi(l2)).operational_status === "entregado" && (await wi(l2)).quality_status === "aprobado");
  const rw = await live(produccion, { action: "rework_work", itemId: `native:${(await legacy("ELABORACION", null, "Legacy Rework").catch(() => null)) ?? ""}`, actorSectorId: "PRODUCCION", reason: "r" });
  void rw;

  // ===== 8. Notificaciones =====
  const all = await json(await produccion.page.request.get("/api/v1/notifications?all=1"));
  const circ = (all.notifications ?? []).filter((n) => n.kind === "circuito_movimiento");
  check("Producción ve las notificaciones del circuito (persistidas en BD)", circ.length >= 5 && circ.every((n) => n.sectors.includes("PRODUCCION")));
  check("Dirección también las recibe; Envasado/Elaboración no", ((await json(await direccion.page.request.get("/api/v1/notifications?all=1"))).notifications ?? []).some((n) => n.kind === "circuito_movimiento") && !((await json(await masivo.page.request.get("/api/v1/notifications?all=1"))).notifications ?? []).some((n) => n.kind === "circuito_movimiento"));
  const dup = await q("select id, count(*)::int n from os_notifications where kind = 'circuito_movimiento' group by id having count(*) > 1");
  check("Sin notificaciones duplicadas por reintentos", dup.length === 0);
  const one = circ[0];
  await produccion.page.request.patch(`/api/v1/notifications/${one.id}`, { data: { action: "read" } });
  const afterOne = (await json(await produccion.page.request.get("/api/v1/notifications?all=1"))).notifications.find((n) => n.id === one.id);
  check("Marcar una como leída", afterOne.readBy.includes(E2E_USERS.produccion.email));
  const readAll = await json(await produccion.page.request.patch("/api/v1/notifications", { data: { action: "read_all" } }));
  const afterAll = (await json(await produccion.page.request.get("/api/v1/notifications?all=1"))).notifications.filter((n) => n.sectors.includes("PRODUCCION"));
  check("Marcar TODAS como leídas", readAll.ok && afterAll.every((n) => n.readBy.includes(E2E_USERS.produccion.email)));
  check("Leer no afecta a Dirección (lectura por usuario)", (await json(await direccion.page.request.get("/api/v1/notifications?all=1"))).notifications.some((n) => n.kind === "circuito_movimiento" && !n.readBy.includes(E2E_USERS.direccion.email)));

  // ===== 9. UI: menú, historial, campana, capturas =====
  const sizes = [
    ["desktop", { width: 1440, height: 900 }],
    ["tablet", { width: 820, height: 1100 }],
    ["celular", { width: 390, height: 844 }],
  ];
  for (const [label, vp] of sizes) {
    const prod = await openAs(E2E_USERS.produccion, vp);
    const mobile = vp.width < 700;
    await prod.page.goto("/mi-trabajo");
    if (mobile) await prod.page.getByRole("button", { name: "Abrir menú" }).click({ timeout: 120_000 });
    const menu = mobile ? prod.page.getByRole("dialog", { name: "Menú" }) : prod.page;
    const pend = menu.getByRole("button", { name: /Pendientes de definir/ }).first();
    await pend.waitFor({ timeout: 120_000 });
    const menuText = (await (mobile ? menu.textContent() : prod.page.locator("nav, aside").first().textContent())) ?? "";
    check(`Menú de Producción (${label}): tiene «Pendientes de definir» y no tiene Calidad/Aprobados/Rechazados`, !/Calidad|Aprobados|Rechazados/.test(menuText), menuText.slice(0, 160));
    await pend.click();
    await prod.page.getByTestId("pendientes-table").waitFor({ timeout: 60_000 }).catch(() => {});
    await prod.page.screenshot({ path: `${OUT}/pendientes-${label}.png` });
    const hs = await prod.page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth);
    check(`Pendientes de definir sin scroll horizontal (${label})`, hs);
    await prod.ctx.close();
  }
  const cal = await openAs(E2E_USERS.calidad);
  await cal.page.goto("/mi-trabajo");
  await cal.page.waitForTimeout(2500);
  const calText = (await cal.page.locator("body").textContent()) ?? "";
  check("Calidad entra (login vigente) y ve el Historial de solo lectura, sin menú de aprobaciones", cal.page.url().includes("/mi-trabajo") && !/Pendientes de aprobación|Aprobar|Rechazar/.test(calText) && /Historial/.test(calText));
  await cal.page.screenshot({ path: `${OUT}/calidad-historial.png` });
  await produccion.page.goto("/mi-trabajo");
  await produccion.page.getByRole("button", { name: /Notificaciones/ }).click({ timeout: 120_000 });
  await produccion.page.getByTestId("bell-unread-summary").waitFor({ timeout: 30_000 });
  check("Campana de Producción: resumen de sin leer, abrir trabajo y marcar todas", (await produccion.page.getByTestId("bell-open-work").count()) > 0);
  await produccion.page.screenshot({ path: `${OUT}/campana.png` });
} catch (err) {
  check("ejecución sin excepciones", false, err instanceof Error ? err.stack?.slice(0, 600) : String(err));
} finally {
  await cleanup().catch(() => {});
  await browser.close();
  await pool.end();
}
const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} verificaciones OK`);
process.exit(failed.length ? 1 : 0);
