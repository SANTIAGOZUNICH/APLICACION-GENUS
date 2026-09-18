/**
 * @vitest-environment happy-dom
 */
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DeletedWorkItemsPanel } from "./deleted-work-items-panel";

const fetchMock = vi.fn();

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status });
}

const deletedEntry = {
  item: { id: "native:wi-del", product: "SERUM", client: "NIZA" },
  deletedAt: "2026-09-18T09:00:00.000Z",
  deletedBy: "produccion@x.com",
  deleteReason: "Pedido duplicado",
};

describe("DeletedWorkItemsPanel — Ver eliminados", () => {
  beforeEach(() => {
    fetchMock.mockReset();
    vi.stubGlobal("fetch", fetchMock);
  });

  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it("colapsado por defecto — no carga nada hasta activarse (checkbox)", () => {
    render(<DeletedWorkItemsPanel actorSectorId="PRODUCCION" actorName="Producción" />);
    expect(screen.queryByTestId("deleted-work-items-body")).toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("al activar, muestra los trabajos eliminados con fecha/usuario/motivo", async () => {
    fetchMock.mockImplementation((url: string) => {
      if (url.includes("/api/v1/work-items/deleted")) {
        return Promise.resolve(jsonResponse({ items: [deletedEntry] }));
      }
      return Promise.resolve(jsonResponse({}));
    });
    const user = userEvent.setup();
    render(<DeletedWorkItemsPanel actorSectorId="PRODUCCION" actorName="Producción" />);
    await user.click(screen.getByTestId("deleted-work-items-toggle"));
    await waitFor(() => expect(screen.getByTestId("deleted-work-item-native:wi-del")).toBeTruthy());
    expect(screen.getByTestId("deleted-work-item-native:wi-del").textContent).toContain("Pedido duplicado");
    expect(screen.getByTestId("deleted-work-item-native:wi-del").textContent).toContain("ELIMINADO");
  });

  it("Restaurar llama a la API correcta y refresca la lista", async () => {
    fetchMock.mockImplementation((url: string, init?: RequestInit) => {
      if (url.includes("/api/v1/work-items/deleted")) {
        const called = fetchMock.mock.calls.filter((call: unknown[]) => (call[0] as string).includes("/work-items/deleted")).length;
        return Promise.resolve(jsonResponse({ items: called <= 1 ? [deletedEntry] : [] }));
      }
      if (url.includes("/api/v1/live-sync/operations")) {
        const body = JSON.parse((init?.body as string) ?? "{}");
        expect(body.action).toBe("restore_deleted_work");
        expect(body.itemId).toBe("native:wi-del");
        return Promise.resolve(jsonResponse({ ok: true }));
      }
      return Promise.resolve(jsonResponse({}));
    });
    const user = userEvent.setup();
    render(<DeletedWorkItemsPanel actorSectorId="PRODUCCION" actorName="Producción" />);
    await user.click(screen.getByTestId("deleted-work-items-toggle"));
    await screen.findByTestId("deleted-work-item-native:wi-del");
    await user.click(screen.getByTestId("deleted-work-item-restore-native:wi-del"));
    await waitFor(() => expect(screen.queryByTestId("deleted-work-item-native:wi-del")).toBeNull());
  });
});
