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

  it("1) Envasado Masivo: abre con el sector fijo, sin selector editable, y N° de Pedido visible como primer campo", () => {
    render(<AssignWorkDialog sector="ENVASADO_MASIVO" onClose={() => {}} />);
    expect(screen.getByText("Asignar trabajo — Envasado Masivo")).toBeTruthy();
    expect(screen.getByTestId("assign-sector-locked").textContent).toBe("Envasado Masivo");
    expect(screen.queryByTestId("assign-sector")).toBeNull();
    // Envasado sí tiene selector de Línea.
    expect(screen.getByLabelText("Línea")).toBeTruthy();
    // N° de Pedido es el primer campo visible del form (sección destacada).
    const section = screen.getByTestId("assign-pedido-section");
    expect(section.textContent).toContain("N° de Pedido");
    expect(screen.getByTestId("assign-pedido-search")).toBeTruthy();
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

  it("6) editable: cambiar manualmente Cliente/Producto después de autocompletar y el payload usa los valores editados", async () => {
    const user = userEvent.setup();
    let capturedBody: Record<string, unknown> | null = null;
    fetchMock.mockImplementation((url: string, init?: RequestInit) => {
      const u = String(url);
      if (u.includes("/api/v1/production-pedidos")) {
        return Promise.resolve(
          new Response(
            JSON.stringify({ items: [{ id: "p1", op: "OP-4521", cliente: "Cliente Pedido", producto: "Producto Pedido" }] }),
            { status: 200 }
          )
        );
      }
      if (u.includes("/api/v1/work-assignments") && init?.method === "POST") {
        capturedBody = JSON.parse(String(init.body));
        return Promise.resolve(new Response(JSON.stringify({ ok: true, workItem: { id: "native:wi-2" } }), { status: 200 }));
      }
      return Promise.resolve(new Response(JSON.stringify({ items: [] }), { status: 200 }));
    });

    render(<AssignWorkDialog sector="ENVASADO_MASIVO" onClose={() => {}} />);
    await user.type(screen.getByTestId("assign-pedido-search"), "4521");
    await waitFor(() => expect(screen.getByTestId("assign-pedido-results")).toBeTruthy());
    await user.click(screen.getByText(/OP-4521/));

    const clientInput = screen.getByLabelText(/^Cliente/) as HTMLInputElement;
    const productInput = screen.getByLabelText(/^Producto/) as HTMLInputElement;
    expect(clientInput.disabled).toBe(false);
    expect(productInput.disabled).toBe(false);
    await user.clear(clientInput);
    await user.type(clientInput, "Cliente Editado a Mano");
    await user.clear(productInput);
    await user.type(productInput, "Producto Editado a Mano");
    await user.type(screen.getByLabelText(/^Cantidad/), "50");

    await user.click(screen.getByTestId("assign-submit"));
    await waitFor(() => expect(capturedBody).not.toBeNull());
    expect(capturedBody).toMatchObject({
      client: "Cliente Editado a Mano",
      product: "Producto Editado a Mano",
      productionPedidoId: "p1",
    });
  });

  it("un error real del servidor (500) se muestra visible y NO se confunde con 'Pedido no encontrado'", async () => {
    const user = userEvent.setup();
    fetchMock.mockImplementation((url: string) => {
      if (String(url).includes("/api/v1/production-pedidos")) {
        return Promise.resolve(new Response(JSON.stringify({ error: "DB down" }), { status: 500 }));
      }
      return Promise.resolve(new Response(JSON.stringify({ items: [] }), { status: 200 }));
    });

    render(<AssignWorkDialog sector="ENVASADO_MASIVO" onClose={() => {}} />);
    await user.type(screen.getByTestId("assign-pedido-search"), "4521");

    await waitFor(() => {
      expect(screen.getByTestId("assign-pedido-search-error")).toBeTruthy();
    });
    expect(screen.queryByTestId("assign-pedido-not-found")).toBeNull();
  });

  it("9) reset: cerrar (desmontar) y volver a abrir (montar) no conserva un pedido viejo", async () => {
    const user = userEvent.setup();
    fetchMock.mockImplementation((url: string) => {
      if (String(url).includes("/api/v1/production-pedidos")) {
        return Promise.resolve(
          new Response(JSON.stringify({ items: [{ id: "p1", op: "OP-4521", cliente: "Cliente Viejo", producto: "Producto Viejo" }] }), {
            status: 200,
          })
        );
      }
      return Promise.resolve(new Response(JSON.stringify({ items: [] }), { status: 200 }));
    });

    const { unmount } = render(<AssignWorkDialog sector="ENVASADO_MASIVO" onClose={() => {}} />);
    await user.type(screen.getByTestId("assign-pedido-search"), "4521");
    await waitFor(() => expect(screen.getByTestId("assign-pedido-results")).toBeTruthy());
    await user.click(screen.getByText(/OP-4521/));
    expect(screen.getByText(/Pedido OP-4521/)).toBeTruthy();
    unmount();

    render(<AssignWorkDialog sector="ENVASADO_MASIVO" onClose={() => {}} />);
    expect(screen.queryByText(/Pedido OP-4521/)).toBeNull();
    expect((screen.getByTestId("assign-pedido-search") as HTMLInputElement).value).toBe("");
    expect((screen.getByLabelText(/^Cliente/) as HTMLInputElement).value).toBe("");
  });

  it("scroll interno: el contenido central es scrolleable, header/footer quedan fuera del área de scroll", () => {
    render(<AssignWorkDialog sector="ENVASADO_MASIVO" onClose={() => {}} />);
    const scrollArea = screen.getByTestId("assign-scroll-area");
    expect(scrollArea.className).toContain("overflow-y-auto");
    // N° de Pedido (arriba del scroll) y el botón Asignar (footer fijo) están
    // ambos presentes en el DOM al mismo tiempo — no hace falta scrollear
    // para que React los monte, la limitación real es solo visual (CSS).
    expect(screen.getByTestId("assign-pedido-section")).toBeTruthy();
    expect(screen.getByTestId("assign-submit")).toBeTruthy();
    // El botón Asignar vive fuera del contenedor scrolleable (footer fijo).
    expect(scrollArea.contains(screen.getByTestId("assign-submit"))).toBe(false);
  });

  it("3/4/5) preselección desde el botón + de una celda: fecha, línea y sector vienen del día/línea de origen", () => {
    render(
      <AssignWorkDialog
        sector="ENVASADO_MASIVO"
        onClose={() => {}}
        initialLine="Línea 2"
        initialPlannedDate="2026-08-26"
      />
    );
    expect(screen.getByText("Asignar trabajo — Envasado Masivo")).toBeTruthy();
    expect((screen.getByLabelText("Línea") as HTMLSelectElement).value).toBe("Línea 2");
    expect((screen.getByLabelText(/^Desde/) as HTMLInputElement).value).toBe("2026-08-26");
    expect((screen.getByLabelText(/^Hasta/) as HTMLInputElement).value).toBe("2026-08-26");
    // Sigue editable — no se bloquea el control.
    expect((screen.getByLabelText("Línea") as HTMLSelectElement).disabled).toBe(false);
    expect((screen.getByLabelText(/^Desde/) as HTMLInputElement).disabled).toBe(false);
  });

  it("sin preselección, usa los defaults de siempre (hoy, primera línea)", () => {
    render(<AssignWorkDialog sector="ENVASADO_PREMIUM" onClose={() => {}} />);
    expect((screen.getByLabelText("Línea") as HTMLSelectElement).value).toBe("Línea 1");
  });

  it("7) búsqueda por Cliente: 'TCL' encuentra pedidos de TCL (usa el parámetro search combinado)", async () => {
    const user = userEvent.setup();
    let capturedUrl = "";
    fetchMock.mockImplementation((url: string) => {
      capturedUrl = String(url);
      if (String(url).includes("/api/v1/production-pedidos")) {
        return Promise.resolve(
          new Response(
            JSON.stringify({
              items: [
                { id: "p1", op: "OP-4521", cliente: "TCL", producto: "Shampoo Anticaspa", q: 5000, estado: "INGRESO" },
                { id: "p2", op: "OP-9999", cliente: "TCL", producto: "Acondicionador", q: 3000, estado: "INGRESO" },
              ],
            }),
            { status: 200 }
          )
        );
      }
      return Promise.resolve(new Response(JSON.stringify({}), { status: 200 }));
    });

    render(<AssignWorkDialog sector="ENVASADO_MASIVO" onClose={() => {}} />);
    await user.type(screen.getByTestId("assign-pedido-search"), "TCL");

    await waitFor(() => expect(screen.getByTestId("assign-pedido-results")).toBeTruthy());
    expect(capturedUrl).toContain("/api/v1/production-pedidos?search=TCL");
    expect(screen.getByText(/OP-4521/)).toBeTruthy();
    expect(screen.getByText(/OP-9999/)).toBeTruthy();
  });

  it("8) búsqueda por Producto: 'Shampoo' encuentra el pedido correspondiente", async () => {
    const user = userEvent.setup();
    fetchMock.mockImplementation((url: string) => {
      if (String(url).includes("/api/v1/production-pedidos")) {
        return Promise.resolve(
          new Response(
            JSON.stringify({
              items: [{ id: "p1", op: "OP-4521", cliente: "TCL", producto: "Shampoo Anticaspa", q: 5000 }],
            }),
            { status: 200 }
          )
        );
      }
      return Promise.resolve(new Response(JSON.stringify({}), { status: 200 }));
    });

    render(<AssignWorkDialog sector="ENVASADO_MASIVO" onClose={() => {}} />);
    await user.type(screen.getByTestId("assign-pedido-search"), "Shampoo");
    await waitFor(() => expect(screen.getByTestId("assign-pedido-results")).toBeTruthy());
    expect(screen.getByText(/OP-4521/)).toBeTruthy();
  });

  it("9) Cantidad se autocompleta desde q del pedido para Envasado/Codificado (no inventa si no hay dato)", async () => {
    const user = userEvent.setup();
    fetchMock.mockImplementation((url: string) => {
      if (String(url).includes("/api/v1/production-pedidos")) {
        return Promise.resolve(
          new Response(
            JSON.stringify({
              items: [{ id: "p1", op: "OP-4521", cliente: "TCL", producto: "Shampoo Anticaspa", q: 5000 }],
            }),
            { status: 200 }
          )
        );
      }
      return Promise.resolve(new Response(JSON.stringify({}), { status: 200 }));
    });

    render(<AssignWorkDialog sector="ENVASADO_MASIVO" onClose={() => {}} />);
    await user.type(screen.getByTestId("assign-pedido-search"), "4521");
    await waitFor(() => expect(screen.getByTestId("assign-pedido-results")).toBeTruthy());
    await user.click(screen.getByText(/OP-4521/));

    expect((screen.getByLabelText(/^Cantidad/) as HTMLInputElement).value).toBe("5000");
  });

  it("pedido sin cantidad (q null): Cantidad queda vacía y editable, no se inventa", async () => {
    const user = userEvent.setup();
    fetchMock.mockImplementation((url: string) => {
      if (String(url).includes("/api/v1/production-pedidos")) {
        return Promise.resolve(
          new Response(
            JSON.stringify({
              items: [{ id: "p1", op: "OP-4600", cliente: "Sin Cantidad SA", producto: "Producto X", q: null }],
            }),
            { status: 200 }
          )
        );
      }
      return Promise.resolve(new Response(JSON.stringify({}), { status: 200 }));
    });

    render(<AssignWorkDialog sector="ENVASADO_MASIVO" onClose={() => {}} />);
    await user.type(screen.getByTestId("assign-pedido-search"), "4600");
    await waitFor(() => expect(screen.getByTestId("assign-pedido-results")).toBeTruthy());
    await user.click(screen.getByText(/OP-4600/));

    const qtyInput = screen.getByLabelText(/^Cantidad/) as HTMLInputElement;
    expect(qtyInput.value).toBe("");
    expect(qtyInput.disabled).toBe(false);
  });
});
