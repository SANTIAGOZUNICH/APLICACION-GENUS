import { describe, expect, it } from "vitest";
import { computeMeDiferencia, formatMeDiferencia, meDiferenciaTone } from "./me-diferencia";

const link = (u: number | null, ratio: number | null = 1, id = "p1") => ({ pedidoId: id, pedidoUnidades: u, unidadesPorProducto: ratio });

describe("DIFERENCIA ME", () => {
  it("3000 vs 2800 envases → −200 FALTAN (rojo)", () => {
    const d = computeMeDiferencia(2800, [link(3000)]);
    expect(d).toMatchObject({ estado: "FALTAN", diferencia: -200, necesario: 3000 });
    expect(formatMeDiferencia(d)).toBe("−200 FALTAN");
    expect(meDiferenciaTone(d.estado)).toBe("red");
  });
  it("3200 tapas → +200 SOBRAN (verde); 3000 etiquetas → 0 JUSTO (verde)", () => {
    expect(formatMeDiferencia(computeMeDiferencia(3200, [link(3000)]))).toBe("+200 SOBRAN");
    const j = computeMeDiferencia(3000, [link(3000)]);
    expect(formatMeDiferencia(j)).toBe("0 JUSTO");
    expect(meDiferenciaTone(j.estado)).toBe("green");
  });
  it("consumo no 1:1 (1 caja cada 12 u; 2 etiquetas por producto)", () => {
    expect(computeMeDiferencia(250, [link(3000, 1 / 12)])).toMatchObject({ estado: "JUSTO", diferencia: 0, necesario: 250 });
    expect(computeMeDiferencia(5000, [link(3000, 2)])).toMatchObject({ estado: "FALTAN", diferencia: -1000, necesario: 6000 });
  });
  it("sin pedido → SIN DATOS; consumo desconocido → SIN CONFIGURAR (no asume 1:1)", () => {
    expect(computeMeDiferencia(100, []).estado).toBe("SIN_DATOS");
    expect(computeMeDiferencia(100, [link(3000, null)]).estado).toBe("SIN_CONFIGURAR");
    expect(computeMeDiferencia(100, [link(null)]).estado).toBe("SIN_DATOS");
    expect(meDiferenciaTone("SIN_CONFIGURAR")).toBe("neutral");
  });
  it("varios pedidos activos vinculados al mismo material suman su necesidad", () => {
    expect(computeMeDiferencia(5000, [link(3000, 1, "a"), link(2500, 1, "b")])).toMatchObject({ estado: "FALTAN", diferencia: -500 });
  });
  it("stock acumulado de dos ingresos (1.000 + 1.500 = 2.500 → −500; +700 → +200)", () => {
    expect(computeMeDiferencia(1000 + 1500, [link(3000)]).diferencia).toBe(-500);
    expect(computeMeDiferencia(1000 + 1500 + 700, [link(3000)]).diferencia).toBe(200);
  });
});
