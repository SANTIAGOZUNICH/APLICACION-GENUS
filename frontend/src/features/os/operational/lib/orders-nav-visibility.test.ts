import { describe, expect, it } from "vitest";
import { resolveSectorHome } from "@/lib/role-engine";
import { canOrderAction } from "@/lib/orders/rbac";
import { SIDEBAR_LABELS } from "@/features/os/shell/os-sidebar";
import type { SectorId } from "@/types/operational/sector";

function expectSidebarHas(sectorId: SectorId, item: keyof typeof SIDEBAR_LABELS) {
  const home = resolveSectorHome(sectorId);
  expect(home.sidebarItems).toContain(item);
}

describe("OE/OA navegación y CTA por sector", () => {
  it("PRODUCCION ve OE y OA en el menú y puede crear ambas", () => {
    expectSidebarHas("PRODUCCION", "ordenes_elaboracion");
    expectSidebarHas("PRODUCCION", "ordenes_acondicionamiento");
    expect(resolveSectorHome("PRODUCCION").sidebarItems).not.toContain("ordenes");
    expect(canOrderAction("OE", "create", "PRODUCCION")).toBe(true);
    expect(canOrderAction("OA", "create", "PRODUCCION")).toBe(true);
    expect(SIDEBAR_LABELS.ordenes_elaboracion).toBe("Órdenes de Elaboración");
    expect(SIDEBAR_LABELS.ordenes_acondicionamiento).toBe("Órdenes de Acondicionamiento");
  });

  it("CALIDAD ve OE y OA en el menú y puede crear ambas", () => {
    expectSidebarHas("CALIDAD", "ordenes_elaboracion");
    expectSidebarHas("CALIDAD", "ordenes_acondicionamiento");
    expect(canOrderAction("OE", "create", "CALIDAD")).toBe(true);
    expect(canOrderAction("OA", "create", "CALIDAD")).toBe(true);
    expect(canOrderAction("OE", "review", "CALIDAD")).toBe(true);
    expect(canOrderAction("OA", "download", "CALIDAD")).toBe(true);
  });

  it("ELABORACION ve OE, no crea, puede editar/entregar", () => {
    expectSidebarHas("ELABORACION", "ordenes_elaboracion");
    expect(resolveSectorHome("ELABORACION").sidebarItems).not.toContain(
      "ordenes_acondicionamiento"
    );
    expect(canOrderAction("OE", "create", "ELABORACION")).toBe(false);
    expect(canOrderAction("OE", "edit", "ELABORACION")).toBe(true);
    expect(canOrderAction("OE", "deliver", "ELABORACION")).toBe(true);
  });

  it("EMASIVO/EPREMIUM ven OA, no crean, pueden editar/entregar", () => {
    expectSidebarHas("ENVASADO_MASIVO", "ordenes_acondicionamiento");
    expectSidebarHas("ENVASADO_PREMIUM", "ordenes_acondicionamiento");
    expect(canOrderAction("OA", "create", "ENVASADO_MASIVO")).toBe(false);
    expect(canOrderAction("OA", "create", "ENVASADO_PREMIUM")).toBe(false);
    expect(canOrderAction("OA", "edit", "ENVASADO_MASIVO")).toBe(true);
    expect(canOrderAction("OA", "deliver", "ENVASADO_PREMIUM")).toBe(true);
  });

  it("MP consulta OE permitidas y no crea", () => {
    expectSidebarHas("MATERIA_PRIMA", "ordenes_elaboracion");
    expect(canOrderAction("OE", "create", "MATERIA_PRIMA")).toBe(false);
    expect(canOrderAction("OE", "view", "MATERIA_PRIMA")).toBe(true);
    expect(canOrderAction("OE", "download", "MATERIA_PRIMA")).toBe(true);
  });
});

/** Reglas de UI del CTA: visible si canCreate; el diálogo explica si falta DB o plantilla. */
export function resolveCreateOrderCtaState(input: {
  canCreate: boolean;
  readOnly?: boolean;
  dbUnavailable: boolean;
}): { visible: boolean; enabled: boolean; showDbHint: boolean } {
  const visible = input.canCreate && !input.readOnly;
  return {
    visible,
    // El botón abre el modal aunque falte DB; la creación real se bloquea dentro.
    enabled: visible,
    showDbHint: visible && input.dbUnavailable,
  };
}

describe("CTA crear orden con/sin base de datos", () => {
  it("sin DB: botón visible y abre modal; hint de configuración", () => {
    const state = resolveCreateOrderCtaState({
      canCreate: true,
      dbUnavailable: true,
    });
    expect(state.visible).toBe(true);
    expect(state.enabled).toBe(true);
    expect(state.showDbHint).toBe(true);
  });

  it("con DB: botón habilitado", () => {
    const state = resolveCreateOrderCtaState({
      canCreate: true,
      dbUnavailable: false,
    });
    expect(state.visible).toBe(true);
    expect(state.enabled).toBe(true);
    expect(state.showDbHint).toBe(false);
  });

  it("Elaboración: CTA no visible", () => {
    const state = resolveCreateOrderCtaState({
      canCreate: canOrderAction("OE", "create", "ELABORACION"),
      dbUnavailable: false,
    });
    expect(state.visible).toBe(false);
  });
});
