import { beforeEach, describe, expect, it, vi } from "vitest";

const linkSemanasTask = vi.fn();
const unlinkSemanasTask = vi.fn();
const loadSemanasWorkItemPriorities = vi.fn();
let sessionSector = "PRODUCCION";

vi.mock("@/lib/orders/actor", () => ({
  // La identidad sale de la SESIÓN; el cliente no puede elegir su sector.
  resolveOrdersActor: async () => ({ email: "u@x.com", sector: sessionSector, displayName: "U" }),
}));
vi.mock("@/lib/semanas-sheet/semanas-sheet-service", () => ({
  linkSemanasTask: (...a: unknown[]) => linkSemanasTask(...a),
  unlinkSemanasTask: (...a: unknown[]) => unlinkSemanasTask(...a),
  loadSemanasWorkItemPriorities: (...a: unknown[]) => loadSemanasWorkItemPriorities(...a),
}));

import { OrdersForbiddenError } from "@/lib/orders/types";
import { LinkConflictError } from "@/lib/semanas-sheet/semanas-links-service";
import { DELETE, POST } from "./route";
import { GET as GET_PRIORITIES } from "../work-item-priorities/route";

const req = (method: string, body: unknown, headers: Record<string, string> = {}) =>
  new Request("http://x/api/v1/semanas/links", { method, body: JSON.stringify(body), headers: { "content-type": "application/json", ...headers } });

describe("/api/v1/semanas/links y /work-item-priorities", () => {
  beforeEach(() => {
    linkSemanasTask.mockReset();
    unlinkSemanasTask.mockReset();
    loadSemanasWorkItemPriorities.mockReset();
    sessionSector = "PRODUCCION";
  });

  it("POST pasa el actor de la sesión (un header de sector no cambia nada) y valida el cuerpo", async () => {
    linkSemanasTask.mockResolvedValue({ linkId: "l1" });
    sessionSector = "ELABORACION";
    await POST(req("POST", { tabKey: "ELABORACION", taskKey: "k", workItemId: "w" }, { "x-genus-actor-sector": "PRODUCCION" }));
    expect(linkSemanasTask.mock.calls[0]![0]).toMatchObject({ sector: "ELABORACION" });
    expect((await POST(req("POST", { tabKey: "ELABORACION" }))).status).toBe(400);
  });

  it("403 / 409 del servicio se respetan", async () => {
    linkSemanasTask.mockRejectedValueOnce(new OrdersForbiddenError("Solo Producción"));
    expect((await POST(req("POST", { tabKey: "ELABORACION", taskKey: "k", workItemId: "w" }))).status).toBe(403);
    linkSemanasTask.mockRejectedValueOnce(new LinkConflictError("ya vinculado"));
    expect((await POST(req("POST", { tabKey: "ELABORACION", taskKey: "k", workItemId: "w" }))).status).toBe(409);
    unlinkSemanasTask.mockRejectedValueOnce(new OrdersForbiddenError("Solo Producción"));
    expect((await DELETE(req("DELETE", { linkId: "l", expectedVersion: 1, reason: "motivo largo" }))).status).toBe(403);
    expect((await DELETE(req("DELETE", { linkId: "l" }))).status).toBe(400);
  });

  it("work-item-priorities: por sector de sesión; si la planilla no se puede leer, no muestra ninguna prioridad", async () => {
    sessionSector = "ENVASADO_MASIVO";
    loadSemanasWorkItemPriorities.mockResolvedValueOnce({ available: true, byWorkItem: {} });
    expect((await GET_PRIORITIES(new Request("http://x/api/v1/semanas/work-item-priorities"))).status).toBe(200);
    expect(loadSemanasWorkItemPriorities).toHaveBeenCalledWith("ENVASADO_MASIVO");
    loadSemanasWorkItemPriorities.mockRejectedValueOnce(new Error("Google caído"));
    const res = await GET_PRIORITIES(new Request("http://x/api/v1/semanas/work-item-priorities"));
    expect(await res.json()).toMatchObject({ available: false, byWorkItem: {} });
  });
});
