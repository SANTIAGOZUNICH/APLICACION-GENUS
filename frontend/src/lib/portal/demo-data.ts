/**
 * Datos FICTICIOS del modo demostración (PURO, sin base de datos): produce el mismo resumen que ve un cliente real, pero
 * armado con filas inventadas en memoria. No lee ni escribe ninguna tabla de GENUS OS: es imposible que la demostración
 * mezcle clientes, pedidos, entregas ni stock reales. Se pasa por el MISMO armado de vista que el portal real
 * (buildOverview), para que las tarjetas, el camión, los plazos y las entregas se comporten igual.
 */
import { businessCalendar, addDaysIso, toBuenosAiresDate, type BusinessCalendarOptions } from "./business-days";
import { buildOverview, opaque, toClientPayload, type ConfirmationInfo, type RawDeliveryRow, type RawEventRow, type RawMarkRow, type RawWorkRow } from "./overview";

export const DEMO_CLIENT_NAME = "Cliente de demostración";
export const DEMO_CLIENT_CODE = "DEMO";

export type DemoNotification = { id: string; kind: string; title: string; body: string; createdAt: string; read: boolean };

/** Fecha de ingreso tal que, hoy, hayan transcurrido exactamente `elapsed` días hábiles (el día de ingreso no cuenta). */
export function startWithElapsed(now: Date, elapsed: number, opts: BusinessCalendarOptions = {}): string {
  const cal = businessCalendar(opts);
  const today = toBuenosAiresDate(now);
  for (let k = 0; k < 60; k++) {
    const day = addDaysIso(today, -k);
    if (cal.isBusinessDay(day) && cal.businessDaysBetween(day, today) === elapsed) return `${day}T15:00:00.000Z`; // 12:00 hs de Buenos Aires
  }
  return `${addDaysIso(today, -elapsed - 2)}T15:00:00.000Z`;
}

const ago = (now: Date, hours: number) => new Date(now.getTime() - hours * 3_600_000).toISOString();
const D = "demo";

function baseWork(over: Partial<RawWorkRow> & Pick<RawWorkRow, "id" | "product" | "sector" | "operationalStatus">): RawWorkRow {
  return {
    client: DEMO_CLIENT_NAME,
    source: "native",
    createdAt: null,
    completedAt: null,
    progressUpdatedAt: null,
    sentToCodificadoAt: null,
    viaCodificado: false,
    plannedQuantity: null,
    unit: "un.",
    finishedQty: null,
    deliverableUnits: null,
    packagingTotalUnits: null,
    productionPedidoId: null,
    pedidoOp: null,
    pedidoProducto: null,
    ...over,
  };
}

export type DemoState = { confirmations: Record<string, string> };

/** Claves (internas, solo de la demo) de las entregas ficticias. */
export const DEMO_DELIVERY_KEYS = { parcial: "line:demo-d1", pendiente: "line:demo-d2", confirmada: "line:demo-d3" } as const;

export function buildDemoOverview(sessionId: string, now: Date, state: DemoState, calendar: BusinessCalendarOptions = {}) {
  const clientId = `${D}:${sessionId}`;
  const works: RawWorkRow[] = [
    // 1) Crema facial en elaboración, 8 días hábiles restantes (10 − 2).
    baseWork({ id: "demo-w1", product: "Crema facial hidratante", pedidoProducto: "Crema facial hidratante", pedidoOp: "DEMO-1001", productionPedidoId: "demo-p1", sector: "ELABORACION", operationalStatus: "en_curso", plannedQuantity: "300", unit: "kg", createdAt: ago(now, 72) }),
    // 2) Shampoo en envasado, 3 días hábiles restantes (5 − 2).
    baseWork({ id: "demo-w2", product: "Shampoo reparador", pedidoProducto: "Shampoo reparador", pedidoOp: "DEMO-1002", productionPedidoId: "demo-p2", sector: "ENVASADO_MASIVO", operationalStatus: "en_curso", plannedQuantity: "3000", createdAt: ago(now, 96) }),
    // 3) Sérum listo para entregar: el último sector CONFIRMÓ la disponibilidad (ver marcas más abajo).
    baseWork({ id: "demo-w3", product: "Sérum antiedad", pedidoProducto: "Sérum antiedad", pedidoOp: "DEMO-1003", productionPedidoId: "demo-p3", sector: "ENVASADO_MASIVO", operationalStatus: "revision", plannedQuantity: "1500", createdAt: ago(now, 200), completedAt: ago(now, 6) }),
    // 4) Disponibilidad y entrega parciales: 5.000 solicitadas · 2.000 entregadas · 1.500 disponibles · 1.500 pendientes.
    baseWork({ id: "demo-w4", product: "Acondicionador nutritivo", pedidoProducto: "Acondicionador nutritivo", pedidoOp: "DEMO-1004", productionPedidoId: "demo-p4", sector: "ENVASADO_MASIVO", operationalStatus: "en_curso", plannedQuantity: "5000", finishedQty: "3500", createdAt: ago(now, 300) }),
    // 5) Entregado, recepción pendiente de confirmar.
    baseWork({ id: "demo-w5", product: "Tónico capilar", pedidoProducto: "Tónico capilar", pedidoOp: "DEMO-1005", productionPedidoId: "demo-p5", sector: "ENVASADO_PREMIUM", operationalStatus: "entregado", plannedQuantity: "800", createdAt: ago(now, 400), completedAt: ago(now, 60) }),
    // 6) Entregado, recepción ya confirmada.
    baseWork({ id: "demo-w6", product: "Mascarilla nutritiva", pedidoProducto: "Mascarilla nutritiva", pedidoOp: "DEMO-1006", productionPedidoId: "demo-p6", sector: "ENVASADO_MASIVO", operationalStatus: "entregado", plannedQuantity: "1200", createdAt: ago(now, 600), completedAt: ago(now, 220) }),
  ];
  const events: RawEventRow[] = [
    { workItemId: "demo-w1", type: "ITEM_ASSIGNED", at: startWithElapsed(now, 2, calendar) },
    { workItemId: "demo-w2", type: "RECEIVED_FROM_ELABORACION", at: startWithElapsed(now, 2, calendar) },
  ];
  const deliveries: RawDeliveryRow[] = [
    { key: DEMO_DELIVERY_KEYS.parcial, workItemId: "demo-w4", at: ago(now, 72), quantity: 2000, unit: "un." },
    { key: DEMO_DELIVERY_KEYS.pendiente, workItemId: "demo-w5", at: ago(now, 48), quantity: 800, unit: "un." },
    { key: DEMO_DELIVERY_KEYS.confirmada, workItemId: "demo-w6", at: ago(now, 216), quantity: 1200, unit: "un." },
  ];
  // Confirmaciones EXPLÍCITAS de «Listo para entregar» (ficticias): sin una marca no hay disponibilidad en el portal.
  const marks: RawMarkRow[] = [
    { id: "demo-m3", workItemId: "demo-w3", quantity: 1500, at: ago(now, 5) },
    { id: "demo-m4", workItemId: "demo-w4", quantity: 1500, at: ago(now, 30), deliveredBefore: 2000 },
  ];
  const confirmations = new Map<string, ConfirmationInfo>([[DEMO_DELIVERY_KEYS.confirmada, { at: ago(now, 192), by: "demostracion@genus.demo" }]]);
  for (const [key, at] of Object.entries(state.confirmations)) confirmations.set(key, { at, by: "demostracion@genus.demo" });
  const overview = buildOverview({ clientId, works, deliveries, events, marks, confirmations, now, calendar });

  const sorted = (id: string) => overview.products.find((p) => p.product === id);
  const ready = sorted("Sérum antiedad");
  const delivered = overview.deliveries.find((d) => d.product === "Tónico capilar");
  const notifications: DemoNotification[] = [
    { id: "demo-n1", kind: "LISTO_PARA_ENTREGAR", title: "Tu producto está listo", body: `${ready?.product ?? "Sérum antiedad"} · 1.500 un disponibles. Podés coordinar la entrega con nuestro equipo.`, createdAt: ago(now, 5), read: false },
    { id: "demo-n2", kind: "ENTREGA_REGISTRADA", title: "Registramos una entrega", body: `${delivered?.product ?? "Tónico capilar"} · 800 un. Cuando lo recibas, confirmá la recepción desde el portal.`, createdAt: ago(now, 47), read: false },
    { id: "demo-n3", kind: "ENTREGA_REGISTRADA", title: "Registramos una entrega", body: "Mascarilla nutritiva · 1.200 un. Recepción confirmada.", createdAt: ago(now, 215), read: true },
  ];
  return { overview, clientId, notifications };
}

/** Lo que viaja al navegador en modo demostración (misma forma que el portal real + la marca `demo`). */
export function buildDemoPayload(sessionId: string, now: Date, state: DemoState, calendar: BusinessCalendarOptions = {}) {
  const { overview, notifications } = buildDemoOverview(sessionId, now, state, calendar);
  return { ...toClientPayload(overview), client: { name: DEMO_CLIENT_NAME, code: DEMO_CLIENT_CODE }, notifications, demo: true as const };
}

/** Entrega ficticia por su id opaco (el que ve el navegador). null si no pertenece a la demo. */
export function findDemoDelivery(sessionId: string, opaqueId: string, now: Date, state: DemoState, calendar: BusinessCalendarOptions = {}) {
  const { overview, clientId } = buildDemoOverview(sessionId, now, state, calendar);
  const view = overview.deliveries.find((d) => d.id === opaqueId);
  if (!view) return null;
  const key = Object.values(DEMO_DELIVERY_KEYS).find((k) => opaque(clientId, "delivery", k) === opaqueId);
  return key ? { key, view } : null;
}
