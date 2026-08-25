/**
 * @vitest-environment happy-dom
 */
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AssignWorkDialog } from "./assign-work-dialog";

vi.mock("@/features/os/feedback/notifications-store", () => ({
  pushNotification: vi.fn(),
}));

const fetchMock = vi.fn();

/**
 * Modal "Asignar trabajo" reutilizable — reemplaza la vieja pestaña general
 * Asignar Trabajos. Estos tests cubren los casos 1/2/3/4 pedidos: el sector
 * llega fijo (sin selector) según desde dónde se abrió, y la búsqueda por
 * N° de Pedido sigue funcionando igual que antes de la extracción.
 */
describe("AssignWorkDialog — sector preseleccionado y fijo por sector", () => {
  beforeEach(() => {
    document.documentElement.dataset.genusPlanningSource = "native";
    fetchMock.mockReset();
    fetchMock.mockResolvedValue(new Response(JSON.stringify({ items: [] }), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
  });

  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
    delete document.documentElement.dataset.genusPlanningSource;
  });

  it("1) Envasado Masivo: abre con el sector fijo, sin selector editable", () => {
    render(<AssignWorkDialog sector="ENVASADO_MASIVO" onClose={() => {}} />);
    expect(screen.getByText("Asignar trabajo — Envasado Masivo")).toBeTruthy();
    expect(screen.getByTestId("assign-sector-locked").textContent).toBe("Envasado Masivo");
    expect(screen.queryByTestId("assign-sector")).toBeNull();
    // Envasado sí tiene selector de Línea.
    expect(screen.getByLabelText("Línea")).toBeTruthy();
  });

  it("2) Envasado Premium: abre con el sector fijo", () => {
    render(<AssignWorkDialog sector="ENVASADO_PREMIUM" onClose={() => {}} />);
    expect(screen.getByText("Asignar trabajo — Envasado Premium")).toBeTruthy();
    expect(screen.getByTestId("assign-sector-locked").textContent).toBe("Envasado Premium");
  });

  it("3) Elaboración: abre con el sector fijo y muestra Responsable en vez de Línea", () => {
    render(<AssignWorkDialog sector="ELABORACION" onClose={() => {}} />);
    expect(screen.getByText("Asignar trabajo — Elaboración")).toBeTruthy();
    expect(screen.getByTestId("assign-sector-locked").textContent).toBe("Elaboración");
    expect(screen.getByLabelText("Responsable")).toBeTruthy();
    expect(screen.queryByLabelText("Línea")).toBeNull();
  });

  it("Codificado: abre con el sector fijo, sin Línea ni Responsable", () => {
    render(<AssignWorkDialog sector="CODIFICADO" onClose={() => {}} />);
    expect(screen.getByTestId("assign-sector-locked").textContent).toBe("Codificado");
    expect(screen.queryByLabelText("Línea")).toBeNull();
    expect(screen.queryByLabelText("Responsable")).toBeNull();
  });

  it("4) N° de Pedido: autocomplete sigue funcionando y autocompleta Cliente/Producto", async () => {
    const user = userEvent.setup();
    fetchMock.mockImplementation((url: string) => {
      if (String(url).includes("/api/v1/production-pedidos")) {
        return Promise.resolve(
          new Response(
            JSON.stringify({
              items: [{ id: "p1", op: "OP-4521", cliente: "Cliente Test", producto: "Producto Test", kg: 12, kgDisplay: "12" }],
            }),
            { status: 200 }
          )
        );
      }
      return Promise.resolve(new Response(JSON.stringify({}), { status: 200 }));
    });

    render(<AssignWorkDialog sector="ELABORACION" onClose={() => {}} />);
    const input = screen.getByTestId("assign-pedido-search") as HTMLInputElement;
    await user.type(input, "4521");

    await waitFor(() => {
      expect(screen.getByTestId("assign-pedido-results")).toBeTruthy();
    });
    await user.click(screen.getByText(/OP-4521/));

    expect((screen.getByLabelText(/^Cliente/) as HTMLInputElement).value).toBe("Cliente Test");
    expect((screen.getByLabelText(/^Producto/) as HTMLInputElement).value).toBe("Producto Test");
  });

  it("onAssigned se llama con el workItem creado tras un submit exitoso, con el sector correcto en el payload", async () => {
    const user = userEvent.setup();
    let capturedBody: Record<string, unknown> | null = null;
    fetchMock.mockImplementation((url: string, init?: RequestInit) => {
      if (String(url).includes("/api/v1/work-assignments") && init?.method === "POST") {
        capturedBody = JSON.parse(String(init.body));
        return Promise.resolve(
          new Response(JSON.stringify({ ok: true, workItem: { id: "native:wi-1" } }), { status: 200 })
        );
      }
      return Promise.resolve(new Response(JSON.stringify({ items: [] }), { status: 200 }));
    });

    const onAssigned = vi.fn();
    render(<AssignWorkDialog sector="ENVASADO_PREMIUM" onClose={() => {}} onAssigned={onAssigned} />);

    await user.type(screen.getByLabelText(/^Cliente/), "Cliente X");
    await user.type(screen.getByLabelText(/^Producto/), "Producto Y");
    await user.type(screen.getByLabelText(/^Cantidad/), "100");
    await user.click(screen.getByTestId("assign-submit"));

    await waitFor(() => {
      expect(onAssigned).toHaveBeenCalledWith(expect.objectContaining({ id: "native:wi-1" }));
    });
    expect(capturedBody).toMatchObject({ sector: "ENVASADO_PREMIUM", client: "Cliente X", product: "Producto Y" });
  });
});
