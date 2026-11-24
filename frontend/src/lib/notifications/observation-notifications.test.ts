import { describe, expect, it, vi } from "vitest";

const insert = vi.fn();
vi.mock("@/lib/db/client", () => ({
  getDb: () => ({ insert: () => ({ values: () => ({ onConflictDoNothing: () => insert() }) }) }),
}));

import { emitObservationForDelivery, emitObservationNotification } from "./observation-notifications";

const base = { source: "LINEA" as const, eventKey: "l1", workItemId: "w1", sector: "ENVASADO_MASIVO", actorName: "Beto", at: new Date() };

describe("emitObservationNotification — best-effort", () => {
  it("una falla de la base NO lanza (la entrega ya está confirmada) y se informa ok:false", async () => {
    insert.mockRejectedValueOnce(new Error("db caída"));
    const spy = vi.spyOn(console, "error").mockImplementation(() => undefined);
    await expect(emitObservationNotification({ ...base, observation: "algo" })).resolves.toMatchObject({ ok: false });
    spy.mockRestore();
  });
  it("sin observación no toca la base", async () => {
    insert.mockClear();
    await expect(emitObservationNotification({ ...base, observation: "  " })).resolves.toEqual({ id: null, ok: true });
    expect(insert).not.toHaveBeenCalled();
  });
  it("emitObservationForDelivery nunca lanza, incluso con datos incompletos", async () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => undefined);
    await expect(emitObservationForDelivery({ line: null } as never, "x")).resolves.toBeUndefined();
    await expect(emitObservationForDelivery({ line: { observations: "obs" }, item: null } as never, "x")).resolves.toBeUndefined();
    spy.mockRestore();
  });
});
