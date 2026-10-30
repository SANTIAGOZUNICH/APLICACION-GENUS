/**
 * @vitest-environment happy-dom
 */
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { DespachoRecord } from "@/lib/despachos/types";

const fetchMock = vi.fn();
const createMock = vi.fn();
vi.mock("@/lib/despachos/despachos-client", () => ({
  fetchDespachosApi: (...a: unknown[]) => fetchMock(...a),
  createDespachoApi: (...a: unknown[]) => createMock(...a),
  createDespachosApi: vi.fn(),
  patchDespachoCellsApi: vi.fn(),
  bulkDeleteDespachosApi: vi.fn(),
  fetchDespachoHistoryApi: vi.fn(async () => []),
}));
let sector = "DEPOSITO";
vi.mock("@/features/os/session/preview-context", () => ({
  usePreviewSession: () => ({ sectorId: sector, email: "x@x.com" }),
  usePreviewContext: () => ({ showToast: vi.fn() }),
}));
vi.mock("@/features/os/shell/twin-shell", () => ({
  TwinShell: ({ children }: { children: React.ReactNode }) => <main>{children}</main>,
}));

import { EntregasProduccionView } from "./entregas-produccion-view";

const rec = (o: Partial<DespachoRecord>): DespachoRecord => ({
  id: "1", fecha: "2026-10-20", remito: "000123", cliente: "ACME", producto: "Crema", bultos: 3, cantidadTotal: 60, pedidoOp: "",
  createdBy: "Depósito", createdBySector: "DEPOSITO", createdAt: "2026-10-20T10:00:00.000Z", updatedBy: null, updatedAt: "2026-10-20T10:00:00.000Z", ...o,
});

beforeEach(() => {
  sector = "DEPOSITO";
  fetchMock.mockReset();
  createMock.mockReset();
});
afterEach(cleanup);

describe("EntregasProduccionView", () => {
  it("Depósito ve «+ Agregar entrega», fecha DD/MM/AAAA y remito con ceros", async () => {
    fetchMock.mockResolvedValue([rec({})]);
    render(<EntregasProduccionView />);
    await screen.findAllByText("000123");
    expect(screen.getByTestId("despachos-create").textContent).toContain("+ Agregar entrega");
    expect(screen.getAllByText("20/10/2026").length).toBeGreaterThan(0);
    expect(screen.getByTestId("despachos-paste")).toBeTruthy();
  });

  it("Producción y Dirección solo consultan: sin alta ni pegado, con exportar", async () => {
    for (const s of ["PRODUCCION", "DIRECCION"]) {
      sector = s;
      fetchMock.mockResolvedValue([rec({})]);
      render(<EntregasProduccionView />);
      await screen.findAllByText("000123");
      expect(screen.queryByTestId("despachos-create")).toBeNull();
      expect(screen.queryByTestId("despachos-paste")).toBeNull();
      expect(screen.getByTestId("despachos-export")).toBeTruthy();
      cleanup();
    }
  });

  it("filtra por cliente y por remito", async () => {
    fetchMock.mockResolvedValue([rec({ id: "1" }), rec({ id: "2", cliente: "Beta", remito: "0099", producto: "Gel" })]);
    render(<EntregasProduccionView />);
    await screen.findAllByText("000123");
    fireEvent.change(screen.getByTestId("despachos-f-cliente"), { target: { value: "beta" } });
    await waitFor(() => expect(screen.getByTestId("despachos-totals").textContent).toContain("1 entrega(s)"));
    fireEvent.change(screen.getByTestId("despachos-f-cliente"), { target: { value: "" } });
    fireEvent.change(screen.getByTestId("despachos-f-remito"), { target: { value: "000123" } });
    await waitFor(() => expect(screen.getByTestId("despachos-totals").textContent).toContain("1 entrega(s)"));
  });

  it("muestra las entregas parciales agrupadas por pedido", async () => {
    fetchMock.mockResolvedValue([rec({ id: "1", pedidoOp: "OP-9", cantidadTotal: 40 }), rec({ id: "2", pedidoOp: "OP-9", remito: "7", cantidadTotal: 20 })]);
    render(<EntregasProduccionView />);
    const panel = await screen.findByTestId("despachos-pedidos");
    expect(panel.textContent).toContain("OP-9");
    expect(panel.textContent).toContain("2 entrega(s)");
    expect(panel.textContent).toContain("60 en total");
  });

  it("alta: usa una clave de idempotencia y un doble clic no envía dos altas", async () => {
    fetchMock.mockResolvedValue([]);
    let release: (v: unknown) => void = () => undefined;
    createMock.mockImplementation(() => new Promise((r) => { release = r; }));
    render(<EntregasProduccionView />);
    await screen.findByTestId("despachos-empty");
    fireEvent.click(screen.getByTestId("despachos-create"));
    fireEvent.change(await screen.findByTestId("despachos-form-remito"), { target: { value: "00045" } });
    fireEvent.change(screen.getByTestId("despachos-form-cantidadTotal"), { target: { value: "12" } });
    fireEvent.click(screen.getByTestId("despachos-save"));
    fireEvent.click(screen.getByTestId("despachos-save"));
    expect(createMock).toHaveBeenCalledTimes(1);
    const sent = createMock.mock.calls[0]![1] as { remito: string; idempotencyKey: string; cantidadTotal: number };
    expect(sent.remito).toBe("00045");
    expect(sent.cantidadTotal).toBe(12);
    expect(sent.idempotencyKey).toMatch(/^despacho-/);
    release({ record: rec({}), created: true });
  });
});
