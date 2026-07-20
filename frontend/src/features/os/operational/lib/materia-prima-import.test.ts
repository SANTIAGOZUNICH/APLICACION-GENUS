import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  getAllMateriasPrimas,
  importMateriasPrimas,
} from "../adapters/materia-prima-repository";
import {
  buildMpFromMappedRow,
  validateMpRow,
} from "./materia-prima-import";

const MP_STORAGE_KEY = "genus_os_mp_stock";

function installStorage() {
  const storage = new Map<string, string>();
  const localStorageMock = {
    getItem: (key: string) => storage.get(key) ?? null,
    setItem: (key: string, value: string) => {
      storage.set(key, value);
    },
    removeItem: (key: string) => {
      storage.delete(key);
    },
  };
  vi.stubGlobal("localStorage", localStorageMock);
  vi.stubGlobal("window", { localStorage: localStorageMock });
  return storage;
}

describe("materia-prima-import", () => {
  let storage: Map<string, string>;

  beforeEach(() => {
    storage = installStorage();
    storage.set(MP_STORAGE_KEY, "[]");
  });

  it("valida campos obligatorios, cantidad y fechas", () => {
    expect(
      validateMpRow(
        {
          codigo: "",
          nombre: "Glicerina",
          lote: "",
          cantidad: "-1",
          unidad: "",
          vencimiento: "mal",
        },
        4
      )
    ).toEqual([
      { rowIndex: 4, field: "codigo", message: "Código obligatorio." },
      { rowIndex: 4, field: "lote", message: "Lote obligatorio." },
      {
        rowIndex: 4,
        field: "cantidad",
        message: "Cantidad obligatoria, numérica y mayor o igual a 0.",
      },
      { rowIndex: 4, field: "unidad", message: "Unidad obligatoria." },
      { rowIndex: 4, field: "vencimiento", message: "Fecha vencimiento inválida." },
    ]);
  });

  it("construye input normalizado desde una fila mapeada", () => {
    const input = buildMpFromMappedRow({
      codigo: " MP-035 ",
      nombre: " Glicerina ",
      lote: " L-902 ",
      proveedor: "Proveedor",
      cantidad: "1.234,5",
      unidad: "kg",
      fechaIngreso: "20/07/2026",
      vencimiento: "08/2028",
      estadoManual: "Por vencer",
    });
    expect(input).toMatchObject({
      codigo: "MP-035",
      nombre: "Glicerina",
      lote: "L-902",
      stock: 1234.5,
      cantidad: 1234.5,
      fechaIngreso: "2026-07-20",
      vencimiento: "2028-08-31",
      estadoManual: "por_vencer",
    });
  });

  it("migra legacy stock y excluye archivados por defecto", () => {
    storage.set(
      MP_STORAGE_KEY,
      JSON.stringify([
        { id: "legacy-1", codigo: "MP-1", nombre: "Agua", lote: "L-1", stock: 10, unidad: "kg", updatedAt: "2026-07-01T00:00:00.000Z" },
        { id: "legacy-2", codigo: "MP-2", nombre: "Alcohol", lote: "L-2", cantidad: 2, unidad: "l", archived: true },
      ])
    );

    const active = getAllMateriasPrimas();
    expect(active).toHaveLength(1);
    expect(active[0]).toMatchObject({
      id: "legacy-1",
      stock: 10,
      cantidad: 10,
      proveedor: "",
      fechaIngreso: "2026-07-01",
    });
    expect(getAllMateriasPrimas({ includeArchived: true })).toHaveLength(2);
  });

  it("importa nuevos registros y actualiza duplicados por código + lote", () => {
    const first = importMateriasPrimas(
      [
        {
          codigo: "MP-1",
          nombre: "Agua",
          lote: "L-1",
          cantidad: 10,
          stock: 10,
          unidad: "kg",
        },
      ],
      "Test"
    );
    const second = importMateriasPrimas(
      [
        {
          codigo: " mp-1 ",
          nombre: "Agua actualizada",
          lote: " l-1 ",
          cantidad: 15,
          stock: 15,
          unidad: "kg",
        },
      ],
      "Test"
    );

    expect(first).toMatchObject({ imported: 1, updated: 0, duplicates: 0, errors: [] });
    expect(second).toMatchObject({ imported: 0, updated: 1, duplicates: 1, errors: [] });
    expect(getAllMateriasPrimas()).toHaveLength(1);
    expect(getAllMateriasPrimas()[0]?.stock).toBe(15);
  });
});
