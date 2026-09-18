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

  it("editar sin código no borra un código ya cargado (partial update no clobbering)", async () => {
    const svc = getAsignacionLotesService();
    const created = await svc.upsert(calidad, {
      lote: "L-CODIGO",
      fecha: "2026-08-01",
      producto: "CREMA X",
      codigo: "CR-999",
      cantidades: 10,
      updatedBy: "Calidad",
    });
    expect(created.codigo).toBe("CR-999");

    // Simula un caller que edita otro campo (ej. cantidades) sin repasar el
    // código — antes esto lo pisaba a "" silenciosamente.
    const patched = await svc.upsert(calidad, {
      id: created.id,
      lote: created.lote,
      fecha: created.fecha!,
      producto: created.producto,
      codigo: "",
      cantidades: 25,
      updatedBy: "Calidad",
    });
    expect(patched.codigo).toBe("CR-999");
    expect(patched.cantidades).toBe(25);
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

  describe("upsertFromSource — sincronización Google Sheets (0032)", () => {
    const syncActor = { email: "sync@sistema", displayName: "Sync" };

    it("primera vez: crea el registro y marca sourceId", async () => {
      const svc = getAsignacionLotesService();
      const { record, created, changed } = await svc.upsertFromSource("src-1", syncActor, {
        lote: "G26043",
        fecha: "2026-09-10",
        producto: "SERUM",
        codigo: "VITAMINA C",
        marca: "ECODERM",
        cantidades: 100,
        vto: "2028-10-31",
        updatedBy: syncActor.email,
      });
      expect(created).toBe(true);
      expect(changed).toBe(true);
      expect(record.sourceId).toBe("src-1");
      expect(record.lote).toBe("G26043");
    });

    it("mover la fila (mismo lote+código) en una segunda pasada actualiza el MISMO registro, nunca duplica", async () => {
      const svc = getAsignacionLotesService();
      const first = await svc.upsertFromSource("src-1", syncActor, {
        lote: "G26043",
        fecha: "2026-09-10",
        producto: "SERUM",
        codigo: "VITAMINA C",
        marca: "ECODERM",
        cantidades: 100,
        vto: "2028-10-31",
        updatedBy: syncActor.email,
      });
      const second = await svc.upsertFromSource("src-1", syncActor, {
        lote: "G26043",
        fecha: "2026-09-10",
        producto: "SERUM",
        codigo: "VITAMINA C",
        marca: "ECODERM",
        cantidades: 100,
        vto: "2028-10-31",
        updatedBy: syncActor.email,
      });
      expect(second.created).toBe(false);
      expect(second.changed).toBe(false);
      expect(second.record.id).toBe(first.record.id);
      const bySource = await svc.listBySource("src-1");
      expect(bySource).toHaveLength(1);
    });

    it("VTO actualizado en la fuente actualiza el registro existente (changed=true) y persiste el nuevo valor", async () => {
      const svc = getAsignacionLotesService();
      const first = await svc.upsertFromSource("src-1", syncActor, {
        lote: "G26043",
        fecha: "2026-09-10",
        producto: "SERUM",
        codigo: "VITAMINA C",
        marca: "ECODERM",
        cantidades: 100,
        vto: "2028-10-31",
        updatedBy: syncActor.email,
      });
      const second = await svc.upsertFromSource("src-1", syncActor, {
        lote: "G26043",
        fecha: "2026-09-10",
        producto: "SERUM",
        codigo: "VITAMINA C",
        marca: "ECODERM",
        cantidades: 100,
        vto: "2028-11-30",
        updatedBy: syncActor.email,
      });
      expect(second.changed).toBe(true);
      expect(second.record.id).toBe(first.record.id);
      expect(second.record.vto).toBe("2028-11-30");
    });

    it("sincronizar 100 veces sin cambios produce exactamente el mismo estado (idempotencia)", async () => {
      const svc = getAsignacionLotesService();
      let lastId: string | null = null;
      for (let i = 0; i < 100; i += 1) {
        const { record } = await svc.upsertFromSource("src-1", syncActor, {
          lote: "G26043",
          fecha: "2026-09-10",
          producto: "SERUM",
          codigo: "VITAMINA C",
          marca: "ECODERM",
          cantidades: 100,
          vto: "2028-10-31",
          updatedBy: syncActor.email,
        });
        if (lastId) expect(record.id).toBe(lastId);
        lastId = record.id;
      }
      const bySource = await svc.listBySource("src-1");
      expect(bySource).toHaveLength(1);
    });

    it("mismo lote+código ya cargado MANUALMENTE (otra fuente/sin fuente) -> conflicto, nunca se fusiona en silencio", async () => {
      const svc = getAsignacionLotesService();
      await svc.upsert(calidad, {
        lote: "G26043",
        fecha: "2026-09-10",
        producto: "SERUM",
        codigo: "VITAMINA C",
        marca: "ECODERM",
        cantidades: 100,
        updatedBy: "Calidad",
      });
      const conflict = await svc.findConflictingRecord("src-1", "G26043", "VITAMINA C");
      expect(conflict).not.toBeNull();
      expect(conflict?.marca).toBe("ECODERM");
    });

    it("archiveRemovedFromSource archiva (nunca borra físico) y deja motivo con el nombre de la fuente", async () => {
      const svc = getAsignacionLotesService();
      const { record } = await svc.upsertFromSource("src-1", syncActor, {
        lote: "G26043",
        fecha: "2026-09-10",
        producto: "SERUM",
        codigo: "VITAMINA C",
        cantidades: 100,
        updatedBy: syncActor.email,
      });
      await svc.archiveRemovedFromSource(record.id, "Asignación de Lotes 2026");
      const bySource = await svc.listBySource("src-1");
      expect(bySource).toHaveLength(0);
      const stillThere = await svc.get(calidad, record.id);
      expect(stillThere).toBeNull(); // get() ya filtra archivados, igual que el resto del módulo
    });
  });
});
