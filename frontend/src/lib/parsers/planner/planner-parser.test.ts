import { describe, expect, it } from "vitest";
import { createWorkItemRegistry } from "@/lib/domain/work-item/work-item-registry";
import { projectDomainWorkItems } from "@/lib/domain/work-item/work-item-projector";
import {
  SEMANAS_COLUMNAR_ELABORACION,
  SEMANAS_COLUMNAR_ENVASADO,
} from "@/lib/parsers/__fixtures__/planner-columnar.fixture";
import { parsePlannerTab } from "@/lib/parsers/planner/planner-parser";

describe("PlannerParser columnar", () => {
  it("detecta ramas Cristian y Nicolás en elaboración", () => {
    const registry = createWorkItemRegistry();
    const parsed = parsePlannerTab({
      fileId: "test-semanas",
      tab: "ELABORACION",
      rows: SEMANAS_COLUMNAR_ELABORACION,
      registry,
    });

    expect(parsed.itemsCreated).toBeGreaterThan(0);
    expect(registry.list().length).toBeGreaterThan(0);

    const items = projectDomainWorkItems(registry.list());
    const cristian = items.filter((i) => i.ownerPerson === "Cristian");
    const nicolas = items.filter((i) => i.ownerPerson === "Nicolás");

    expect(cristian.length).toBeGreaterThan(0);
    expect(nicolas.length).toBeGreaterThan(0);
    expect(cristian.some((i) => i.product?.includes("SERUM"))).toBe(true);
  });

  it("detecta sector, línea y trabajos en acondicionamiento", () => {
    const registry = createWorkItemRegistry();
    parsePlannerTab({
      fileId: "test-semanas",
      tab: "ACONDICIONAMIENTO",
      rows: SEMANAS_COLUMNAR_ENVASADO,
      registry,
    });

    const items = projectDomainWorkItems(registry.list());
    const masivo = items.filter((i) => i.sector === "ENVASADO_MASIVO");
    const premium = items.filter((i) => i.sector === "ENVASADO_PREMIUM");

    expect(masivo.length).toBeGreaterThan(0);
    expect(premium.length).toBeGreaterThan(0);
    expect(masivo.every((i) => i.line === "Línea 1")).toBe(true);
    expect(premium.every((i) => i.line === "Línea 1")).toBe(true);
  });
});
