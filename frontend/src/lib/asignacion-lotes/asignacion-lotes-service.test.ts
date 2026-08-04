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

  it("importa filas con código vacío sin copiar producto", () => {
    const svc = getAsignacionLotesService();
    const result = svc.import(calidad, [
      {
        lote: "L-EMPTY",
        fecha: "2026-08-01",
        producto: "OLEO CALCAREO",
        codigo: "",
        cantidades: 1,
        updatedBy: "Calidad",
      },
      {
        lote: "L-QSOFT",
        fecha: "2026-08-01",
        producto: "OLEO CALCAREO",
        codigo: "QSOFT",
        cantidades: 2,
        updatedBy: "Calidad",
      },
      {
        lote: "L-ZERO",
        fecha: "2026-08-01",
        producto: "CREMA FACIAL",
        codigo: "000125-A",
        cantidades: 3,
        updatedBy: "Calidad",
      },
    ]);
    expect(result.imported).toBe(3);
    expect(result.errors).toEqual([]);
    const listed = svc.list(calidad);
    const empty = listed.find((row) => row.lote === "L-EMPTY")!;
    const qsoft = listed.find((row) => row.lote === "L-QSOFT")!;
    const zeros = listed.find((row) => row.lote === "L-ZERO")!;
    expect(empty.codigo).toBe("");
    expect(empty.producto).toBe("OLEO CALCAREO");
    expect(qsoft.codigo).toBe("QSOFT");
    expect(zeros.codigo).toBe("000125-A");

    const reloaded = svc.get(calidad, empty.id)!;
    expect(reloaded.codigo).toBe("");
    const patched = svc.upsert(calidad, {
      id: empty.id,
      lote: empty.lote,
      fecha: empty.fecha,
      producto: empty.producto,
      codigo: empty.codigo,
      cantidades: 9,
      marca: "Genus",
      updatedBy: "Calidad",
    });
    expect(patched.codigo).toBe("");
    expect(patched.cantidades).toBe(9);
    expect(patched.marca).toBe("Genus");
  });
});
