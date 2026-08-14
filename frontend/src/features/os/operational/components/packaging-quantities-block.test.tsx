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
 * Regresión end-to-end del caso reportado en Preview (captura de pantalla):
 * en la MISMA pantalla de cierre de Codificado/Envasado aparecían dos
 * resultados contradictorios — la advertencia naranja de PackingGroupsEditor
 * ("Total producido (1002) no coincide con total embalado (1000)") y el
 * resumen de abajo ("Diferencia: 0 · Distribución correcta") — porque el
 * warning no restaba muestras y el resumen sí. Este test monta el
 * componente completo tal como lo ve Codificado, con el item YA cargado
 * con 1002 producidas / 2 muestras / 10×25+15×50 embaladas, y verifica que
 * AMBOS bloques (el warning y el resumen) concuerden: sin advertencia, sin
 * observación obligatoria, "✓ Puede entregar".
 */
describe("PackagingQuantitiesBlock — caso 1002 producidas / 2 muestras / 1000 embaladas", () => {
  it("no muestra advertencia de mismatch y el resumen dice Diferencia 0 / Puede entregar", () => {
    const item = createTestWorkItem({
      id: "wi-1002",
      sector: "CODIFICADO",
      product: "CREMA TEST",
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

    // Sin advertencia naranja de mismatch ni observación forzada.
    expect(screen.queryByTestId("packaging-mismatch")).toBeNull();
    expect(screen.queryByText(/no coinciden con total embalado/)).toBeNull();
    expect(screen.queryByText(/requerida para documentar la diferencia/)).toBeNull();

    // El resumen de cierre coincide con el mismo resultado (mismo
    // computePackagingClose, sin contradicción entre bloques).
    expect(screen.getByTestId("packaging-close-indicator").textContent).toMatch(/Puede entregar/);
    const summary = screen.getByTestId("packaging-close-summary").textContent ?? "";
    expect(summary).toMatch(/Cantidad final:\s*1002/);
    expect(summary).toMatch(/Muestras:\s*2/);
    expect(summary).toMatch(/A embalar:\s*1000/);
    expect(summary).toMatch(/Embalado:\s*1000/);
    expect(summary).toMatch(/Diferencia:\s*0/);
  });
});

/**
 * Regresión con los números EXACTOS de la captura reportada de nuevo por el
 * usuario (2883 producidas / 3 muestras / 28×102 + 1×24 = 2880 en cajas).
 * Prueba, con el componente completo, que es matemáticamente imposible que
 * coexistan la advertencia naranja y "Distribución correcta": ambas
 * derivan del mismo computePackagingClose.
 */
describe("PackagingQuantitiesBlock — caso captura (2883 producidas / 3 muestras / 2880 embaladas)", () => {
  it("2883/3/2880 (28×102 + 1×24) → sin advertencia, sin observación obligatoria, Diferencia 0, Puede entregar", () => {
    const item = createTestWorkItem({
      id: "wi-2883",
      sector: "CODIFICADO",
      product: "CREMA TEST 2883",
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

    expect(screen.queryByTestId("packaging-mismatch")).toBeNull();
    expect(screen.queryByText(/no coinciden con total embalado/)).toBeNull();
    expect(screen.queryByText(/requerida para documentar la diferencia/)).toBeNull();

    expect(screen.getByTestId("packaging-close-indicator").textContent).toMatch(/Puede entregar/);
    const summary = screen.getByTestId("packaging-close-summary").textContent ?? "";
    expect(summary).toMatch(/Cantidad final:\s*2883/);
    expect(summary).toMatch(/Muestras:\s*3/);
    expect(summary).toMatch(/A embalar:\s*2880/);
    expect(summary).toMatch(/Embalado:\s*2880/);
    expect(summary).toMatch(/Diferencia:\s*0/);
  });

  it("2883/3/2879 (mismatch real, falta 1 unidad) → SÍ muestra advertencia y exige observación", () => {
    const item = createTestWorkItem({
      id: "wi-2883-mismatch",
      sector: "CODIFICADO",
      product: "CREMA TEST 2883 MISMATCH",
      packagingTotalUnits: 2883,
      sampleUnits: 3,
      packingGroups: [
        { cajas: 28, unidadesPorCaja: 102 },
        { cajas: 1, unidadesPorCaja: 23 },
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
    expect(summary).toMatch(/Diferencia:\s*1/);
  });
});
