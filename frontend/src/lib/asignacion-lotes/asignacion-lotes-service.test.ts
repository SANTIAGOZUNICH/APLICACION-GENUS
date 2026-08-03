import { describe, expect, it, beforeEach } from "vitest";
import {
  getAsignacionLotesService,
  resetAsignacionLotesMemoryForTests,
} from "@/lib/asignacion-lotes/asignacion-lotes-service";
import { OrdersForbiddenError } from "@/lib/orders/types";

describe("AsignacionLotesService", () => {
  beforeEach(() => {
    resetAsignacionLotesMemoryForTests();
  });

  const calidad = {
    email: "calidad@laboratoriogenus.com.ar",
    sector: "CALIDAD" as const,
    displayName: "Calidad",
  };

  const elaboracion = {
    email: "elaboracion@laboratoriogenus.com.ar",
    sector: "ELABORACION" as const,
    displayName: "Elaboración",
  };

  it("upsert y list para sector autorizado", () => {
    const svc = getAsignacionLotesService();
    const item = svc.upsert(calidad, {
      lote: "L-001",
      fecha: "2026-07-28",
      producto: "Creamy",
      codigo: "CR-100",
      cantidades: 500,
      updatedBy: "Calidad",
    });
    expect(item.lote).toBe("L-001");
    const listed = svc.list(calidad);
    expect(listed.some((row) => row.id === item.id)).toBe(true);
  });

  it("rechaza mutación de sector no autorizado", () => {
    const svc = getAsignacionLotesService();
    expect(() =>
      svc.upsert(elaboracion, {
        lote: "L-X",
        fecha: "2026-07-28",
        producto: "X",
        codigo: "X-1",
        cantidades: 1,
        updatedBy: "Elab",
      })
    ).toThrow(OrdersForbiddenError);
  });

  it("archive y restore", () => {
    const svc = getAsignacionLotesService();
    const item = svc.upsert(calidad, {
      lote: "L-ARC",
      fecha: "2026-07-28",
      producto: "Shampoo",
      codigo: "SH-1",
      cantidades: 10,
      updatedBy: "Calidad",
    });
    const archived = svc.archive(calidad, item.id);
    expect(archived.archived).toBe(true);
    expect(svc.list(calidad).some((row) => row.id === item.id)).toBe(false);
    const restored = svc.restore(calidad, item.id);
    expect(restored.archived).toBe(false);
  });
});
