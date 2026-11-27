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
    expect(sender).toHaveBeenCalledTimes(4);
  });
  it("el payload viaja serializado con título, cuerpo y url", async () => {
    const sender = vi.fn(async () => undefined);
    await planPushSend([subs[0]!], payload, sender);
    expect(JSON.parse((sender.mock.calls as unknown as string[][])[0]![1]!)).toEqual({ title: "T", body: "B", url: "/entregas#pedido-x", tag: "t", eventId: "e1" });
  });
  it("sin dispositivos no llama al sender", async () => {
    const sender = vi.fn();
    expect(await planPushSend([], payload, sender)).toEqual({ sent: [], gone: [], failed: [] });
    expect(sender).not.toHaveBeenCalled();
  });
  it("errores de red sin statusCode quedan como fallo transitorio", async () => {
    const plan = await planPushSend([subs[0]!], payload, async () => { throw new Error("ECONNRESET"); });
    expect(plan.failed[0]!.error).toContain("ECONNRESET");
  });
});
