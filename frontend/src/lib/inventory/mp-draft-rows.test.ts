import { describe, expect, it } from "vitest";
import { ingresoPayloadFromDraft, stockPayloadFromDraft } from "./mp-draft-rows";

describe("filas en blanco → pedido de alta", () => {
  it("Stock: convierte kg con coma, fecha dd/mm/aaaa y conserva el id de la fila (reintentos no duplican)", () => {
    const r = stockPayloadFromDraft("id-1", { "DESCRIPCIÓN MATERIA PRIMA": "Glicerina", LOTE: "L1", "CANTIDAD (KG)": "1.250,5", VENCIMIENTO: "31/12/2027" });
    expect(r).toMatchObject({ ok: true, payload: { id: "id-1", descripcion: "Glicerina", lote: "L1", cantidadKg: 1250.5, vencimiento: "2027-12-31" } });
  });
  it("Stock: kg o fecha inválidos no crean nada y dicen cuál campo", () => {
    expect(stockPayloadFromDraft("i", { "CANTIDAD (KG)": "abc" })).toMatchObject({ ok: false, message: expect.stringContaining("Cantidad (kg)") });
    expect(stockPayloadFromDraft("i", { "CANTIDAD (KG)": "5", VENCIMIENTO: "99/99/2027" })).toMatchObject({ ok: false, message: expect.stringContaining("Vencimiento") });
  });
  it("Ingresos: fecha, cantidad y proveedor se interpretan; cantidad 0 se rechaza", () => {
    const ok = ingresoPayloadFromDraft("id-2", { FECHA: "20/10/2026", PROVEEDOR: "ACME", "DESCRIPCIÓN MATERIA PRIMA": "Agua", LOTE: "A1", "CANTIDAD (kg/u)": "100", BULTOS: "4" });
    expect(ok).toMatchObject({ ok: true, payload: { id: "id-2", fecha: "2026-10-20", cantidad: 100, bultos: 4, proveedor: "ACME" } });
    expect(ingresoPayloadFromDraft("id-2", { FECHA: "20/10/2026", "CANTIDAD (kg/u)": "0" })).toMatchObject({ ok: false });
    expect(ingresoPayloadFromDraft("id-2", { FECHA: "", "CANTIDAD (kg/u)": "5" })).toMatchObject({ ok: false, message: expect.stringContaining("Fecha") });
  });
});
