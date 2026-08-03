import { describe, expect, it } from "vitest";
import { pickPrimaryDelete } from "@/features/os/operational/components/lifecycle-row-actions";
import { confirmLabelForAction } from "@/features/os/operational/components/lifecycle-confirm-dialog";
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

  it("confirmLabelForAction refleja la política visual", () => {
    expect(confirmLabelForAction("eliminar")).toBe("Confirmar eliminación");
    expect(confirmLabelForAction("anular")).toBe("Confirmar anulación");
    expect(confirmLabelForAction("archivar")).toBe("Confirmar archivado");
    expect(confirmLabelForAction("eliminar_definitivo")).toContain(
      "definitiva"
    );
  });
});
