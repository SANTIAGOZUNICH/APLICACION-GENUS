/**
 * @vitest-environment happy-dom
 */
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { PackagingQuantitiesBlock } from "./packaging-quantities-block";
import { OperationalStoreProvider } from "@/features/os/operational/store/operational-store-context";
import { createTestWorkItem } from "@/lib/__fixtures__/work-item.factory";

afterEach(() => {
  cleanup();
});

/**
 * Regla definitiva de muestras (ver auditoría de integridad operativa,
 * corrección sobre PR #76): sampleUnits es METADATA INTERNA únicamente.
 * NO suma, NO resta, NO participa de la diferencia producido-vs-embalado.
 *
 *   difference = finishedUnits - packedUnits   (bruto, SIN restar muestras)
 *
 * Estos tests verifican exactamente los 3 casos obligatorios del pedido,
 * sobre el bloque interno de Envasado/Codificado (donde "Muestras" SÍ
 * puede aparecer como dato informativo — es una vista operativa interna,
 * no el remito).
 */
describe("PackagingQuantitiesBlock — Caso A: 2883 producidas / 3 muestras / 2880 embaladas → diferencia 3 (las muestras NO la compensan)", () => {
  it("muestra advertencia de mismatch y exige observación — diferencia real es 3, no 0", () => {
    const item = createTestWorkItem({
      id: "wi-caso-a",
      sector: "CODIFICADO",
      product: "CREMA CASO A",
      packagingTotalUnits: 2883,
      sampleUnits: 3,
      packingGroups: [
        { cajas: 28, unidadesPorCaja: 102 },
        { cajas: 1, unidadesPorCaja: 24 },
      ],
    });

    render(
      <OperationalStoreProvider>
        <PackagingQuantitiesBlock item={item} actorName="Codificado" />
      </OperationalStoreProvider>
    );

    expect(screen.getByTestId("packaging-mismatch")).toBeTruthy();
    expect(screen.getByText(/requerida para documentar la diferencia/)).toBeTruthy();

    const summary = screen.getByTestId("packaging-close-summary").textContent ?? "";
    expect(summary).toMatch(/Cantidad final:\s*2883/);
    expect(summary).toMatch(/Muestras.*:\s*3/);
    expect(summary).toMatch(/Embalado:\s*2880/);
    expect(summary).toMatch(/Diferencia.*:\s*3/);
    expect(screen.getByTestId("packaging-close-indicator").textContent).not.toMatch(/Puede entregar/);
  });
});

describe("PackagingQuantitiesBlock — Caso B: 2883 producidas / 3 muestras / 2883 embaladas → diferencia 0", () => {
  it("sin advertencia, Diferencia 0, Puede entregar — las muestras siguen registradas como metadata", () => {
    const item = createTestWorkItem({
      id: "wi-caso-b",
      sector: "CODIFICADO",
      product: "CREMA CASO B",
      packagingTotalUnits: 2883,
      sampleUnits: 3,
      packingGroups: [{ cajas: 1, unidadesPorCaja: 2883 }],
    });

    render(
      <OperationalStoreProvider>
        <PackagingQuantitiesBlock item={item} actorName="Codificado" />
      </OperationalStoreProvider>
    );

    expect(screen.queryByTestId("packaging-mismatch")).toBeNull();
    expect(screen.queryByText(/requerida para documentar la diferencia/)).toBeNull();
    expect(screen.getByTestId("packaging-close-indicator").textContent).toMatch(/Puede entregar/);

    const summary = screen.getByTestId("packaging-close-summary").textContent ?? "";
    expect(summary).toMatch(/Cantidad final:\s*2883/);
    expect(summary).toMatch(/Muestras.*:\s*3/);
    expect(summary).toMatch(/Embalado:\s*2883/);
    expect(summary).toMatch(/Diferencia.*:\s*0/);
  });
});

describe("PackagingQuantitiesBlock — Caso C: 1002 producidas / 2 muestras / 1000 embaladas → diferencia 2, NUNCA 0", () => {
  it("la diferencia real es 2 (no 0) — antes el cálculo neto la escondía", () => {
    const item = createTestWorkItem({
      id: "wi-caso-c",
      sector: "CODIFICADO",
      product: "CREMA CASO C",
      packagingTotalUnits: 1002,
      sampleUnits: 2,
      packingGroups: [
        { cajas: 10, unidadesPorCaja: 25 },
        { cajas: 15, unidadesPorCaja: 50 },
      ],
    });

    render(
      <OperationalStoreProvider>
        <PackagingQuantitiesBlock item={item} actorName="Codificado" />
      </OperationalStoreProvider>
    );

    expect(screen.getByTestId("packaging-mismatch")).toBeTruthy();
    const summary = screen.getByTestId("packaging-close-summary").textContent ?? "";
    expect(summary).toMatch(/Embalado:\s*1000/);
    expect(summary).toMatch(/Diferencia.*:\s*2/);
    expect(summary).not.toMatch(/Diferencia.*:\s*0/);
  });
});

describe("PackagingQuantitiesBlock — 'A embalar' (deliverableUnits neto) ya no existe en la UI", () => {
  it("el resumen no muestra ninguna cantidad 'a embalar' derivada de restar muestras", () => {
    const item = createTestWorkItem({
      id: "wi-no-a-embalar",
      sector: "CODIFICADO",
      product: "CREMA X",
      packagingTotalUnits: 2883,
      sampleUnits: 3,
      packingGroups: [{ cajas: 1, unidadesPorCaja: 2883 }],
    });

    render(
      <OperationalStoreProvider>
        <PackagingQuantitiesBlock item={item} actorName="Codificado" />
      </OperationalStoreProvider>
    );

    const summary = screen.getByTestId("packaging-close-summary").textContent ?? "";
    expect(summary).not.toMatch(/A embalar/);
  });
});
