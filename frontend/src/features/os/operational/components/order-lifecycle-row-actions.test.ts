import { describe, expect, it } from "vitest";
import { buildOrderLifecycleMenuItems } from "./order-lifecycle-row-actions";

const baseOa = {
  id: "oa-1",
  type: "OA" as const,
  status: "BORRADOR" as const,
  lot: "G26080",
  product: "SERUM CAPIXYL",
  client: "SC BEAUTY",
};

describe("buildOrderLifecycleMenuItems — botón Eliminar OA", () => {
  it("Calidad ve la acción Eliminar OA (test obligatorio #7)", () => {
    const items = buildOrderLifecycleMenuItems(baseOa, "CALIDAD");
    const del = items.find((i) => i.action === "eliminar_definitivo");
    expect(del).toBeTruthy();
    expect(del?.label).toBe("Eliminar OA");
    expect(del?.requireReasonMandatory).toBe(true);
  });

  it("Producción y Dirección también la ven (mismo conjunto que administra OA hoy)", () => {
    expect(
      buildOrderLifecycleMenuItems(baseOa, "PRODUCCION").some((i) => i.action === "eliminar_definitivo")
    ).toBe(true);
    expect(
      buildOrderLifecycleMenuItems(baseOa, "DIRECCION").some((i) => i.action === "eliminar_definitivo")
    ).toBe(true);
  });

  it("un sector operativo no autorizado NO ve la acción Eliminar OA (test obligatorio #8)", () => {
    for (const sector of ["ENVASADO_MASIVO", "ENVASADO_PREMIUM", "CODIFICADO", "ELABORACION"] as const) {
      const items = buildOrderLifecycleMenuItems(baseOa, sector);
      expect(items.some((i) => i.action === "eliminar_definitivo")).toBe(false);
    }
  });

  it("no aparece para OE (la acción es exclusiva de OA)", () => {
    const items = buildOrderLifecycleMenuItems({ ...baseOa, type: "OE" }, "CALIDAD");
    expect(items.some((i) => i.action === "eliminar_definitivo")).toBe(false);
  });

  it("también aparece para una OA ANULADA — Calidad puede eliminar cualquier OA (regla nueva)", () => {
    const items = buildOrderLifecycleMenuItems({ ...baseOa, status: "ANULADA" }, "CALIDAD");
    expect(items.some((i) => i.action === "eliminar_definitivo")).toBe(true);
  });

  it("también aparece para una OA COMPLETA — no se restringe por completitud (regla nueva)", () => {
    const items = buildOrderLifecycleMenuItems({ ...baseOa, status: "COMPLETA" }, "CALIDAD");
    expect(items.some((i) => i.action === "eliminar_definitivo")).toBe(true);
  });

  it("el impacto muestra lote/producto/cliente para la confirmación", () => {
    const items = buildOrderLifecycleMenuItems(baseOa, "CALIDAD");
    const del = items.find((i) => i.action === "eliminar_definitivo");
    expect(del?.impact?.summary).toContain("G26080");
    expect(del?.impact?.summary).toContain("SERUM CAPIXYL");
    expect(del?.impact?.summary).toContain("SC BEAUTY");
  });
});
