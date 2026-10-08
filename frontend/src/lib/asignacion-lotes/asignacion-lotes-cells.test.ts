import { beforeEach, describe, expect, it } from "vitest";
import {
  AsignacionCellPatchError,
  getAsignacionCellAuditMemory,
  getAsignacionLotesService,
  resetAsignacionLotesMemoryForTests,
} from "./asignacion-lotes-service";
import type { AsignacionLote } from "./types";
import { OrdersForbiddenError } from "@/lib/orders/types";

const produccion = { email: "prod@laboratoriogenus.com.ar", sector: "PRODUCCION" as const, displayName: "Producción" };
const calidad = { email: "cal@laboratoriogenus.com.ar", sector: "CALIDAD" as const, displayName: "Calidad" };
const codificado = { email: "cod@laboratoriogenus.com.ar", sector: "CODIFICADO" as const, displayName: "Codificado" };

async function seed(lote = "S26001"): Promise<AsignacionLote> {
  return getAsignacionLotesService().upsert(produccion, {
    lote,
    fecha: "2026-05-04",
    producto: "SHAMPOO VITAMIN SHOCK",
    codigo: "SH-100",
    marca: "KORIDERM",
    cantidades: 6800,
    vto: "2028-05-31",
    observaciones: "obs original",
    updatedBy: "Producción",
  });
}

async function expectRejected(promise: Promise<unknown>) {
  const err = await promise.then(
    () => null,
    (e) => e
  );
  expect(err).toBeInstanceOf(AsignacionCellPatchError);
  return (err as AsignacionCellPatchError).failures;
}

describe("AsignacionLotesService.patchCells", () => {
  beforeEach(() => {
    resetAsignacionLotesMemoryForTests();
    getAsignacionCellAuditMemory().length = 0;
  });

  it("modifica SOLO la celda editada: 6800 → 7000 no toca lote/vto/producto/marca/código", async () => {
    const before = await seed();
    const svc = getAsignacionLotesService();
    const res = await svc.patchCells(produccion, [
      { id: before.id, field: "cantidades", value: "7000", expectedVersion: before.updatedAt },
    ]);
    expect(res.changedCells).toBe(1);
    const [after] = await svc.list(produccion);
    expect(after!.cantidades).toBe(7000);
    for (const key of ["lote", "fecha", "producto", "codigo", "marca", "vto", "muestras", "cjMuestra", "fechaAnalisis", "observaciones", "createdAt", "createdBy"] as const) {
      expect(after![key]).toEqual(before[key]);
    }
    expect(after!.updatedBy).toBe("Producción");
  });

  it("no pisa con datos viejos: una edición de otra celda hecha antes sobrevive", async () => {
    const before = await seed();
    const svc = getAsignacionLotesService();
    const first = await svc.patchCells(produccion, [
      { id: before.id, field: "observaciones", value: "nueva obs", expectedVersion: before.updatedAt },
    ]);
    // Segundo editor con la versión nueva cambia otra columna: la obs sigue intacta.
    await svc.patchCells(produccion, [
      { id: before.id, field: "cantidades", value: "7000", expectedVersion: first.items[0]!.updatedAt },
    ]);
    const [row] = await svc.list(produccion);
    expect(row!.observaciones).toBe("nueva obs");
    expect(row!.cantidades).toBe(7000);
  });

  it("concurrencia: versión vieja → CONFLICT y no se escribe nada", async () => {
    const before = await seed();
    const svc = getAsignacionLotesService();
    await svc.patchCells(produccion, [
      { id: before.id, field: "cantidades", value: "7000", expectedVersion: before.updatedAt },
    ]);
    // Segundo usuario todavía tiene la versión original.
    const failures = await expectRejected(
      svc.patchCells(calidad, [
        { id: before.id, field: "cantidades", value: "9999", expectedVersion: before.updatedAt },
      ])
    );
    expect(failures[0]!.code).toBe("CONFLICT");
    expect((await svc.list(produccion))[0]!.cantidades).toBe(7000);
  });

  it("valida cantidades y fechas server-side", async () => {
    const before = await seed();
    const svc = getAsignacionLotesService();
    const f1 = await expectRejected(
      svc.patchCells(produccion, [{ id: before.id, field: "cantidades", value: "-3", expectedVersion: before.updatedAt }])
    );
    expect(f1[0]!.code).toBe("INVALID_VALUE");
    const f2 = await expectRejected(
      svc.patchCells(produccion, [{ id: before.id, field: "vto", value: "31/02/2028", expectedVersion: before.updatedAt }])
    );
    expect(f2[0]!.code).toBe("INVALID_VALUE");
  });

  it("es atómico: si una celda del pegado es inválida no se guarda ninguna", async () => {
    const a = await seed("S26001");
    const b = await seed("S26002");
    const svc = getAsignacionLotesService();
    const failures = await expectRejected(
      svc.patchCells(produccion, [
        { id: a.id, field: "cantidades", value: "100", expectedVersion: a.updatedAt },
        { id: b.id, field: "cantidades", value: "xx", expectedVersion: b.updatedAt },
      ])
    );
    expect(failures).toHaveLength(1);
    expect(failures[0]!.index).toBe(1);
    const rows = await svc.list(produccion);
    expect(rows.every((r) => r.cantidades === 6800)).toBe(true);
    expect(getAsignacionCellAuditMemory()).toHaveLength(0);
  });

  it("permisos por sector: Producción no edita muestras; Codificado solo observaciones", async () => {
    const row = await seed();
    const svc = getAsignacionLotesService();
    const f1 = await expectRejected(
      svc.patchCells(produccion, [{ id: row.id, field: "muestras", value: "3", expectedVersion: row.updatedAt }])
    );
    expect(f1[0]!.code).toBe("FORBIDDEN_FIELD");
    const f2 = await expectRejected(
      svc.patchCells(codificado, [{ id: row.id, field: "cantidades", value: "1", expectedVersion: row.updatedAt }])
    );
    expect(f2[0]!.code).toBe("FORBIDDEN_FIELD");
    const ok = await svc.patchCells(codificado, [
      { id: row.id, field: "observaciones", value: "codificado ok", expectedVersion: row.updatedAt },
    ]);
    expect(ok.changedCells).toBe(1);
    await svc.patchCells(calidad, [
      { id: row.id, field: "muestras", value: "3", expectedVersion: ok.items[0]!.updatedAt },
    ]);
  });

  it("sector sin acceso al módulo no puede mutar", async () => {
    const row = await seed();
    await expect(
      getAsignacionLotesService().patchCells(
        { email: "x@x.com", sector: "ELABORACION", displayName: "E" },
        [{ id: row.id, field: "cantidades", value: "1", expectedVersion: row.updatedAt }]
      )
    ).rejects.toThrow(OrdersForbiddenError);
  });

  it("registro sincronizado desde Google Sheets: protegido (PROTECTED_SOURCE) para cualquier sector", async () => {
    const svc = getAsignacionLotesService();
    const { record } = await svc.upsertFromSource(
      "src-google-1",
      { email: "sync@genus", displayName: "Sync" },
      { lote: "G26042", fecha: "2026-08-03", producto: "CREMA FACIAL", codigo: "", cantidades: 500, updatedBy: "Sync" },
      "AGOSTO 2026"
    );
    for (const actor of [produccion, calidad]) {
      const failures = await expectRejected(
        svc.patchCells(actor, [{ id: record.id, field: "observaciones", value: "local", expectedVersion: record.updatedAt }])
      );
      expect(failures[0]!.code).toBe("PROTECTED_SOURCE");
    }
    expect((await svc.list(produccion))[0]!.observaciones).toBe("");
  });

  it("sync de Google NO pisa ediciones locales de registros manuales (misma identidad lote/código/producto)", async () => {
    const svc = getAsignacionLotesService();
    const manual = await seed("S26001");
    await svc.patchCells(produccion, [
      { id: manual.id, field: "cantidades", value: "7000", expectedVersion: manual.updatedAt },
    ]);
    // El sync trae la misma identidad con otra cantidad: conflicto de fuentes, el registro manual no se toca.
    const conflict = await svc.findConflictingRecord("src-google-1", "S26001", "SH-100", "SHAMPOO VITAMIN SHOCK");
    expect(conflict?.id).toBe(manual.id);
    // upsertFromSource solo opera dentro de su propia fuente: nunca adopta/pisa el manual.
    const { record, created } = await svc.upsertFromSource(
      "src-google-1",
      { email: "sync@genus", displayName: "Sync" },
      { lote: "OTRO", fecha: "2026-05-04", producto: "OTRO PRODUCTO", codigo: "X", cantidades: 1, updatedBy: "Sync" },
      "MAYO 2026"
    );
    expect(created).toBe(true);
    expect(record.id).not.toBe(manual.id);
    const rows = await svc.list(produccion);
    expect(rows.find((r) => r.id === manual.id)!.cantidades).toBe(7000);
  });

  it("identidad: no permite duplicar (lote, código, producto) de otro registro ni dentro del mismo pegado", async () => {
    const a = await seed("S26001");
    const b = await seed("S26002");
    const svc = getAsignacionLotesService();
    const f1 = await expectRejected(
      svc.patchCells(produccion, [{ id: b.id, field: "lote", value: "s26001", expectedVersion: b.updatedAt }])
    );
    expect(f1[0]!.code).toBe("DUPLICATE");
    const c = await seed("S26003");
    const f2 = await expectRejected(
      svc.patchCells(produccion, [
        { id: b.id, field: "lote", value: "NUEVO", expectedVersion: b.updatedAt },
        { id: c.id, field: "lote", value: "NUEVO", expectedVersion: c.updatedAt },
      ])
    );
    expect(f2.some((f) => f.code === "DUPLICATE")).toBe(true);
    expect(a.lote).toBe("S26001");
  });

  it("no permite vaciar lote o producto", async () => {
    const row = await seed();
    const failures = await expectRejected(
      getAsignacionLotesService().patchCells(produccion, [
        { id: row.id, field: "producto", value: "", expectedVersion: row.updatedAt },
      ])
    );
    expect(failures[0]!.code).toBe("INVALID_VALUE");
  });

  it("audita usuario, registro, campo, valor anterior y nuevo", async () => {
    const row = await seed();
    await getAsignacionLotesService().patchCells(produccion, [
      { id: row.id, field: "cantidades", value: "7.000", expectedVersion: row.updatedAt },
    ]);
    const audit = getAsignacionCellAuditMemory();
    expect(audit).toHaveLength(1);
    expect(audit[0]).toMatchObject({
      recordId: row.id,
      lote: "S26001",
      field: "cantidades",
      oldValue: "6800",
      newValue: "7000",
      actorEmail: produccion.email,
      actorSector: "PRODUCCION",
    });
  });

  it("mismo valor = sin cambios, sin escritura ni auditoría", async () => {
    const row = await seed();
    const res = await getAsignacionLotesService().patchCells(produccion, [
      { id: row.id, field: "cantidades", value: "6800", expectedVersion: row.updatedAt },
    ]);
    expect(res.changedCells).toBe(0);
    expect(res.unchangedCells).toBe(1);
    expect(getAsignacionCellAuditMemory()).toHaveLength(0);
  });

  it("1000+ filas: pegado masivo de una columna en una sola operación atómica", async () => {
    const svc = getAsignacionLotesService();
    const rows: AsignacionLote[] = [];
    for (let i = 0; i < 1200; i += 1) {
      rows.push(
        await svc.upsert(produccion, {
          lote: `L${String(i).padStart(5, "0")}`,
          fecha: "2026-05-04",
          producto: `PROD ${i}`,
          codigo: `C${i}`,
          cantidades: i,
          updatedBy: "Producción",
        })
      );
    }
    const t0 = Date.now();
    const res = await svc.patchCells(
      produccion,
      rows.slice(0, 1100).map((r) => ({ id: r.id, field: "cantidades" as const, value: "5000", expectedVersion: r.updatedAt }))
    );
    expect(res.changedCells).toBe(1100);
    expect(Date.now() - t0).toBeLessThan(5000);
    const listed = await svc.list(produccion);
    expect(listed.filter((r) => r.cantidades === 5000)).toHaveLength(1100);
    expect(getAsignacionCellAuditMemory()).toHaveLength(1100);
  });
});

describe("modal clásico (upsert) respeta la misma política que la grilla", () => {
  beforeEach(() => resetAsignacionLotesMemoryForTests());

  it("Codificado no puede cambiar cantidades por el modal; sí observaciones", async () => {
    const svc = getAsignacionLotesService();
    const row = await seed();
    const base = { id: row.id, lote: row.lote, fecha: row.fecha, producto: row.producto, codigo: row.codigo, marca: row.marca, cantidades: row.cantidades, vto: row.vto, updatedBy: "Cod" };
    await expect(svc.upsert(codificado, { ...base, cantidades: 1 })).rejects.toThrow(OrdersForbiddenError);
    await expect(svc.upsert(codificado, { ...base, observaciones: "ok" })).resolves.toBeTruthy();
  });

  it("registro sincronizado desde Google no se edita por el modal", async () => {
    const svc = getAsignacionLotesService();
    const { record } = await svc.upsertFromSource(
      "src-9",
      { email: "s", displayName: "S" },
      { lote: "G9", fecha: "2026-08-01", producto: "X", codigo: "", cantidades: 5, updatedBy: "S" },
      "AGO"
    );
    await expect(
      svc.upsert(produccion, { id: record.id, lote: "G9", fecha: "2026-08-01", producto: "X", codigo: "", cantidades: 6, updatedBy: "P" })
    ).rejects.toThrow(OrdersForbiddenError);
  });
});
