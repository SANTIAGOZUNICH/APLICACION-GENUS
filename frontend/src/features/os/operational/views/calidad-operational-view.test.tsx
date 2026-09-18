/**
 * @vitest-environment happy-dom
 */
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

import type { ReactNode } from "react";
import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createTestWorkItem } from "@/lib/__fixtures__/work-item.factory";
import type { QualityItem } from "../types";
import { CalidadOperationalView } from "./calidad-operational-view";

afterEach(() => {
  cleanup();
});

vi.mock("@/features/os/shell/twin-shell", () => ({
  TwinShell: ({ children }: { children: ReactNode }) => <div>{children}</div>,
}));

const approveQualityItemsBatchMock = vi.fn();
const showToastMock = vi.fn();
const refreshMock = vi.fn();

let sectorId: "CALIDAD" | "PRODUCCION" | "ELABORACION" = "CALIDAD";

vi.mock("@/features/os/workspace/workspace-provider", () => ({
  useRequiredWorkspace: () => ({
    definition: {},
    context: { displayName: "Calidad Test", jobTitle: "Analista de Calidad" },
    title: "Calidad",
    subtitle: "",
    navigation: [],
    sectorLabel: "Calidad",
  }),
}));

vi.mock("@/features/os/session/preview-context", () => ({
  usePreviewSession: () => ({ sectorId, email: "calidad@laboratoriogenus.com.ar" }),
  usePreviewContext: () => ({ showToast: showToastMock, navigateTo: vi.fn() }),
}));

let planData: { qualityItems: QualityItem[]; workItems: ReturnType<typeof createTestWorkItem>[]; source: string };

vi.mock("../hooks/use-operational-plan", () => ({
  useOperationalPlan: () => ({
    data: planData,
    loading: false,
    error: null,
    lastRefreshAt: null,
    updatedAgoLabel: "",
    liveConnected: true,
    refresh: refreshMock,
  }),
}));

vi.mock("../store/operational-store-context", () => ({
  useOperationalStore: () => ({
    getQualityStatus: (_id: string, seed: string) => seed,
    getQualityObservation: () => "",
    approveQualityItem: vi.fn().mockResolvedValue({ ok: true }),
    rejectQualityItem: vi.fn().mockResolvedValue({ ok: true }),
    annulQualityItem: vi.fn().mockResolvedValue({ ok: true }),
    approveQualityItemsBatch: approveQualityItemsBatchMock,
    progressMap: {},
  }),
}));

function qualityItem(overrides: Partial<QualityItem> & Pick<QualityItem, "id">): QualityItem {
  return {
    kind: "salida",
    lote: "G26043",
    product: "SHAVING GEL",
    client: "NOCE CANA",
    oe: null,
    oa: "OA-2026-000100",
    line: "Línea 1",
    quantity: "1000",
    dayLabel: "Lunes",
    status: "pendiente",
    relatedWorkItemId: overrides.id,
    vto: "2028-10",
    finishedQty: "1000",
    ...overrides,
  };
}

beforeEach(() => {
  sectorId = "CALIDAD";
  approveQualityItemsBatchMock.mockReset();
  showToastMock.mockReset();
  refreshMock.mockReset();
  refreshMock.mockResolvedValue(undefined);
  planData = {
    source: "native",
    qualityItems: [
      qualityItem({ id: "wi-1", product: "SHAVING GEL", client: "NOCE CANA" }),
      qualityItem({ id: "wi-2", product: "SERUM NIACINAMIDA", client: "NIZA", lote: null, vto: null }),
      qualityItem({ id: "wi-3", product: "CREMA PDRN", client: "COSMECEUTICALS" }),
    ],
    workItems: [
      createTestWorkItem({
        id: "wi-1",
        sector: "ENVASADO_MASIVO",
        originStage: "ACONDICIONAMIENTO",
        status: "en_curso",
        packagingLote: "G26043",
        packagingVto: "2028-10",
        finishedQty: "1000",
        packingGroups: [{ cajas: 10, unidadesPorCaja: 100 }],
      }),
      createTestWorkItem({
        id: "wi-2",
        sector: "ENVASADO_MASIVO",
        originStage: "ACONDICIONAMIENTO",
        status: "en_curso",
        packagingLote: null,
        packagingVto: null,
        finishedQty: "500",
        packingGroups: [{ cajas: 5, unidadesPorCaja: 100 }],
      }),
      createTestWorkItem({
        id: "wi-3",
        sector: "ENVASADO_MASIVO",
        originStage: "ACONDICIONAMIENTO",
        status: "en_curso",
        packagingLote: "E25114",
        packagingVto: "2028-05",
        finishedQty: "300",
        packingGroups: [{ cajas: 3, unidadesPorCaja: 100 }],
      }),
    ],
  };
});

/** El fixture usa QualityItem kind "salida" (Envasados) — el default de la vista es la sub-pestaña "Elaboraciones". */
function goToEnvasados() {
  fireEvent.click(screen.getByRole("tab", { name: /Envasados/i }));
}

describe("CalidadOperationalView — selección múltiple y aprobación masiva", () => {
  it("1) seleccionar una fila actualiza el contador a 1 seleccionado", () => {
    render(<CalidadOperationalView />);
    goToEnvasados();
    fireEvent.click(screen.getByLabelText("Seleccionar fila wi-1"));
    expect(screen.getByTestId("calidad-selected-count").textContent).toBe("1 seleccionado");
  });

  it("2) seleccionar varias filas suma al contador", () => {
    render(<CalidadOperationalView />);
    goToEnvasados();
    fireEvent.click(screen.getByLabelText("Seleccionar fila wi-1"));
    fireEvent.click(screen.getByLabelText("Seleccionar fila wi-2"));
    fireEvent.click(screen.getByLabelText("Seleccionar fila wi-3"));
    expect(screen.getByTestId("calidad-selected-count").textContent).toBe("3 seleccionados");
  });

  it("3) 'Seleccionar todos' marca únicamente los registros visibles en la sub-pestaña actual (Envasados)", () => {
    render(<CalidadOperationalView />);
    goToEnvasados();
    fireEvent.click(screen.getByTestId("calidad-select-all"));
    expect(screen.getByTestId("calidad-selected-count").textContent).toBe("3 seleccionados");
  });

  it("4) filtro + seleccionar todos: cambiar de sub-pestaña (Elaboraciones, sin registros) recorta la selección a lo visible ahí", () => {
    render(<CalidadOperationalView />);
    goToEnvasados();
    fireEvent.click(screen.getByTestId("calidad-select-all"));
    expect(screen.getByTestId("calidad-selected-count").textContent).toBe("3 seleccionados");

    fireEvent.click(screen.getByRole("tab", { name: /Elaboraciones/i }));
    // Sin graneles pendientes en el fixture — la selección de Envasados no se arrastra.
    expect(screen.getByTestId("calidad-selected-count").textContent).toBe("0 seleccionados");
  });

  it("5) 'Quitar selección' deselecciona todo", () => {
    render(<CalidadOperationalView />);
    goToEnvasados();
    fireEvent.click(screen.getByTestId("calidad-select-all"));
    fireEvent.click(screen.getByText("Quitar selección"));
    expect(screen.getByTestId("calidad-selected-count").textContent).toBe("0 seleccionados");
  });

  it("6) el diálogo de confirmación muestra advertencias sin bloquear la aprobación (warning no bloquea)", () => {
    render(<CalidadOperationalView />);
    goToEnvasados();
    fireEvent.click(screen.getByTestId("calidad-select-all"));
    fireEvent.click(screen.getByTestId("calidad-approve-selected"));

    const dialog = screen.getByTestId("calidad-approve-batch-dialog");
    expect(within(dialog).getByText("APROBAR 3 TRABAJOS")).toBeTruthy();
    expect(within(dialog).getByText(/3 seleccionados/)).toBeTruthy();
    expect(within(dialog).getByText(/2 sin advertencias/)).toBeTruthy();
    expect(within(dialog).getByText(/1 con datos faltantes/)).toBeTruthy();
    expect(within(dialog).getByText("FALTA LOTE")).toBeTruthy();
    expect(within(dialog).getByText("FALTA VTO")).toBeTruthy();
    // El botón de confirmar aprobación nunca queda deshabilitado por advertencias.
    const confirmButton = within(dialog).getByText(/Confirmar aprobación de 3/) as HTMLButtonElement;
    expect(confirmButton.disabled).toBe(false);
  });

  it("7) confirmar la aprobación llama a approveQualityItemsBatch con los ids seleccionados y muestra el resultado", async () => {
    approveQualityItemsBatchMock.mockResolvedValue({
      ok: true,
      batchId: "b1",
      results: [
        { id: "wi-1", status: "ok" },
        { id: "wi-2", status: "already", currentStatus: "aprobado" },
        { id: "wi-3", status: "error", message: "El trabajo cambió de estado mientras se procesaba." },
      ],
    });
    render(<CalidadOperationalView />);
    goToEnvasados();
    fireEvent.click(screen.getByTestId("calidad-select-all"));
    fireEvent.click(screen.getByTestId("calidad-approve-selected"));
    await act(async () => {
      fireEvent.click(screen.getByText(/Confirmar aprobación de 3/));
    });

    expect(approveQualityItemsBatchMock).toHaveBeenCalledWith(
      ["wi-1", "wi-2", "wi-3"],
      expect.objectContaining({ actorSectorId: "CALIDAD" })
    );
    expect(showToastMock).toHaveBeenCalledWith(expect.stringContaining("1 aprobado"));
    // El fallido queda visible en el panel de errores, con su motivo — nunca deja al usuario sin saber qué pasó.
    expect(screen.getByTestId("calidad-batch-result-errors").textContent).toContain(
      "El trabajo cambió de estado mientras se procesaba."
    );
  });

  it("8) sin permiso (sector sin RBAC de decisión) no se muestran checkboxes ni la barra de acciones masivas", () => {
    sectorId = "ELABORACION";
    render(<CalidadOperationalView />);
    goToEnvasados();
    expect(screen.queryByTestId("calidad-bulk-toolbar")).toBeNull();
    expect(screen.queryByLabelText("Seleccionar fila wi-1")).toBeNull();
  });
});
