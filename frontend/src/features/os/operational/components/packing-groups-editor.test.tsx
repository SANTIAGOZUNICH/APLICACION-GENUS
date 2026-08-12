/**
 * @vitest-environment happy-dom
 */
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { PackingGroupsEditor } from "./packing-groups-editor";

afterEach(() => {
  cleanup();
});

/**
 * Regresión del caso reportado en Preview: la pantalla de cierre de
 * Envasado/Codificado mostraba a la vez "Total producido (1002) no
 * coincide con total embalado (1000)" (advertencia naranja, de ESTE
 * componente) y, más abajo, "Diferencia: 0 · Distribución correcta" (del
 * resumen de PackagingQuantitiesBlock) — dos resultados contradictorios en
 * la misma pantalla porque el warning de acá no restaba muestras. Este
 * test cubre exactamente el componente/condición que genera ese mensaje
 * (`warn`/`needsObs`, líneas de renderizado del `data-testid="packaging-mismatch"`
 * y de "Observación de embalaje (requerida...)").
 */
describe("PackingGroupsEditor — advertencia de mismatch (caso 1002/2 muestras/1000 embalado)", () => {
  const groups1000 = [
    { cajas: 10, unidadesPorCaja: 25 },
    { cajas: 15, unidadesPorCaja: 50 },
  ];

  it("con muestras informadas (2), NO muestra advertencia naranja ni exige observación", () => {
    render(
      <PackingGroupsEditor
        groups={groups1000}
        onChange={() => {}}
        producedUnits={1002}
        sampleUnits={2}
        requireObservationOnMismatch
        testIdPrefix="packaging"
      />
    );
    expect(screen.queryByTestId("packaging-mismatch")).toBeNull();
    expect(screen.queryByText(/no coinciden con total embalado/)).toBeNull();
    expect(screen.queryByText(/requerida para documentar la diferencia/)).toBeNull();
  });

  it("MISMO caso pero sin pasar sampleUnits (regresión del bug real) — sigue sin advertir, porque producedUnits ya sería el neto en ese flujo", () => {
    // Nota: esto documenta que si algún caller pasara el NETO (1000) como
    // producedUnits sin muestras, tampoco hay mismatch — el bug real no
    // era "sampleUnits ausente en general", sino un caller que pasaba el
    // BRUTO (1002) sin muestras. Ver el próximo test.
    render(
      <PackingGroupsEditor
        groups={groups1000}
        onChange={() => {}}
        producedUnits={1000}
        testIdPrefix="packaging"
      />
    );
    expect(screen.queryByTestId("packaging-mismatch")).toBeNull();
  });

  it("BUG REAL reproducido: bruto (1002) sin informar muestras → SÍ advierte (demuestra por qué sampleUnits es obligatorio pasarlo)", () => {
    render(
      <PackingGroupsEditor
        groups={groups1000}
        onChange={() => {}}
        producedUnits={1002}
        requireObservationOnMismatch
        testIdPrefix="packaging"
      />
    );
    expect(screen.getByTestId("packaging-mismatch")).toBeTruthy();
    expect(screen.getByText(/requerida para documentar la diferencia/)).toBeTruthy();
  });

  it("con muestras=2 el mensaje de guardado no queda bloqueado (needsObs=false)", () => {
    render(
      <PackingGroupsEditor
        groups={groups1000}
        onChange={() => {}}
        producedUnits={1002}
        sampleUnits={2}
        requireObservationOnMismatch
        testIdPrefix="packaging"
      />
    );
    expect(screen.queryByTestId("packaging-observation")).toBeNull();
  });
});
