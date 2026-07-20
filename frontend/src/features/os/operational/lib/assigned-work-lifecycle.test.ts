import { describe, expect, it } from "vitest";
import { resolveAssignedWorkLifecycleAction } from "./assigned-work-lifecycle";

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

  it("bloquea trabajos ya cancelados", () => {
    const decision = resolveAssignedWorkLifecycleAction({ status: "cancelado" });
    expect(decision.action).toBe("bloquear_finalizado");
    expect(decision.reason).toContain("cancelado");
  });
});
