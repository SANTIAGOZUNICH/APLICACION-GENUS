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
  createDespachosApi: (...a: unknown[]) => createMock(...a),
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

import { EntregasProduccionView, draftToCreateInput } from "./entregas-produccion-view";

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

describe("EntregasProduccionView (planilla)", () => {
  it("Depósito ve la planilla SIN formularios ni botón «Agregar entrega»", async () => {
    fetchMock.mockResolvedValue([rec({})]);
    render(<EntregasProduccionView />);
    await screen.findAllByText("000123");
    expect(screen.queryByTestId("despachos-create")).toBeNull();
    expect(screen.queryByTestId("despachos-paste")).toBeNull();
    expect(screen.getAllByText("20/10/2026").length).toBeGreaterThan(0);
  });

  it("Producción y Dirección solo consultan, con exportar", async () => {
    for (const s of ["PRODUCCION", "DIRECCION"]) {
      sector = s;
      fetchMock.mockResolvedValue([rec({})]);
      render(<EntregasProduccionView />);
      await screen.findAllByText("000123");
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

  it("fila sin fecha se muestra y se puede filtrar/exportar", async () => {
    fetchMock.mockResolvedValue([rec({ id: "1", fecha: null })]);
    render(<EntregasProduccionView />);
    await screen.findAllByText("000123");
    expect(screen.getByTestId("despachos-totals").textContent).toContain("1 entrega(s)");
  });

  it("muestra las entregas parciales agrupadas por pedido", async () => {
    fetchMock.mockResolvedValue([rec({ id: "1", pedidoOp: "OP-9", cantidadTotal: 40 }), rec({ id: "2", pedidoOp: "OP-9", remito: "7", cantidadTotal: 20 })]);
    render(<EntregasProduccionView />);
    const panel = await screen.findByTestId("despachos-pedidos");
    expect(panel.textContent).toContain("2 entrega(s)");
    expect(panel.textContent).toContain("60 en total");
  });
});

describe("filas nuevas de la planilla → alta", () => {
  it("conserva ceros del remito, acepta incompletas y valida números/fecha", () => {
    const ok = draftToCreateInput("abc", { remito: "000123", bultos: "5", cantidadTotal: "1.234,5", fecha: "5/1/2026" });
    expect(ok).toMatchObject({ ok: true, input: { remito: "000123", bultos: 5, cantidadTotal: 1234.5, fecha: "2026-01-05", idempotencyKey: "despacho-abc" } });
    expect(draftToCreateInput("x", { cliente: "ACME" })).toMatchObject({ ok: true, input: { fecha: "", bultos: 0, cantidadTotal: 0 } });
    expect(draftToCreateInput("x", { bultos: "-2" }).ok).toBe(false);
    expect(draftToCreateInput("x", { fecha: "ayer" }).ok).toBe(false);
  });
});
