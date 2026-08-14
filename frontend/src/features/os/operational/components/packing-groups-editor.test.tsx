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
 * Regla definitiva de muestras (auditoría de integridad operativa,
 * corrección sobre PR #76): sampleUnits es metadata interna únicamente,
 * NUNCA compensa una diferencia entre producido y embalado. El warning de
 * este componente (`packingProducedMismatchWarning`) compara producido
 * BRUTO vs embalado — informar muestras ya no lo desactiva.
 */
describe("PackingGroupsEditor — advertencia de mismatch (regla definitiva, muestras no compensa)", () => {
  const groups1000 = [
    { cajas: 10, unidadesPorCaja: 25 },
    { cajas: 15, unidadesPorCaja: 50 },
  ];

  it("1002 producido / 1000 embalado, CON 2 muestras informadas → SIGUE advirtiendo (las muestras no la compensan)", () => {
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
    expect(screen.getByTestId("packaging-mismatch")).toBeTruthy();
    expect(screen.getByText(/requerida para documentar la diferencia/)).toBeTruthy();
  });

  it("1000 producido (bruto) / 1000 embalado → sin advertencia", () => {
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

  it("1002 producido sin informar muestras → advierte igual que informándolas (el parámetro ya no cambia el resultado)", () => {
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

  it("con muestras=2 y mismatch real, la observación sigue siendo exigida (needsObs=true) — no queda bloqueado el guardado silenciosamente", () => {
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
    expect(screen.getByTestId("packaging-observation")).toBeTruthy();
  });
});
