/**
 * @vitest-environment happy-dom
 */
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";

const fetchPendingDefinition = vi.fn();
const postBulkDeleteWorks = vi.fn();
const showToast = vi.fn();
let sector = "PRODUCCION";

vi.mock("../adapters/circuit-client", () => ({
  fetchPendingDefinition: (...a: unknown[]) => fetchPendingDefinition(...a),
  postBulkDeleteWorks: (...a: unknown[]) => postBulkDeleteWorks(...a),
  fetchDeliveryProgress: vi.fn(),
  postCircuitDelivery: vi.fn(),
  postSendToEnvasado: vi.fn(),
  newIdempotencyKey: (p: string) => `${p}-test`,
}));
vi.mock("../adapters/codificado-handoff-client", () => ({ postCodificadoHandoff: vi.fn() }));
vi.mock("@/lib/api/live-sync-client", () => ({ postReworkWork: vi.fn() }));
vi.mock("@/features/os/shell/twin-shell", () => ({ TwinShell: ({ children }: { children: React.ReactNode }) => <div>{children}</div> }));
vi.mock("@/features/os/workspace/workspace-provider", () => ({
  useRequiredWorkspace: () => ({ context: { displayName: "Prod" } }),
}));
vi.mock("@/features/os/session/preview-context", () => ({
  usePreviewContext: () => ({ showToast, openWorkItem: vi.fn() }),
  usePreviewSession: () => ({ email: "p@x.com", sectorId: sector }),
}));
vi.mock("../components/mark-ready-panel", () => ({ MarkReadyPanel: () => null }));

import { PendientesDefinirView } from "./pendientes-definir-view";

function row(id: string, product: string) {
  return {
    workItem: { id, product, client: "Cliente", quantity: "10", unit: "un", sector: "ENVASADO_MASIVO", completedAt: null },
    info: { label: "Sin destino", actions: ["REHACER"], legacyQualityPending: false, hadQualityDecision: false },
  };
}

describe("Pendientes de definir — selección múltiple y eliminación masiva", () => {
  beforeEach(() => {
    sector = "PRODUCCION";
    fetchPendingDefinition.mockReset().mockResolvedValue({
      items: [row("native:1", "Crema"), row("native:2", "Shampoo"), row("native:3", "Gel")],
      legacyQualityPending: 0,
    });
    postBulkDeleteWorks.mockReset().mockImplementation(async (_s: unknown, p: { ids: string[]; dryRun?: boolean }) => ({
      dryRun: !!p.dryRun,
      batchKey: null,
      requested: p.ids.length,
      deleted: p.dryRun ? [] : p.ids.filter((i) => i !== "native:3"),
      verdicts: p.ids.map((id) =>
        id === "native:3"
          ? { id, code: "BLOCKED_IN_REMITO", reason: "Está incluido en un remito: se conserva por historial." }
          : { id, code: "ELIGIBLE", reason: "" }
      ),
    }));
    showToast.mockReset();
  });
  afterEach(cleanup);

  it("checkbox por fila + encabezado; contador, resaltado y alcance «visibles»", async () => {
    render(<PendientesDefinirView />);
    await screen.findAllByTestId("pendiente-row");
    expect(screen.getAllByTestId("bulk-select-row")).toHaveLength(3);
    expect(screen.queryByTestId("bulk-bar")).toBeNull();
    fireEvent.click(screen.getAllByTestId("bulk-select-row")[0]!);
    expect(screen.getByTestId("bulk-count").textContent).toBe("1 registro seleccionado");
    expect(screen.getAllByTestId("pendiente-row")[0]!.getAttribute("data-selected")).toBe("true");
    fireEvent.click(screen.getByTestId("bulk-select-all"));
    expect(screen.getByTestId("bulk-count").textContent).toBe("3 registros seleccionados");
    expect(screen.getByTestId("bulk-scope").textContent).toMatch(/3 pendientes visibles/);
    fireEvent.click(screen.getByTestId("bulk-select-all"));
    expect(screen.queryByTestId("bulk-bar")).toBeNull();
  });

  it("«Eliminar seleccionados (X)» abre la confirmación y NO elimina hasta confirmar (con motivo)", async () => {
    render(<PendientesDefinirView />);
    await screen.findAllByTestId("pendiente-row");
    fireEvent.click(screen.getByTestId("bulk-select-all"));
    fireEvent.click(screen.getByTestId("bulk-delete"));
    expect(screen.getByTestId("bulk-delete").textContent).toBe("Eliminar seleccionados (3)");
    await screen.findByTestId("bulk-delete-dialog");
    await screen.findByTestId("bulk-delete-included");
    // solo se hizo dry-run
    expect(postBulkDeleteWorks).toHaveBeenCalledTimes(1);
    expect(postBulkDeleteWorks.mock.calls[0]![1]).toMatchObject({ dryRun: true });
    expect(screen.getByTestId("bulk-delete-excluded").textContent).toMatch(/Gel.*remito/);
    expect((screen.getByTestId("bulk-delete-confirm") as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(screen.getByTestId("bulk-delete-cancel"));
    expect(postBulkDeleteWorks).toHaveBeenCalledTimes(1);

    fireEvent.click(screen.getByTestId("bulk-delete"));
    await screen.findByTestId("bulk-delete-included");
    fireEvent.change(screen.getByTestId("bulk-delete-reason"), { target: { value: "Duplicados" } });
    fetchPendingDefinition.mockResolvedValueOnce({ items: [row("native:3", "Gel")], legacyQualityPending: 0 });
    fireEvent.click(screen.getByTestId("bulk-delete-confirm"));
    await waitFor(() => expect(postBulkDeleteWorks).toHaveBeenCalledTimes(3));
    expect(postBulkDeleteWorks.mock.calls[2]![1]).toMatchObject({ ids: ["native:1", "native:2", "native:3"], reason: "Duplicados", batchKey: expect.any(String) });
    await waitFor(() => expect(showToast).toHaveBeenCalledWith(expect.stringMatching(/Se eliminaron 2 registro\(s\)\. 1 no se pudieron eliminar/), "success"));
    // la tabla se recarga y queda solo el protegido; la selección se limpió
    await waitFor(() => expect(screen.getAllByTestId("pendiente-row")).toHaveLength(1));
    expect(screen.queryByTestId("bulk-bar")).toBeNull();
  });

  it("otros sectores no ven checkboxes ni la acción masiva", async () => {
    sector = "ELABORACION";
    render(<PendientesDefinirView />);
    await screen.findAllByTestId("pendiente-row");
    expect(screen.queryByTestId("bulk-select-all")).toBeNull();
    expect(screen.queryByTestId("bulk-select-row")).toBeNull();
    expect(screen.queryByTestId("bulk-delete")).toBeNull();
  });
});
