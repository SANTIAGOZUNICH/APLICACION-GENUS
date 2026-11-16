import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("@/lib/db/client", () => ({ getDb: () => ({}), isDatabaseConfigured: () => false }));

import { matchMaterialCodigos } from "./despacho-me-stock";
import { meSalidasNetas, computeMeStock } from "@/lib/inventory/me-stock-calc";
import type { MeSalidaRow } from "@/lib/inventory/types";

const mat = (codigo: string, descripcion: string, cliente: string, archived = false) => ({ codigo, descripcion, cliente, archived });
const sal = (o: Partial<MeSalidaRow>): MeSalidaRow => ({ id: "s", fecha: "2026-11-01", egresoNro: "", cliente: "", remitoNro: "", descripcion: "", bultos: null, cantidad: 0, total: 0, control: false, entregado: false, comentarios: "", materialId: null, codigo: "C1", unidad: "u", origen: "MANUAL", descuentaStock: true, oaId: null, oaNumber: null, oaVersion: null, materialLineId: null, idempotencyKey: null, reverted: false, revertedAt: null, revertReason: null, createdBy: "", updatedBy: "", createdAt: "", updatedAt: "", ...o });

describe("matchMaterialCodigos (cliente + descripción)", () => {
  const mats = [mat("C1", "Caja Chica", "ACME"), mat("C2", "Caja Chica", "OTRO"), mat("C3", "caja  chica", "acme", true), mat("C4", "Frasco", "ACME"), mat("C5", "Frasco", "ACME")];
  it("coincide por cliente + descripción sin mezclar clientes (ignora mayúsculas, acentos, espacios y archivados)", () => {
    expect(matchMaterialCodigos(mats, "Acme", "CAJA   chica")).toEqual(["C1"]);
    expect(matchMaterialCodigos(mats, "OTRO", "Caja Chica")).toEqual(["C2"]);
  });
  it("sin coincidencia o ambiguo: devuelve vacío / varios (nunca adivina)", () => {
    expect(matchMaterialCodigos(mats, "ACME", "Algo distinto")).toEqual([]);
    expect(matchMaterialCodigos(mats, "NADIE", "Caja Chica")).toEqual([]);
    expect(matchMaterialCodigos(mats, "ACME", "Frasco").sort()).toEqual(["C4", "C5"]);
    expect(matchMaterialCodigos(mats, "ACME", "")).toEqual([]);
  });
});

describe("neteo de OA", () => {
  it("salidas sin OA restan completas; por OA se resta max(entregado, usado)", () => {
    const rows = [sal({ total: 10 }), sal({ id: "a", origen: "OA", oaNumber: "OA-2026-000100", total: 30 }), sal({ id: "b", comentarios: "para OA-2026-000100", total: 40 })];
    expect(meSalidasNetas(rows).total).toBe(10 + 40);
    expect(meSalidasNetas(rows).groups[0]).toMatchObject({ gross: 30, handed: 40, neteo: 30 });
  });
  it("la salida anulada o sin descuento no cuenta; el ingreso nunca baja", () => {
    const stock = computeMeStock("C1", { ingresos: [{ codigo: "C1", total: 100, anulado: false } as never], salidas: [sal({ total: 20 }), sal({ id: "r", total: 99, reverted: true }), sal({ id: "n", total: 99, descuentaStock: false })], ajustes: [], materialIds: new Set() });
    expect(stock).toBe(80);
  });
});
