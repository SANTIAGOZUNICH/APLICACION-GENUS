/**
 * @vitest-environment happy-dom
 */
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AsignacionLoteSourcesPanel } from "./asignacion-lote-sources-panel";

const fetchMock = vi.fn();
const session = { email: "produccion@laboratoriogenus.com.ar", sector: "PRODUCCION" as const };

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status });
}

describe("AsignacionLoteSourcesPanel — conectar planilla con vista previa obligatoria antes de importar", () => {
  beforeEach(() => {
    fetchMock.mockReset();
    fetchMock.mockImplementation((url: string) => {
      if (url.includes("/sources/test-connection")) {
        return Promise.resolve(
          jsonResponse({
            ok: true,
            spreadsheetAccessible: true,
            sheetFound: true,
            availableTabs: ["LOTES_2025"],
            headersRecognized: ["LOTE", "PRODUCTO"],
            headersUnrecognized: [],
            rowCount: 3,
          })
        );
      }
      if (url.includes("/sources/preview-import")) {
        return Promise.resolve(
          jsonResponse({
            ok: true,
            rowsFound: 3,
            nuevas: 2,
            existentes: 1,
            conflictos: 0,
            invalidas: 0,
            conflictSamples: [],
          })
        );
      }
      if (url.endsWith("/sources") && !url.includes("preview") && !url.includes("test-connection")) {
        return Promise.resolve(jsonResponse({ source: { id: "als-1" }, sources: [] }));
      }
      return Promise.resolve(jsonResponse({ sources: [] }));
    });
    vi.stubGlobal("fetch", fetchMock);
  });

  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it("Conectar queda deshabilitado hasta que la vista previa de importación corre con éxito", async () => {
    const user = userEvent.setup();
    render(<AsignacionLoteSourcesPanel session={session} />);

    await user.click(screen.getByTestId("asignacion-lote-sources-toggle"));
    await user.click(await screen.findByTestId("asignacion-lote-source-connect-open"));

    await user.type(screen.getByTestId("asignacion-lote-source-name-input"), "Asignación de Lotes 2025");
    await user.type(
      screen.getByTestId("asignacion-lote-source-url-input"),
      "https://docs.google.com/spreadsheets/d/hist2025AAAA_-111"
    );

    const connectBtn = screen.getByTestId("asignacion-lote-source-connect-submit") as HTMLButtonElement;
    expect(connectBtn.disabled).toBe(true);

    await user.click(screen.getByTestId("asignacion-lote-source-test-connection"));
    await waitFor(() => expect(screen.getByTestId("asignacion-lote-source-test-result")).toBeTruthy());

    // Probar conexión sola NO alcanza — sigue deshabilitado sin la vista previa.
    expect(connectBtn.disabled).toBe(true);

    await user.click(await screen.findByTestId("asignacion-lote-source-preview-import"));
    await waitFor(() => expect(screen.getByTestId("asignacion-lote-source-preview-result")).toBeTruthy());
    expect(screen.getByTestId("asignacion-lote-source-preview-result").textContent).toContain("Nuevas: 2");
    expect(screen.getByTestId("asignacion-lote-source-preview-result").textContent).toContain(
      "Ya existentes (sin cambios): 1"
    );

    expect(connectBtn.disabled).toBe(false);

    await user.click(connectBtn);
    await waitFor(() =>
      expect(fetchMock.mock.calls.some((call: unknown[]) => (call[0] as string).endsWith("/api/v1/asignacion-lotes/sources"))).toBe(
        true
      )
    );
  });

  it("conflicto detectado en la vista previa se muestra explícitamente antes de conectar", async () => {
    fetchMock.mockImplementation((url: string) => {
      if (url.includes("/sources/test-connection")) {
        return Promise.resolve(
          jsonResponse({ ok: true, spreadsheetAccessible: true, sheetFound: true, availableTabs: ["LOTES"], headersRecognized: [], headersUnrecognized: [], rowCount: 1 })
        );
      }
      if (url.includes("/sources/preview-import")) {
        return Promise.resolve(
          jsonResponse({
            ok: true,
            rowsFound: 1,
            nuevas: 0,
            existentes: 0,
            conflictos: 1,
            invalidas: 0,
            conflictSamples: [{ lote: "G25001", codigo: "", producto: "SERUM", motivo: "Ya existe con datos distintos." }],
          })
        );
      }
      return Promise.resolve(jsonResponse({ sources: [] }));
    });
    const user = userEvent.setup();
    render(<AsignacionLoteSourcesPanel session={session} />);
    await user.click(screen.getByTestId("asignacion-lote-sources-toggle"));
    await user.click(await screen.findByTestId("asignacion-lote-source-connect-open"));
    await user.type(screen.getByTestId("asignacion-lote-source-name-input"), "2025");
    await user.type(screen.getByTestId("asignacion-lote-source-url-input"), "https://docs.google.com/spreadsheets/d/x");
    await user.click(screen.getByTestId("asignacion-lote-source-test-connection"));
    await waitFor(() => expect(screen.getByTestId("asignacion-lote-source-test-result")).toBeTruthy());
    await user.click(await screen.findByTestId("asignacion-lote-source-preview-import"));
    await waitFor(() => expect(screen.getByTestId("asignacion-lote-source-preview-result")).toBeTruthy());
    expect(screen.getByTestId("asignacion-lote-source-preview-result").textContent).toContain("Conflictos");
    expect(screen.getByTestId("asignacion-lote-source-preview-result").textContent).toContain("G25001");
  });
});
