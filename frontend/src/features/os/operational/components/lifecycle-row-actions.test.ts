import { describe, expect, it } from "vitest";
import { pickPrimaryDelete } from "@/features/os/operational/components/lifecycle-row-actions";
import {
  confirmLabelForAction,
  submitLabelForAction,
} from "@/features/os/operational/components/lifecycle-confirm-dialog";
import type { LifecycleMenuItem } from "@/features/os/operational/components/lifecycle-actions-menu";
import type { LifecycleDecision } from "@/lib/lifecycle";

function decision(
  action: LifecycleDecision["action"],
  allowed = true
): LifecycleDecision {
  return {
    action,
    allowed,
    requireReason: true,
    requireDoubleConfirm: false,
    reason: "test",
  };
}

function item(
  action: LifecycleMenuItem["action"],
  allowed = true
): LifecycleMenuItem {
  return {
    action,
    label: action,
    decision: decision(action, allowed),
  };
}

describe("lifecycle row delete UX", () => {
  it("pickPrimaryDelete prioriza eliminar > anular > archivar", () => {
    expect(
      pickPrimaryDelete([item("archivar"), item("anular"), item("eliminar")])
        ?.action
    ).toBe("eliminar");
    expect(pickPrimaryDelete([item("archivar"), item("anular")])?.action).toBe(
      "anular"
    );
    expect(pickPrimaryDelete([item("archivar")])?.action).toBe("archivar");
    expect(pickPrimaryDelete([item("eliminar", false)])).toBeNull();
  });

  it("eliminar_definitivo (Eliminar OA) va PRIMERO — reemplaza a eliminar/anular como botón primario cuando está presente (regla nueva: Calidad no debe caer en el flujo viejo de 'borrador vacío')", () => {
    expect(
      pickPrimaryDelete([item("eliminar"), item("anular"), item("eliminar_definitivo")])
        ?.action
    ).toBe("eliminar_definitivo");
    expect(
      pickPrimaryDelete([item("anular"), item("eliminar_definitivo")])?.action
    ).toBe("eliminar_definitivo");
  });

  it("confirmLabelForAction refleja la política visual", () => {
    expect(confirmLabelForAction("eliminar")).toBe("Confirmar eliminación");
    expect(confirmLabelForAction("anular")).toBe("Confirmar anulación");
    expect(confirmLabelForAction("archivar")).toBe("Confirmar archivado");
    expect(confirmLabelForAction("eliminar_definitivo")).toBe("Confirmar eliminación");
  });

  it("submitLabelForAction: el botón dice 'Eliminar OA' solo para eliminar_definitivo, el resto no cambia", () => {
    expect(submitLabelForAction(item("eliminar_definitivo"))).toBe("eliminar_definitivo");
    expect(
      submitLabelForAction({ ...item("eliminar_definitivo"), label: "Eliminar OA" })
    ).toBe("Eliminar OA");
    expect(submitLabelForAction(item("anular"))).toBe("Confirmar anulación");
    expect(submitLabelForAction(item("archivar"))).toBe("Confirmar archivado");
  });
});
