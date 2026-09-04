/**
 * @vitest-environment happy-dom
 */
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

import { afterEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ProcedimientosView } from "./procedimientos-view";

vi.mock("@/features/os/shell/twin-shell", () => ({
  TwinShell: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));

vi.mock("@/features/os/session/preview-context", () => ({
  usePreviewSession: () => ({ email: "calidad@laboratoriogenus.com.ar", sectorId: "CALIDAD" }),
}));

const uploadProcedimientoFileApi = vi.fn();
const fetchProcedimientosApi = vi.fn();
const procedimientosActionApi = vi.fn();

vi.mock("@/lib/procedimientos/procedimientos-client", () => ({
  fetchProcedimientosApi: (...args: unknown[]) => fetchProcedimientosApi(...args),
  searchProcedimientosApi: vi.fn(),
  procedimientosActionApi: (...args: unknown[]) => procedimientosActionApi(...args),
  uploadProcedimientoFileApi: (...args: unknown[]) => uploadProcedimientoFileApi(...args),
  procedimientoDownloadUrl: () => "",
  procedimientoDownloadHeaders: () => ({}),
}));

/**
 * Caso 4 (Procedimientos, carga de archivos) — reproduce el bug real: el
 * modal de "Confirmar carga" nunca mostraba folderPreview.uploads ni
 * item.error, así que un upload fallido quedaba visualmente indistinguible
 * de uno exitoso salvo por el botón "Reintentar fallidos", sin texto de
 * error en ningún lado. Este test monta la vista real, dispara el flujo
 * completo de selección→confirmar, hace que la API de upload rechace con un
 * mensaje concreto, y verifica que ESE mensaje quede visible en pantalla.
 */
describe("ProcedimientosView — la carga fallida muestra el error real, no un estado ambiguo", () => {
  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it("un archivo que falla al subir muestra su mensaje de error real en el modal", async () => {
    fetchProcedimientosApi.mockResolvedValue({ folders: [], files: [], schemaPending: false });
    procedimientosActionApi.mockResolvedValue({ folder: { id: "folder-1" } });
    uploadProcedimientoFileApi.mockRejectedValue(
      new Error("Almacenamiento privado de archivos no configurado.")
    );

    render(<ProcedimientosView />);

    await waitFor(() => expect(fetchProcedimientosApi).toHaveBeenCalled());

    // Simular estar dentro de una carpeta y elegir un archivo — inyectamos
    // directamente el estado de preview vía el input de archivo real, igual
    // que hace un usuario: como "Subir archivos" exige parentId, probamos el
    // camino de "SUBIR CARPETA" que no lo requiere y ejercita el mismo modal.
    const folderInput = document.querySelector('input[type="file"][webkitdirectory]') as HTMLInputElement;
    expect(folderInput).toBeTruthy();

    const file = new File(["contenido"], "procedimiento.pdf", { type: "application/pdf" });
    Object.defineProperty(file, "webkitRelativePath", { value: "Carpeta/procedimiento.pdf" });
    Object.defineProperty(folderInput, "files", { value: [file], configurable: true });
    act(() => {
      folderInput.dispatchEvent(new Event("change", { bubbles: true }));
    });

    expect(await screen.findByText(/Confirmar carga/i)).toBeTruthy();

    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: "Confirmar" }));

    // El error real debe quedar visible — antes quedaba solo en el estado
    // interno (`item.error`), nunca en el DOM.
    expect(
      await screen.findByText("Almacenamiento privado de archivos no configurado.")
    ).toBeTruthy();
    expect(screen.getByText(/no se pudieron subir/i)).toBeTruthy();
    expect(screen.getByRole("button", { name: "Reintentar fallidos" })).toBeTruthy();
  });

  it("un archivo que sube bien no muestra ningún error y cierra el modal", async () => {
    fetchProcedimientosApi.mockResolvedValue({ folders: [], files: [], schemaPending: false });
    procedimientosActionApi.mockResolvedValue({ folder: { id: "folder-1" } });
    uploadProcedimientoFileApi.mockResolvedValue({ file: { id: "f1" } });

    render(<ProcedimientosView />);
    await waitFor(() => expect(fetchProcedimientosApi).toHaveBeenCalled());

    const folderInput = document.querySelector('input[type="file"][webkitdirectory]') as HTMLInputElement;
    const file = new File(["contenido"], "ok.pdf", { type: "application/pdf" });
    Object.defineProperty(file, "webkitRelativePath", { value: "Carpeta/ok.pdf" });
    Object.defineProperty(folderInput, "files", { value: [file], configurable: true });
    act(() => {
      folderInput.dispatchEvent(new Event("change", { bubbles: true }));
    });

    expect(await screen.findByText(/Confirmar carga/i)).toBeTruthy();
    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: "Confirmar" }));

    await waitFor(() => expect(screen.queryByText(/Confirmar carga/i)).toBeNull());
    expect(screen.queryByRole("button", { name: "Reintentar fallidos" })).toBeNull();
  });
});
