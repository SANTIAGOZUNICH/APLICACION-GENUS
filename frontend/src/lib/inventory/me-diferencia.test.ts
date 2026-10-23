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

import { acumuladoPorIngreso, ingresoDiferenciaView, ingresoPrevisto } from "./me-diferencia";

describe("DIFERENCIA de INGRESOS ME (acumulado por pedido, sin saldo de Stock)", () => {
  const ing = (id: string, total: number, at: string, pedidoId: string | null = "P1", codigo = "ENV") => ({ id, codigo, pedidoId, total, createdAt: `2026-10-0${at}T10:00:00Z` });
  it("acumula por código + pedido en orden de registro: 1.000 → 2.500 → 3.200", () => {
    const m = acumuladoPorIngreso([ing("c", 700, "3"), ing("a", 1000, "1"), ing("b", 1500, "2")]);
    expect([m.get("a"), m.get("b"), m.get("c")]).toEqual([1000, 2500, 3200]);
  });
  it("no mezcla pedidos ni códigos y excluye anulados y los sin pedido", () => {
    const m = acumuladoPorIngreso([ing("a", 1000, "1"), ing("x", 500, "2", "P2"), ing("y", 900, "2", "P1", "TAP"), { ...ing("z", 9999, "2"), anulado: true }, ing("n", 77, "2", null)]);
    expect(m.get("a")).toBe(1000);
    expect(m.get("x")).toBe(500);
    expect(m.get("y")).toBe(900);
    expect(m.has("z")).toBe(false);
    expect(m.has("n")).toBe(false);
  });
  it("las diferencias de la secuencia 3.000: −2.000 → −500 → +200", () => {
    const r = [1000, 2500, 3200].map((a) => computeMeDiferencia(a, [link(3000)]).diferencia);
    expect(r).toEqual([-2000, -500, 200]);
  });
  it("el snapshot manda; «hoy» solo aparece si hoy da distinto (pedido cambió de cantidad)", () => {
    const snapshot = { pedidoId: "P1", acumulado: 2500, necesario: 3000, diferencia: -500, estado: "FALTAN" as const, pedidoUnidades: 3000, unidadesPorProducto: 1, calculadoAt: "x" };
    const igual = ingresoDiferenciaView({ snapshot, actual: { estado: "FALTAN", diferencia: -500 }, estado: "FALTAN", diferencia: -500 });
    expect(igual.text).toBe("−500 FALTAN");
    const cambio = ingresoDiferenciaView({ snapshot, actual: { estado: "SOBRAN", diferencia: 300 }, estado: "SOBRAN", diferencia: 300 });
    expect(cambio.text).toBe("−500 FALTAN · hoy +300 SOBRAN");
    expect(cambio.estado).toBe("FALTAN");
  });
  it("prevista de una fila nueva: suma lo escrito al acumulado del pedido; varios pedidos → ELEGIR; sin consumo → SIN CONFIGURAR", () => {
    const ctx = { pedidos: [{ id: "P1", cliente: "WSABI", producto: "CREMA FACIAL", unidades: 3000 }, { id: "P2", cliente: "WSABI", producto: "GEL", unidades: 10 }, { id: "P3", cliente: "WSABI", producto: "GEL", unidades: 20 }], acumulados: { "ENV|P1": 2500 }, consumos: { "ENV|P1": 1 } as Record<string, number | null> };
    expect(ingresoPrevisto(ctx, { codigo: "env", cliente: "wsabi", producto: "crema facial", total: 700 })).toMatchObject({ estado: "SOBRAN", diferencia: 200 });
    expect(ingresoPrevisto(ctx, { codigo: "ENV", cliente: "WSABI", producto: "GEL", total: 5 }).estado).toBe("ELEGIR_PEDIDO");
    expect(ingresoPrevisto(ctx, { codigo: "TAP", cliente: "WSABI", producto: "CREMA FACIAL", total: 5 }).estado).toBe("SIN_CONFIGURAR");
    expect(ingresoPrevisto(ctx, { codigo: "ENV", cliente: "WSABI", producto: "OTRO", total: 5 }).estado).toBe("SIN_DATOS");
  });
});
