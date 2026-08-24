/**
 * @vitest-environment happy-dom
 */
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { CodificadoTracePanel } from "./codificado-trace-panel";
import { createTestWorkItem } from "@/lib/__fixtures__/work-item.factory";

afterEach(() => {
  cleanup();
});

/**
 * Handoff completo — Calidad y Producción leen SIEMPRE workItem (Neon,
 * fresco); `progress` es un overlay client-side (localStorage) que nunca
 * se completa para trabajos nativos, así que estos tests montan el panel
 * SIN progress — reproduce exactamente lo que ve Calidad/Producción tras
 * un F5 en otra PC.
 */
describe("CodificadoTracePanel — datos completos hacia Calidad/Producción (sin overlay local)", () => {
  it("Caso 6: packingGroups completo — muestra la distribución real de cajas, no solo el total", () => {
    const item = createTestWorkItem({
      id: "wi-packing",
      sector: "CODIFICADO",
      packingGroups: [
        { cajas: 10, unidadesPorCaja: 100 },
        { cajas: 2, unidadesPorCaja: 50 },
      ],
    });

    render(<CodificadoTracePanel workItem={item} />);

    const cajas = screen.getByTestId("trace-cajas").textContent ?? "";
    expect(cajas).toMatch(/10\s*×\s*100/);
    expect(cajas).toMatch(/2\s*×\s*50/);
    expect(cajas).toMatch(/Embalado:\s*1100/);
  });

  it("Caso 7: sampleUnits es informativo — se ve 'Muestras: 3' pero no cambia ningún total", () => {
    const item = createTestWorkItem({
      id: "wi-samples",
      sector: "CODIFICADO",
      sampleUnits: 3,
      deliverableUnits: 2880,
      packingGroups: [{ cajas: 28, unidadesPorCaja: 102 }, { cajas: 1, unidadesPorCaja: 24 }],
    });

    render(<CodificadoTracePanel workItem={item} />);

    expect(screen.getByTestId("trace-samples").textContent).toMatch(/^3 un\./);
    // El total embalado/entregable no cambia por las muestras — sigue en 2880.
    expect(screen.getByTestId("trace-deliverable").textContent).toMatch(/^2880 un\./);
  });

  it("Caso 8: sobrante de granel — kg y observación se ven desde workItem solo (bug corregido: antes dependía de un overlay local nunca poblado)", () => {
    const item = createTestWorkItem({
      id: "wi-bulk",
      sector: "CODIFICADO",
      bulkRemainderKg: 3.2,
      bulkRemainderObservation: "Sobrante del lote L-900, guardado en tambor 4",
    });

    render(<CodificadoTracePanel workItem={item} />);

    expect(screen.getByTestId("trace-bulk").textContent).toBe("3.2 kg");
    expect(screen.getByTestId("trace-bulk-observation").textContent).toMatch(
      /Sobrante del lote L-900, guardado en tambor 4/
    );
  });

  it("sin sobrante, no rompe ni inventa datos — muestra '—'", () => {
    const item = createTestWorkItem({ id: "wi-no-bulk", sector: "CODIFICADO" });
    render(<CodificadoTracePanel workItem={item} />);
    expect(screen.getByTestId("trace-bulk").textContent).toBe("—");
    expect(screen.queryByTestId("trace-bulk-observation")).toBeNull();
  });
});
