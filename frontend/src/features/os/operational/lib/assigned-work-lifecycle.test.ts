import { afterEach, describe, expect, it, vi } from "vitest";
import {
  executeAssignedWorkLifecycleAction,
  resolveAssignedWorkLifecycleAction,
} from "./assigned-work-lifecycle";
import type { WorkItem } from "@/types/operational/work-item";

describe("assigned-work-lifecycle", () => {
  it("elimina pendientes sin avance", () => {
    expect(resolveAssignedWorkLifecycleAction({ status: "pendiente" }).action).toBe("eliminar");
  });

  it("cancela pendientes con avance registrado", () => {
    expect(
      resolveAssignedWorkLifecycleAction(
        { status: "pendiente", finishedQty: "3" },
        { hasProgressRecord: true }
      ).action
    ).toBe("cancelar");
  });

  it("cancela trabajos en curso, bloqueados o en revision", () => {
    expect(resolveAssignedWorkLifecycleAction({ status: "en_curso" }).action).toBe("cancelar");
    expect(resolveAssignedWorkLifecycleAction({ status: "bloqueado" }).action).toBe("cancelar");
    expect(resolveAssignedWorkLifecycleAction({ status: "revision" }).action).toBe("cancelar");
  });

  it("archiva trabajos completos en vez de eliminarlos", () => {
    const decision = resolveAssignedWorkLifecycleAction({ status: "completo" });
    expect(decision.action).toBe("archivar");
    expect(decision.reason).toContain("finalizado");
  });

  it("bloquea trabajos ya cancelados — ofrece restaurar", () => {
    const decision = resolveAssignedWorkLifecycleAction({ status: "cancelado" });
    expect(decision.action).toBe("restaurar");
    expect(decision.reason).toContain("Restaurar");
  });

  it("restaurar eliminados desde historial", () => {
    const decision = resolveAssignedWorkLifecycleAction(
      { status: "pendiente" },
      { inactiveKind: "eliminado" }
    );
    expect(decision.action).toBe("restaurar");
  });
});

describe("executeAssignedWorkLifecycleAction — archivar en trabajos nativos borra (0025)", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("un trabajo nativo completo/entregado ya no falla al 'archivar' — llama delete_work (soft delete)", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ ok: true, record: { id: "wi-1" } }),
    });
    vi.stubGlobal("fetch", fetchMock);

    const item = {
      id: "native:wi-1",
      status: "completo",
      sector: "ELABORACION",
      product: "CREMA",
      client: "TEST_CLIENTE",
    } as unknown as WorkItem;

    const result = await executeAssignedWorkLifecycleAction({
      action: "archivar",
      item,
      actorSectorId: "PRODUCCION",
      actorName: "Producción",
      reason: "ya no se necesita",
    });

    expect(result.ok).toBe(true);
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/v1/live-sync/operations",
      expect.objectContaining({ method: "POST" })
    );
    const body = JSON.parse(fetchMock.mock.calls[0]![1].body as string);
    expect(body.action).toBe("delete_work");
    expect(body.itemId).toBe("native:wi-1");
  });
});
