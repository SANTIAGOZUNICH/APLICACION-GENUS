import { describe, expect, it } from "vitest";
import { buildAutoOrderRef, extractPedidoNumber } from "./pedido-order-ref";

/**
 * "N° de Pedido" (production_pedidos.op) es texto libre — sin CHECK, sin
 * regex, copiado tal cual desde Excel (ver excel-paste.ts) o tipeado a
 * mano. Estos tests cubren los formatos reales relevados en el schema/
 * import antes de implementar la extracción, no solo "OP-4521".
 */
describe("extractPedidoNumber", () => {
  it("extrae el número de 'OP-4521'", () => {
    expect(extractPedidoNumber("OP-4521")).toBe("4521");
  });

  it("extrae el número de un pedido sin prefijo, ya plano", () => {
    expect(extractPedidoNumber("4521")).toBe("4521");
  });

  it("extrae el número sin guion ('OP4521')", () => {
    expect(extractPedidoNumber("OP4521")).toBe("4521");
  });

  it("extrae el número con texto alrededor ('Pedido N° 4521')", () => {
    expect(extractPedidoNumber("Pedido N° 4521")).toBe("4521");
  });

  it("preserva ceros a la izquierda tal cual vienen en el pedido ('OP-004521')", () => {
    expect(extractPedidoNumber("OP-004521")).toBe("004521");
  });

  it("si el N° de Pedido ya trae año embebido ('2026-4521'), toma el número de secuencia, no el año", () => {
    expect(extractPedidoNumber("2026-4521")).toBe("4521");
  });

  it("null/vacío/sin dígitos → null, nunca se inventa", () => {
    expect(extractPedidoNumber(null)).toBeNull();
    expect(extractPedidoNumber(undefined)).toBeNull();
    expect(extractPedidoNumber("")).toBeNull();
    expect(extractPedidoNumber("Sin número")).toBeNull();
  });
});

describe("buildAutoOrderRef", () => {
  it("Envasado Masivo/Premium/Codificado → OA-{año}-{número}", () => {
    expect(buildAutoOrderRef("ENVASADO_MASIVO", "OP-4521", "2026-08-03")).toBe("OA-2026-4521");
    expect(buildAutoOrderRef("ENVASADO_PREMIUM", "OP-4521", "2026-08-03")).toBe("OA-2026-4521");
    expect(buildAutoOrderRef("CODIFICADO", "OP-4521", "2026-08-03")).toBe("OA-2026-4521");
  });

  it("Elaboración → OE-{año}-{número}", () => {
    expect(buildAutoOrderRef("ELABORACION", "OP-4521", "2026-08-03")).toBe("OE-2026-4521");
  });

  it("el año sale de la fecha pasada, NUNCA hardcodeado — año 2027 real, no 2026", () => {
    expect(buildAutoOrderRef("ENVASADO_MASIVO", "OP-4521", "2027-01-15")).toBe("OA-2027-4521");
  });

  it("año 2025 también funciona — no hay ningún año fijo en el código", () => {
    expect(buildAutoOrderRef("CODIFICADO", "OP-100", "2025-12-31")).toBe("OA-2025-100");
  });

  it("sin pedido (op null) → null, no inventa un OA/OE", () => {
    expect(buildAutoOrderRef("ENVASADO_MASIVO", null, "2026-08-03")).toBeNull();
  });

  it("sin fecha de producción → null, no usa el año actual del sistema", () => {
    expect(buildAutoOrderRef("ENVASADO_MASIVO", "OP-4521", null)).toBeNull();
    expect(buildAutoOrderRef("ENVASADO_MASIVO", "OP-4521", "")).toBeNull();
  });
});
