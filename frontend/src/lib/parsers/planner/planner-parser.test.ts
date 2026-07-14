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

  it("resuelve plannedDate ISO desde encabezado mes/día", () => {
    const rows: string[][] = [
      ["", "Lunes", "", "Martes", "", "Miércoles", "", "Jueves", "", "Viernes"],
      ["", "13", "", "14", "", "15", "", "16", "", "17"],
      ["", "Julio", "", "Julio", "", "Julio", "", "Julio", "", "Julio"],
      ["", "NICOLAS"],
      ["", "NIZA", "", "", "", "", "", "", "", ""],
      ["", "PROBIOTONIC BALANCE", "", "", "", "", "", "", "", ""],
      ["", "160KG", "", "", "", "", "", "", "", ""],
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

    expect(item?.plannedDate).toBe("2026-07-13");
    expect(item?.weekStart).toBe("2026-07-13");
    expect(item?.dayOfWeek).toBe("Lunes");
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

  it("resuelve encabezados humanos vivos: martes 14 julio → Hoy", () => {
    const rows: string[][] = [
      [
        "",
        "lunes 13 julio",
        "",
        "martes 14 julio",
        "",
        "miércoles 15 julio",
        "",
        "jueves 16 julio",
        "",
        "viernes 17 julio",
      ],
      ["", "CRISTIAN"],
      ["", "CAV", "", "THE CHEMIST LOOK", "", "NATCEUTICALS"],
      ["", "SHAMPOO BIONIC", "", "2ND SKIN", "", "EMULSION"],
      ["", "400KG", "", "27KG", "", "110KG"],
      [],
      ["", "NICOLAS"],
      ["", "", "", "DOTS", "", ""],
      ["", "", "", "BERRY FIZZ", "", ""],
      ["", "", "", "19LT", "", ""],
    ];

    const registry = createWorkItemRegistry();
    parsePlannerTab({
      fileId: "test-semanas",
      tab: "ELABORACION",
      rows,
      registry,
      assembler: workItemAssembler,
    });

    const items = projectDomainWorkItems(registry.list());
    const hoy = items.filter((i) => i.plannedDate === "2026-07-14");
    expect(hoy.length).toBeGreaterThanOrEqual(2);
    expect(hoy.every((i) => i.dayOfWeek === "Martes")).toBe(true);
    expect(hoy.every((i) => i.weekStart === "2026-07-13")).toBe(true);
    expect(hoy.some((i) => i.ownerPerson === "Cristian")).toBe(true);
    expect(hoy.some((i) => i.ownerPerson === "Nicolás")).toBe(true);
    expect(hoy[0]?.dateResolutionMethod).toMatch(/human_header|inherited/);
    expect(hoy[0]?.dateHeaderSourceRange).toMatch(/ELABORACION!D1/);
  });

  it("asigna fecha por columna (no una sola fecha a toda la fila)", () => {
    const rows: string[][] = [
      [
        "",
        "lunes 13 julio",
        "",
        "martes 14 julio",
        "",
        "miércoles 15 julio",
      ],
      ["", "CRISTIAN"],
      ["", "CLIENTE L", "", "CLIENTE M", "", "CLIENTE X"],
      ["", "PROD L", "", "PROD M", "", "PROD X"],
      ["", "10KG", "", "20KG", "", "30KG"],
    ];

    const registry = createWorkItemRegistry();
    parsePlannerTab({
      fileId: "test-semanas",
      tab: "ELABORACION",
      rows,
      registry,
      assembler: workItemAssembler,
    });

    const items = projectDomainWorkItems(registry.list());
    expect(items.find((i) => i.product === "PROD L")?.plannedDate).toBe("2026-07-13");
    expect(items.find((i) => i.product === "PROD M")?.plannedDate).toBe("2026-07-14");
    expect(items.find((i) => i.product === "PROD X")?.plannedDate).toBe("2026-07-15");
  });

  it("split header con cambio de mes (30 marzo → 1 abril)", () => {
    const rows: string[][] = [
      ["", "Lunes", "", "Martes", "", "Miércoles", "", "Jueves", "", "Viernes"],
      ["", "30", "", "31", "", "1", "", "2", "", "3"],
      ["", "Marzo", "", "Marzo", "", "Abril", "", "Abril", "", "Abril"],
      ["", "CRISTIAN"],
      ["", "A", "", "B", "", "C", "", "D", "", "E"],
      ["", "PA", "", "PB", "", "PC", "", "PD", "", "PE"],
      ["", "1KG", "", "2KG", "", "3KG", "", "4KG", "", "5KG"],
    ];

    const registry = createWorkItemRegistry();
    parsePlannerTab({
      fileId: "test-semanas",
      tab: "ELABORACION",
      rows,
      registry,
      assembler: workItemAssembler,
    });

    const items = projectDomainWorkItems(registry.list());
    expect(items.find((i) => i.product === "PA")?.plannedDate).toBe("2026-03-30");
    expect(items.find((i) => i.product === "PB")?.plannedDate).toBe("2026-03-31");
    expect(items.find((i) => i.product === "PC")?.plannedDate).toBe("2026-04-01");
    expect(items.find((i) => i.product === "PE")?.weekStart).toBe("2026-03-30");
  });

  it("envasado moderno C/E/G/I/K con encabezado humano", () => {
    // Geometría viva: fechas en C/E/G/I/K; L1 en B; clientes/productos en mismas cols de día.
    const rows: string[][] = [
      [
        "",
        "",
        "lunes 13 julio",
        "",
        "martes 14 julio",
        "",
        "miércoles 15 julio",
        "",
        "jueves 16 julio",
        "",
        "viernes 17 julio",
      ],
      ["", "ENVASADO CONSUMO MASIVO | 3 LINEAS DE PRODUCCION"],
      ["", "L1", "CAV", "", "ICONO", "", "BL", "", "TYL", "", "JACTANS"],
      ["", "", "SH BIONIC", "", "MASCARA", "", "ALISADO", "", "ACEITE", "", "PERFUME"],
      ["", "", "400x400", "", "1000u", "", "900KG", "", "130KG", "", "80LT"],
    ];

    const registry = createWorkItemRegistry();
    parsePlannerTab({
      fileId: "test-semanas",
      tab: "ACONDICIONAMIENTO",
      rows,
      registry,
      assembler: workItemAssembler,
    });

    const items = projectDomainWorkItems(registry.list());
    const hoy = items.filter((i) => i.plannedDate === "2026-07-14");
    expect(hoy.length).toBeGreaterThanOrEqual(1);
    expect(hoy.every((i) => i.sector === "ENVASADO_MASIVO")).toBe(true);
    expect(hoy.every((i) => i.line === "Línea 1")).toBe(true);
  });
});
