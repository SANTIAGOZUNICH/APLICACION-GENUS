import { describe, expect, it, vi } from "vitest";
import { planPushSend, type PushSubscriptionRow } from "./push-send";

const subs: PushSubscriptionRow[] = ["a", "b", "c", "d"].map((id) => ({ id, endpoint: `https://push.example.com/${id}`, p256dh: "k", auth: "s" }));
const payload = { title: "T", body: "B", url: "/entregas#pedido-x", tag: "t", eventId: "e1" };

describe("plan de envío (web-push mockeado)", () => {
  it("clasifica enviados, dados de baja (404/410) y fallos transitorios sin frenar a los demás", async () => {
    const sender = vi.fn(async (s: PushSubscriptionRow) => {
      if (s.id === "b") throw Object.assign(new Error("gone"), { statusCode: 410 });
      if (s.id === "c") throw Object.assign(new Error("nf"), { statusCode: 404 });
      if (s.id === "d") throw Object.assign(new Error("boom"), { statusCode: 500 });
    });
    const plan = await planPushSend(subs, payload, sender);
    expect(plan.sent).toEqual(["a"]);
    expect(plan.gone).toEqual(["b", "c"]);
    expect(plan.failed.map((f) => f.id)).toEqual(["d"]);
    expect(plan.failed[0]).toMatchObject({ permanent: false });
    expect(sender).toHaveBeenCalledTimes(4);
  });
  it("el payload viaja serializado con título, cuerpo y url", async () => {
    const sender = vi.fn(async () => undefined);
    await planPushSend([subs[0]!], payload, sender);
    expect(JSON.parse((sender.mock.calls as unknown as string[][])[0]![1]!)).toEqual({ title: "T", body: "B", url: "/entregas#pedido-x", tag: "t", eventId: "e1" });
  });
  it("sin dispositivos no llama al sender", async () => {
    const sender = vi.fn();
    expect(await planPushSend([], payload, sender)).toEqual({ outcomes: [], sent: [], gone: [], invalid: [], failed: [] });
    expect(sender).not.toHaveBeenCalled();
  });
  it("errores de red sin statusCode quedan como fallo transitorio", async () => {
    const plan = await planPushSend([subs[0]!], payload, async () => { throw new Error("ECONNRESET"); });
    expect(plan.failed[0]!.error).toContain("ECONNRESET");
  });
  it("clasifica por código HTTP: 2xx aceptado, 404/410 baja, 401/403 VAPID, 413 permanente, 429 con Retry-After, 5xx reintento", async () => {
    const codes: Record<string, number | undefined> = { a: 201, b: 410, c: 403, d: 413, e: 429, f: 503, g: 401, h: 400 };
    const many: PushSubscriptionRow[] = Object.keys(codes).map((id) => ({ id, endpoint: `https://push.example.com/${id}`, p256dh: "k", auth: "s" }));
    const plan = await planPushSend(many, payload, async (s) => {
      const c = codes[s.id]!;
      if (c >= 400) throw Object.assign(new Error(`http ${c}`), { statusCode: c, headers: c === 429 ? { "retry-after": "120" } : {} });
      return { status: c };
    });
    const by = Object.fromEntries(plan.outcomes.map((o) => [o.id, o]));
    expect(by.a).toMatchObject({ kind: "accepted", status: 201 });
    expect(by.b).toMatchObject({ kind: "gone", status: 410 });
    expect(by.c).toMatchObject({ kind: "invalid", status: 403 });
    expect(by.g).toMatchObject({ kind: "invalid", status: 401 });
    expect(by.d).toMatchObject({ kind: "permanent", status: 413 });
    expect(by.h).toMatchObject({ kind: "permanent", status: 400 });
    expect(by.e).toMatchObject({ kind: "retry", status: 429, retryAfterMs: 120_000 });
    expect(by.f).toMatchObject({ kind: "retry", status: 503 });
    expect(plan.invalid).toEqual(["c", "g"]);
    expect(plan.failed.find((f) => f.id === "d")!.permanent).toBe(true);
    expect(plan.failed.find((f) => f.id === "e")!.retryAfterMs).toBe(120_000);
  });
  it("el payload por dispositivo lleva la credencial de acuse", async () => {
    const sender = vi.fn(async () => undefined);
    await planPushSend([subs[0]!], (s) => ({ ...payload, ack: { sid: s.id, token: "tok" } }), sender);
    expect(JSON.parse((sender.mock.calls as unknown as string[][])[0]![1]!).ack).toEqual({ sid: "a", token: "tok" });
  });
});
