import { describe, expect, it } from "vitest";
import { applySort } from "@/lib/sorting/sort-contract";
import type { MpCompraRow, MpIngresoRow, MpStockRow } from "@/lib/inventory/types";
import { MP_COMPRA_SORT_OPTIONS, MP_INGRESO_SORT_OPTIONS, MP_ORDEN_CARGA_KEY, MP_STOCK_SORT_OPTIONS } from "./mp-hub-view";

/**
 * AUDIT_ORDENAMIENTO_GLOBAL — Stock/Ingresos MP/Compras MP en MpHubView no
 * tenían ORDER BY en ningún punto del stack (ni SQL ni JS) — orden de
 * inserción sin control de usuario. Ahora cada tab tiene su propio set de
 * opciones (columnas distintas), incluyendo VTO más próximo en Stock/
 * Ingresos, pese a nunca haber existido antes.
 */
function stockRow(overrides: Partial<MpStockRow>): MpStockRow {
  return {
    id: overrides.id ?? "id",
    proveedor: "",
    cliente: "",
    descripcion: "",
    cantidadKg: null,
    ubicacion: "",
    lote: "",
    vencimiento: "",
    estadoStock: "",
    diasAlVence: null,
    estadoVencimiento: "",
    origen: "",
    codigo: "C",
    productosAsociados: "",
    createdBy: "test@genus",
    updatedBy: "test@genus",
    createdAt: "2026-08-03T12:00:00.000Z",
    updatedAt: "2026-08-03T12:00:00.000Z",
    ...overrides,
  };
}

function ingresoRow(overrides: Partial<MpIngresoRow>): MpIngresoRow {
  return {
    id: overrides.id ?? "id",
    fecha: "2026-08-03",
    ingresoNro: "1",
    proveedor: "",
    cliente: "",
    remitoNro: "",
    codigo: "C",
    producto: "",
    descripcion: "",
    bultos: null,
    cantidad: null,
    total: null,
    ubicacion: "",
    lote: "",
    vencimiento: "",
    stockLotId: null,
    status: "CONFIRMADO",
    stockImpacted: true,
    createdBy: "test@genus",
    updatedBy: "test@genus",
    createdAt: "2026-08-03T12:00:00.000Z",
    updatedAt: "2026-08-03T12:00:00.000Z",
    ...overrides,
  };
}

function compraRow(overrides: Partial<MpCompraRow>): MpCompraRow {
  return {
    id: overrides.id ?? "id",
    fecha: "2026-08-03",
    materiaPrima: "",
    cantidad: null,
    unidad: "",
    proveedor: "",
    fechaEntrega: "",
    produccionesAfecta: "",
    estado: "",
    nota: "",
    linkedIngresoId: null,
    createdBy: "test@genus",
    updatedBy: "test@genus",
    createdAt: "2026-08-03T12:00:00.000Z",
    updatedAt: "2026-08-03T12:00:00.000Z",
    ...overrides,
  };
}

describe("mp-hub-view — MP_STOCK_SORT_OPTIONS", () => {
  it("vto_asc: vencimiento más próximo primero (nuevo — no existía)", () => {
    const rows = [
      stockRow({ id: "a", vencimiento: "2099-01-01" }),
      stockRow({ id: "b", vencimiento: "" }),
      stockRow({ id: "c", vencimiento: "2098-06-01" }),
    ];
    expect(applySort(rows, MP_STOCK_SORT_OPTIONS, "vto_asc").map((r) => r.id)).toEqual(["c", "a", "b"]);
  });

  it("cantidad_desc/asc son numéricas", () => {
    const rows = [
      stockRow({ id: "a", cantidadKg: 100 }),
      stockRow({ id: "b", cantidadKg: 9 }),
      stockRow({ id: "c", cantidadKg: 2000 }),
    ];
    expect(applySort(rows, MP_STOCK_SORT_OPTIONS, "cantidad_asc").map((r) => r.cantidadKg)).toEqual([
      9, 100, 2000,
    ]);
  });

  it("codigo_asc (default) ordena A-Z", () => {
    const rows = [stockRow({ id: "a", codigo: "Z" }), stockRow({ id: "b", codigo: "A" })];
    expect(applySort(rows, MP_STOCK_SORT_OPTIONS, "codigo_asc").map((r) => r.id)).toEqual(["b", "a"]);
  });
});

describe("mp-hub-view — MP_INGRESO_SORT_OPTIONS", () => {
  it("fecha_desc (default) = más recientes primero", () => {
    const rows = [
      ingresoRow({ id: "a", fecha: "2026-08-10" }),
      ingresoRow({ id: "b", fecha: "2026-01-01" }),
      ingresoRow({ id: "c", fecha: "2026-12-31" }),
    ];
    expect(applySort(rows, MP_INGRESO_SORT_OPTIONS, "fecha_desc").map((r) => r.id)).toEqual(["c", "a", "b"]);
  });

  it("total_desc/asc son numéricos", () => {
    const rows = [
      ingresoRow({ id: "a", total: 100 }),
      ingresoRow({ id: "b", total: 9 }),
      ingresoRow({ id: "c", total: 2000 }),
    ];
    expect(applySort(rows, MP_INGRESO_SORT_OPTIONS, "total_asc").map((r) => r.total)).toEqual([9, 100, 2000]);
  });
});

describe("mp-hub-view — MP_COMPRA_SORT_OPTIONS", () => {
  it("entrega_asc: fecha de entrega más próxima primero", () => {
    const rows = [
      compraRow({ id: "a", fechaEntrega: "2099-01-01" }),
      compraRow({ id: "b", fechaEntrega: "" }),
      compraRow({ id: "c", fechaEntrega: "2098-06-01" }),
    ];
    expect(applySort(rows, MP_COMPRA_SORT_OPTIONS, "entrega_asc").map((r) => r.id)).toEqual(["c", "a", "b"]);
  });

  it("cantidad_desc/asc son numéricas", () => {
    const rows = [
      compraRow({ id: "a", cantidad: 100 }),
      compraRow({ id: "b", cantidad: 9 }),
    ];
    expect(applySort(rows, MP_COMPRA_SORT_OPTIONS, "cantidad_asc").map((r) => r.id)).toEqual(["b", "a"]);
  });
});

describe("hoja única de Materias Primas: orden de carga por defecto", () => {
  const stock = ["Glicerina", "Ácido hialurónico", "Fragancia", "Alcohol cetílico", "Vitamina E"].map((descripcion, i) =>
    stockRow({ id: `s${i}`, descripcion, codigo: `C${5 - i}`, cantidadKg: 100 - i })
  );
  const ids = ["s0", "s1", "s2", "s3", "s4"];

  it("la primera opción de cada hoja es el orden de carga y NO reordena (ni por nombre, código, cantidad ni fecha)", () => {
    for (const options of [MP_STOCK_SORT_OPTIONS, MP_INGRESO_SORT_OPTIONS, MP_COMPRA_SORT_OPTIONS] as Array<readonly { key: string; label: string }[]>) {
      expect(options[0]!.key).toBe(MP_ORDEN_CARGA_KEY);
      expect(options[0]!.label).toMatch(/Orden de la hoja/);
    }
    expect(applySort(stock, MP_STOCK_SORT_OPTIONS, MP_ORDEN_CARGA_KEY).map((r) => r.descripcion)).toEqual([
      "Glicerina",
      "Ácido hialurónico",
      "Fragancia",
      "Alcohol cetílico",
      "Vitamina E",
    ]);
  });

  it("una clave desconocida (p. ej. una preferencia vieja) cae en el orden de carga, no en un orden alfabético", () => {
    expect(applySort(stock, MP_STOCK_SORT_OPTIONS, "codigo_asc_viejo").map((r) => r.id)).toEqual(ids);
  });

  it("ordenar por una columna es explícito y volver al orden de carga recupera EXACTAMENTE el original", () => {
    expect(applySort(stock, MP_STOCK_SORT_OPTIONS, "descripcion_asc").map((r) => r.id)).not.toEqual(ids);
    expect(applySort(stock, MP_STOCK_SORT_OPTIONS, MP_ORDEN_CARGA_KEY).map((r) => r.id)).toEqual(ids);
  });

  it("filtrar y limpiar el filtro conserva el orden relativo de carga", () => {
    const filtradas = stock.filter((r) => /a/i.test(r.descripcion));
    expect(applySort(filtradas, MP_STOCK_SORT_OPTIONS, MP_ORDEN_CARGA_KEY).map((r) => r.id)).toEqual(filtradas.map((r) => r.id));
  });
});
