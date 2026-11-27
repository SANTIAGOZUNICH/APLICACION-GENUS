import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
const afterMock = vi.fn((fn: () => unknown) => void fn());
vi.mock("next/server", () => ({ after: (fn: () => unknown) => afterMock(fn) }));
vi.mock("@/lib/db/client", () => ({ getDb: () => ({}) }));

import { refsFromBody, withPortalPush } from "./push-trigger";

describe("withPortalPush", () => {
  beforeEach(() => {
    afterMock.mockClear();
    delete process.env.GENUS_PORTAL_PUSH_INLINE;
    process.env.VITEST = "false";
  });
  it("extrae el trabajo/pedido del cuerpo y de la ruta", () => {
    expect(refsFromBody({ workItemId: "native:abc" })).toEqual({ workItemId: "native:abc", pedidoId: null });
    expect(refsFromBody({ itemId: "x", pedidoId: "p" })).toEqual({ workItemId: "x", pedidoId: "p" });
    expect(refsFromBody(null)).toEqual({});
  });
  it("programa el disparo solo si la operación terminó bien y devuelve la MISMA respuesta", async () => {
    const ok = new Response("{}", { status: 200 });
    const h = withPortalPush(async () => ok);
    expect(await h(new Request("http://x/", { method: "POST", body: JSON.stringify({ workItemId: "w" }) }))).toBe(ok);
    expect(afterMock).toHaveBeenCalledTimes(1);
    afterMock.mockClear();
    const bad = new Response("{}", { status: 409 });
    expect(await withPortalPush(async () => bad)(new Request("http://x/", { method: "POST", body: "{}" }))).toBe(bad);
    expect(afterMock).not.toHaveBeenCalled();
  });
  it("un fallo al programar JAMÁS afecta la operación", async () => {
    afterMock.mockImplementation(() => { throw new Error("boom"); });
    const res = new Response("ok");
    await expect(withPortalPush(async () => res)(new Request("http://x/", { method: "POST", body: "no-json" }))).resolves.toBe(res);
    afterMock.mockImplementation((fn: () => unknown) => void fn());
  });
  it("con id de ruta (trabajo/pedido) no necesita leer el cuerpo", async () => {
    const h = withPortalPush(async (_r: Request, _c: { params: Promise<{ id: string }> }) => new Response("ok"), { idParam: "work" });
    await h(new Request("http://x/", { method: "POST", body: "x" }), { params: Promise.resolve({ id: "11111111-1111-4111-8111-111111111111" }) });
    expect(afterMock).toHaveBeenCalledTimes(1);
  });
});
