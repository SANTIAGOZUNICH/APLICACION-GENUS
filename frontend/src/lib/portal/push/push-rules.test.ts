import { describe, expect, it } from "vitest";
import {
  buildPushMessage, businessDaysLabel, computeBaseline, detectTransitions, isValidPushEndpoint, parseSubscriptionInput, pushBackoffMs, pushDedupeKey,
  pushRankOfStatus, pushUrlForOrder, type OrderSnapshot,
} from "./push-rules";

const days = { elaboracionDays: 8, envasadoDays: 3 };
const order = (over: Partial<OrderSnapshot> & { orderKey: string }): OrderSnapshot => ({ orderRef: "OP-1", opaqueId: "opq1", statusId: 1, cancelled: false, todoListo: false, ...over });

describe("textos exactos", () => {
  it("recibido", () => {
    expect(buildPushMessage("RECIBIDO", null, days)).toEqual({ title: "¡Recibimos tu pedido!", body: "Tu pedido fue registrado correctamente. Te mantendremos informado sobre su avance." });
  });
  it("elaboración con N configurable (textos exactos)", () => {
    expect(buildPushMessage("ELABORACION", null, days)).toEqual({ title: "¡Tu pedido se está elaborando!", body: "Estimamos que estará listo para entregar en aproximadamente 8 días hábiles." });
    expect(buildPushMessage("ELABORACION", null, { ...days, elaboracionDays: 10 }).body).toBe("Estimamos que estará listo para entregar en aproximadamente 10 días hábiles.");
  });
  it("envasado con N configurable (textos exactos)", () => {
    expect(buildPushMessage("ENVASADO", null, days)).toEqual({ title: "¡Tu pedido está en envasado!", body: "Estimamos que estará listo para entregar en aproximadamente 3 días hábiles." });
  });
  it("listo y entregado (textos exactos)", () => {
    expect(buildPushMessage("LISTO", null, days)).toEqual({ title: "¡TU PEDIDO ESTÁ LISTO! 🎉", body: "Finalizamos la producción de tu pedido. Ya podemos coordinar su entrega." });
    expect(buildPushMessage("ENTREGADO", null, days)).toEqual({ title: "¡Tu pedido fue entregado!", body: "Gracias por confiar en Laboratorio Genus." });
  });
  it("el texto es EXACTO: la referencia del pedido no se agrega al cuerpo", () => {
    for (const t of ["RECIBIDO", "ELABORACION", "ENVASADO", "LISTO", "ENTREGADO"] as const) expect(buildPushMessage(t, "OP-123", days)).toEqual(buildPushMessage(t, null, days));
  });
  it("días hábiles en singular y plural", () => {
    expect(businessDaysLabel(1)).toBe("1 día hábil");
    expect(businessDaysLabel(8)).toBe("8 días hábiles");
  });
  it("la URL abre el pedido dentro del portal", () => expect(pushUrlForOrder("abc")).toBe("/entregas#pedido-abc"));
});

describe("idempotencia (clave lógica)", () => {
  it("misma clave para el mismo cliente/pedido/tipo; distinta si cambia cualquiera", () => {
    expect(pushDedupeKey("c1", "op:1", "LISTO")).toBe(pushDedupeKey("c1", "op:1", "LISTO"));
    expect(pushDedupeKey("c1", "op:1", "LISTO")).not.toBe(pushDedupeKey("c2", "op:1", "LISTO"));
    expect(pushDedupeKey("c1", "op:1", "LISTO")).not.toBe(pushDedupeKey("c1", "op:2", "LISTO"));
    expect(pushDedupeKey("c1", "op:1", "LISTO")).not.toBe(pushDedupeKey("c1", "op:1", "ENTREGADO"));
    expect(pushDedupeKey("c1", "op:1", "LISTO", "p1")).not.toBe(pushDedupeKey("c1", "op:1", "LISTO"));
  });
});

describe("detección de transiciones", () => {
  it("programado cuenta como recibido", () => expect(pushRankOfStatus(2)).toBe(1));

  it("baseline: el estado actual queda como ya notificado y no genera eventos", () => {
    const orders = [order({ orderKey: "a", statusId: 3 }), order({ orderKey: "b", statusId: 5, todoListo: true }), order({ orderKey: "c", cancelled: true, statusId: 0 })];
    const base = computeBaseline(orders);
    expect(base.map((b) => [b.orderKey, b.rank, b.baseline])).toEqual([["a", 3, true], ["b", 5, true]]);
    const state = new Map(base.map((b) => [b.orderKey, { lastRank: b.rank }]));
    expect(detectTransitions(orders, state).events).toEqual([]); // sin retroactivos
  });

  it("avance real notifica una sola vez y re-ejecutar no repite", () => {
    const state = new Map([["a", { lastRank: 1 }]]);
    const r1 = detectTransitions([order({ orderKey: "a", statusId: 3 })], state);
    expect(r1.events.map((e) => e.type)).toEqual(["ELABORACION"]);
    state.set("a", { lastRank: r1.upserts[0]!.rank });
    expect(detectTransitions([order({ orderKey: "a", statusId: 3 })], state).events).toEqual([]);
  });

  it("no retrocede: reproceso (5→4) no reenvía ni baja el estado; al volver a avanzar tampoco repite", () => {
    const state = new Map([["a", { lastRank: 5 }]]);
    const back = detectTransitions([order({ orderKey: "a", statusId: 4 })], state);
    expect(back.events).toEqual([]);
    expect(back.upserts).toEqual([]);
    expect(detectTransitions([order({ orderKey: "a", statusId: 5, todoListo: true })], state).events).toEqual([]);
  });

  it("salto de etapas: avisa solo la etapa actual", () => {
    const r = detectTransitions([order({ orderKey: "a", statusId: 4 })], new Map([["a", { lastRank: 1 }]]));
    expect(r.events.map((e) => e.type)).toEqual(["ENVASADO"]);
  });

  it("pedido nuevo después del baseline: avisa «recibido»", () => {
    const r = detectTransitions([order({ orderKey: "n", statusId: 1 })], new Map());
    expect(r.events.map((e) => e.type)).toEqual(["RECIBIDO"]);
  });

  it("pedido nunca visto que ya está listo/entregado se registra en silencio (sería retroactivo)", () => {
    const r = detectTransitions([order({ orderKey: "x", statusId: 6, todoListo: true })], new Map());
    expect(r.events).toEqual([]);
    expect(r.upserts[0]).toMatchObject({ rank: 6, baseline: true });
  });

  it("«Listo» jamás con el pedido incompleto (productos pendientes)", () => {
    const r = detectTransitions([order({ orderKey: "a", statusId: 5, todoListo: false })], new Map([["a", { lastRank: 3 }]]));
    expect(r.events.map((e) => e.type)).toEqual(["ENVASADO"]);
  });

  it("cancelados se ignoran", () => {
    expect(detectTransitions([order({ orderKey: "a", cancelled: true, statusId: 0 })], new Map([["a", { lastRank: 1 }]]))).toEqual({ events: [], upserts: [] });
  });

  it("flujo completo de un pedido: 1→3→4→5→6 genera exactamente 5 eventos distintos", () => {
    const state = new Map<string, { lastRank: number }>();
    const types: string[] = [];
    for (const [statusId, todoListo] of [[1, false], [2, false], [3, false], [4, false], [5, true], [6, true]] as const) {
      const r = detectTransitions([order({ orderKey: "a", statusId, todoListo })], state);
      r.events.forEach((e) => types.push(e.type));
      r.upserts.forEach((u) => state.set(u.orderKey, { lastRank: Math.max(state.get(u.orderKey)?.lastRank ?? 0, u.rank) }));
    }
    expect(types).toEqual(["RECIBIDO", "ELABORACION", "ENVASADO", "LISTO", "ENTREGADO"]);
  });
});

describe("reintentos y validación", () => {
  it("backoff exponencial con tope", () => {
    expect(pushBackoffMs(1)).toBe(5 * 60_000);
    expect(pushBackoffMs(2)).toBe(10 * 60_000);
    expect(pushBackoffMs(20)).toBe(6 * 3_600_000);
  });
  it("endpoint y suscripción", () => {
    expect(isValidPushEndpoint("https://fcm.googleapis.com/fcm/send/abcdefghijk")).toBe(true);
    expect(isValidPushEndpoint("http://fcm.googleapis.com/fcm/send/abcdefghijk")).toBe(false);
    expect(isValidPushEndpoint("https://user:pw@x.example.com/aaaaaaaaaaaa")).toBe(false);
    const ok = { endpoint: "https://fcm.googleapis.com/fcm/send/abcdefghijk", keys: { p256dh: "B".repeat(87), auth: "a".repeat(22) } };
    expect(parseSubscriptionInput(ok)).toEqual({ endpoint: ok.endpoint, p256dh: ok.keys.p256dh, auth: ok.keys.auth });
    expect(parseSubscriptionInput({ ...ok, keys: { p256dh: "x", auth: "y" } })).toBeNull();
    expect(parseSubscriptionInput(null)).toBeNull();
  });
});
