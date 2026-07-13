import { describe, expect, it } from "vitest";
import { createWorkItemRegistry } from "@/lib/domain/work-item/work-item-registry";
import { workItemAssembler } from "@/lib/domain/work-item/work-item-assembler";
import { projectDomainWorkItems } from "@/lib/domain/work-item/work-item-projector";
import {
  SEMANAS_COLUMNAR_ELABORACION,
  SEMANAS_COLUMNAR_ENVASADO,
  SEMANAS_COLUMNAR_ENVASADO_L_GRID,
} from "@/lib/parsers/__fixtures__/planner-columnar.fixture";
import { parsePlannerTab } from "@/lib/parsers/planner/planner-parser";

describe("PlannerParser columnar", () => {
  it("detecta ramas Cristian y Nicolás en elaboración", () => {
    const registry = createWorkItemRegistry();
    const assembler = workItemAssembler;
    const parsed = parsePlannerTab({
      fileId: "test-semanas",
      tab: "ELABORACION",
      rows: SEMANAS_COLUMNAR_ELABORACION,
      registry,
      assembler,
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

  it("distingue sourceRange (slot) de quantitySourceRange y productSourceRange", () => {
    const rows: string[][] = [
      ["", "Lunes", "", "Martes"],
      ["", "16", "", "17"],
      ["", "Febrero", "", "Febrero"],
      ["", "NICOLAS"],
      ["", "NIZA", "", ""],
      ["", "PROBIOTONIC BALANCE", "", ""],
      ["", "160KG", "", ""],
      [],
      ["", "SIGUIENTE RAMA"],
    ];

    const registry = createWorkItemRegistry();
    parsePlannerTab({
      fileId: "test-semanas",
      tab: "ELABORACION",
      rows,
      registry,
      assembler: workItemAssembler,
    });

    const item = projectDomainWorkItems(registry.list()).find(
      (i) => i.product === "PROBIOTONIC BALANCE"
    );

    expect(item).toBeDefined();
    expect(item?.sourceRange).toBe("ELABORACION!8:2");
    expect(item?.quantitySourceRange).toBe("ELABORACION!7:2");
    expect(item?.productSourceRange).toBe("ELABORACION!6:2");
    expect(item?.quantity).toBe("160KG");
  });

  it("detecta sector, línea y trabajos en acondicionamiento", () => {
    const registry = createWorkItemRegistry();
    parsePlannerTab({
      fileId: "test-semanas",
      tab: "ACONDICIONAMIENTO",
      rows: SEMANAS_COLUMNAR_ENVASADO,
      registry,
      assembler: workItemAssembler,
    });

    const items = projectDomainWorkItems(registry.list());
    const masivo = items.filter((i) => i.sector === "ENVASADO_MASIVO");
    const premium = items.filter((i) => i.sector === "ENVASADO_PREMIUM");

    expect(masivo.length).toBeGreaterThan(0);
    expect(premium.length).toBeGreaterThan(0);
    expect(masivo.some((i) => i.line === "Línea 1")).toBe(true);
    expect(premium.some((i) => i.line === "Línea 2")).toBe(true);
  });

  it("detecta L1/L2/L3 con geometría columnar C/E/G/I/K", () => {
    const registry = createWorkItemRegistry();
    parsePlannerTab({
      fileId: "test-semanas",
      tab: "ACONDICIONAMIENTO",
      rows: SEMANAS_COLUMNAR_ENVASADO_L_GRID,
      registry,
      assembler: workItemAssembler,
    });

    const items = projectDomainWorkItems(registry.list());
    const masivo = items.filter((i) => i.sector === "ENVASADO_MASIVO");

    expect(masivo.length).toBeGreaterThan(0);
    expect(masivo.every((i) => i.line === "Línea 1" || i.line === "Línea 2")).toBe(true);
    expect(masivo.some((i) => i.line === "Línea 1")).toBe(true);
    expect(masivo.some((i) => i.line === "Línea 2")).toBe(true);
  });
});
