import { describe, expect, it, beforeEach } from "vitest";
import {
  getAsignacionLotesService,
  resetAsignacionLotesMemoryForTests,
} from "@/lib/asignacion-lotes/asignacion-lotes-service";
import { OrdersForbiddenError, OrdersNotFoundError, OrdersValidationError } from "@/lib/orders/types";

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

  it("upsert y list para sector autorizado", async () => {
    const svc = getAsignacionLotesService();
    const item = await svc.upsert(calidad, {
      lote: "L-001",
      fecha: "2026-07-28",
      producto: "Creamy",
      codigo: "CR-100",
      cantidades: 500,
      updatedBy: "Calidad",
    });
    expect(item.lote).toBe("L-001");
    const listed = await svc.list(calidad);
    expect(listed.some((row) => row.id === item.id)).toBe(true);
  });

  it("rechaza mutación de sector no autorizado", async () => {
    const svc = getAsignacionLotesService();
    await expect(
      svc.upsert(elaboracion, {
        lote: "L-X",
        fecha: "2026-07-28",
        producto: "X",
        codigo: "X-1",
        cantidades: 1,
        updatedBy: "Elab",
      })
    ).rejects.toThrow(OrdersForbiddenError);
  });

  it("delete elimina de listado activo", async () => {
    const svc = getAsignacionLotesService();
    const item = await svc.upsert(calidad, {
      lote: "L-DEL",
      fecha: "2026-07-28",
      producto: "Shampoo",
      codigo: "SH-1",
      cantidades: 10,
      updatedBy: "Calidad",
    });
    await svc.delete(calidad, item.id, "Prueba");
    expect(await svc.get(calidad, item.id)).toBeNull();
    expect((await svc.list(calidad)).some((row) => row.id === item.id)).toBe(false);
  });

  it("delete lanza NotFound si no existe", async () => {
    const svc = getAsignacionLotesService();
    await expect(svc.delete(calidad, "missing-id")).rejects.toThrow(OrdersNotFoundError);
  });

  it("restore filas archivadas legacy", async () => {
    const svc = getAsignacionLotesService();
    const item = await svc.upsert(calidad, {
      lote: "L-ARC",
      fecha: "2026-07-28",
      producto: "Shampoo",
      codigo: "SH-ARC",
      cantidades: 10,
      updatedBy: "Calidad",
      archived: true,
    });
    expect((await svc.list(calidad)).some((row) => row.id === item.id)).toBe(false);
    const restored = await svc.restore(calidad, item.id);
    expect(restored.archived).toBe(false);
    expect((await svc.list(calidad)).some((row) => row.id === item.id)).toBe(true);
  });

  it("importa filas con código vacío sin copiar producto", async () => {
    const svc = getAsignacionLotesService();
    const result = await svc.import(calidad, [
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
    const listed = await svc.list(calidad);
    const empty = listed.find((row) => row.lote === "L-EMPTY")!;
    const qsoft = listed.find((row) => row.lote === "L-QSOFT")!;
    const zeros = listed.find((row) => row.lote === "L-ZERO")!;
    expect(empty.codigo).toBe("");
    expect(empty.producto).toBe("OLEO CALCAREO");
    expect(qsoft.codigo).toBe("QSOFT");
    expect(zeros.codigo).toBe("000125-A");

    const reloaded = (await svc.get(calidad, empty.id))!;
    expect(reloaded.codigo).toBe("");
    const patched = await svc.upsert(calidad, {
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

  describe("carga flexible desde Excel (import) — celdas vacías permitidas", () => {
    it("importa una fila con lote/fecha/cantidades vacíos — no la rechaza ni inventa datos", async () => {
      const svc = getAsignacionLotesService();
      const result = await svc.import(calidad, [
        {
          lote: "",
          fecha: null,
          producto: "Producto A",
          codigo: "",
          cantidades: 0,
          updatedBy: "Calidad",
        },
      ]);
      expect(result.imported).toBe(1);
      expect(result.skipped).toBe(0);
      expect(result.errors).toEqual([]);
      const listed = await svc.list(calidad);
      const row = listed.find((r) => r.producto === "Producto A")!;
      expect(row).toBeDefined();
      expect(row.lote).toBe("");
      expect(row.fecha).toBeNull();
      expect(row.cantidades).toBe(0);
    });

    it("caso obligatorio: filas mixtas (completa/parcial/vacía) importan todas, ninguna bloquea a las demás", async () => {
      const svc = getAsignacionLotesService();
      const result = await svc.import(calidad, [
        {
          lote: "",
          fecha: null,
          producto: "Shampoo X",
          codigo: "SH-001",
          cantidades: 1000,
          updatedBy: "Calidad",
        },
        {
          lote: "L-100",
          fecha: null,
          producto: "Crema Y",
          codigo: "",
          cantidades: 500,
          updatedBy: "Calidad",
        },
        {
          lote: "",
          fecha: null,
          producto: "Serum Z",
          codigo: "SZ-200",
          cantidades: 0,
          vto: "2027-12-01",
          updatedBy: "Calidad",
        },
      ]);
      expect(result.imported).toBe(3);
      expect(result.skipped).toBe(0);
      expect(result.errors).toEqual([]);
    });

    it("fecha con formato inválido SÍ se rechaza (no es una celda vacía, es un dato corrupto)", async () => {
      const svc = getAsignacionLotesService();
      const result = await svc.import(calidad, [
        {
          lote: "L-BAD",
          fecha: "no-es-fecha",
          producto: "X",
          codigo: "",
          cantidades: 1,
          updatedBy: "Calidad",
        },
      ]);
      expect(result.imported).toBe(0);
      expect(result.skipped).toBe(1);
      expect(result.errors).toEqual([{ rowIndex: 1, field: "fecha", message: "Fecha inválida." }]);
    });

    it("el alta MANUAL (upsert, no import) sigue exigiendo lote/fecha/producto — la flexibilización es solo para import masivo", async () => {
      const svc = getAsignacionLotesService();
      await expect(
        svc.upsert(calidad, {
          lote: "",
          fecha: null,
          producto: "X",
          codigo: "",
          cantidades: 1,
          updatedBy: "Calidad",
        })
      ).rejects.toThrow(OrdersValidationError);
    });
  });
});
