import { describe, expect, it } from "vitest";
import type { MpIngresoRow, MpStockRow } from "@/lib/inventory/types";
import { ingresoTraceNote, originalIngresoByLot, stockTraceNote } from "./mp-trazabilidad";

const lot = (p: Partial<MpStockRow>) => ({ id: "L1", proveedor: "P1", descripcion: "Mentol", lote: "A", vencimiento: "2027-01-31", producto: "", productosAsociados: "CREMA", ...p }) as MpStockRow;
const ing = (p: Partial<MpIngresoRow>) =>
  ({ id: "I1", ingresoNro: "MP-I-00001", remitoNro: "R1", status: "CONFIRMADO", stockLotId: "L1", fecha: "2026-09-01", createdAt: "2026-09-01T10:00:00Z", proveedor: "P1", descripcion: "Mentol", lote: "A", vencimiento: "2027-01-31", producto: "CREMA", ...p }) as MpIngresoRow;

describe("trazabilidad Stock MP ↔ ingreso original", () => {
  it("el ingreso original es el CONFIRMADO más antiguo del lote (borradores y anulados no cuentan)", () => {
    const m = originalIngresoByLot([
      ing({ id: "I3", fecha: "2026-09-05" }),
      ing({ id: "I0", fecha: "2026-08-01", status: "BORRADOR" }),
      ing({ id: "I2", fecha: "2026-09-02" }),
    ]);
    expect(m.get("L1")?.id).toBe("I2");
  });

  it("sin diferencias no hay nota; con diferencias, las dos celdas dicen cuál es vigente y cuál es el original", () => {
    expect(stockTraceNote(lot({}), "proveedor", ing({}))).toBeNull();
    const s = stockTraceNote(lot({ proveedor: "P2" }), "proveedor", ing({}));
    expect(s).toMatch(/vigente/);
    expect(s).toMatch(/MP-I-00001/);
    expect(s).toMatch(/«P1»/);
    const i = ingresoTraceNote(ing({}), "proveedor", lot({ proveedor: "P2" }), true);
    expect(i).toMatch(/recibido/);
    expect(i).toMatch(/«P2»/);
    // Solo en el ingreso original y confirmado.
    expect(ingresoTraceNote(ing({}), "proveedor", lot({ proveedor: "P2" }), false)).toBeNull();
    expect(ingresoTraceNote(ing({ status: "ANULADO" }), "proveedor", lot({ proveedor: "P2" }), true)).toBeNull();
  });

  it("PRODUCTO: sin valor propio en Stock no compara (muestra el de los ingresos); con valor propio distinto, nota", () => {
    expect(stockTraceNote(lot({ producto: "" }), "producto", ing({}))).toBeNull();
    expect(stockTraceNote(lot({ producto: "GEL" }), "producto", ing({}))).toMatch(/«CREMA»/);
    expect(stockTraceNote(lot({ producto: "crema " }), "producto", ing({}))).toBeNull();
  });

  it("lote manual sin ingreso: sin nota", () => {
    expect(stockTraceNote(lot({ lote: "Z" }), "lote", undefined)).toBeNull();
  });
});
