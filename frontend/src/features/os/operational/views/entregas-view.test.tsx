/**
 * @vitest-environment happy-dom
 */
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import type { ScheduledDelivery, ScheduledDeliveryItem } from "@/lib/entregas/types";

const listMock = vi.fn();
const detailMock = vi.fn();
vi.mock("@/lib/entregas/entregas-client", () => ({
  entregasApi: { list: (...a: unknown[]) => listMock(...a), detail: (...a: unknown[]) => detailMock(...a), create: vi.fn(), patch: vi.fn() },
  EntregasApiError: class extends Error {},
}));
let sector = "PRODUCCION";
vi.mock("@/features/os/session/preview-context", () => ({
  usePreviewSession: () => ({ sectorId: sector }),
  usePreviewContext: () => ({ openWorkItem: vi.fn() }),
}));
vi.mock("@/features/os/shell/twin-shell", () => ({
  TwinShell: ({ children }: { children: React.ReactNode }) => <main>{children}</main>,
}));
vi.mock("@/lib/api/operations-client", () => ({ fetchWorkItems: vi.fn(async () => ({ workItems: [] })) }));

import { EntregasView } from "./entregas-view";

const today = new Date();
const iso = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
const TODAY = iso(today);

const item = (o: Partial<ScheduledDeliveryItem>): ScheduledDeliveryItem => ({
  id: "i", deliveryId: "d", product: "CREMA", quantity: "1000", unit: "un.", sector: "ENVASADO_MASIVO", plannedProductionDate: null, lot: "L-1", vto: "10/2028",
  notes: null, position: 0, version: 1, createdAt: "", updatedAt: "", works: [], status: "programada", ...o,
});
const delivery = (o: Partial<ScheduledDelivery>): ScheduledDelivery => ({
  id: "d", client: "FIRMEA", deliveryDate: TODAY, responsible: null, notes: null, state: "programada", rescheduleCount: 0, version: 1, cancelledAt: null,
  cancelledBy: null, cancelReason: null, createdBy: "p@x", createdAt: "", updatedAt: "", items: [item({})], status: "programada", ...o,
});

beforeEach(() => {
  sector = "PRODUCCION";
  listMock.mockReset();
  detailMock.mockReset();
  detailMock.mockImplementation(async (id: string) => ({ delivery: (await listMock.mock.results[0]!.value).find((d: ScheduledDelivery) => d.id === id), divergences: [], history: [] }));
});
afterEach(cleanup);

describe("EntregasView — calendario mensual", () => {
  it("muestra la grilla lunes→domingo, resalta hoy y SOLO el nombre del cliente en cada fecha (una vez por cliente y día)", async () => {
    listMock.mockResolvedValue([
      delivery({ id: "a", client: "FIRMEA", items: [item({ id: "i1", product: "CREMA" }), item({ id: "i2", product: "SERUM" })] }),
      delivery({ id: "b", client: "FIRMEA", items: [item({ id: "i3", product: "GEL" })] }), // mismo cliente y día: una sola entrada
      delivery({ id: "c", client: "CAV" }),
      delivery({ id: "d", client: "TSU" }),
    ]);
    render(<EntregasView />);
    await screen.findAllByTestId("entregas-client");
    const dayCell = document.querySelector(`[data-testid='entregas-day'][data-date='${TODAY}']`) as HTMLElement;
    expect(dayCell.getAttribute("data-today")).toBe("1");
    const chips = within(dayCell).getAllByTestId("entregas-client").map((c) => c.textContent);
    expect(chips).toEqual(["CAV", "FIRMEA", "TSU"]);
    // Nada de productos, cantidades ni lotes dentro de la celda.
    expect(dayCell.textContent).not.toMatch(/CREMA|SERUM|GEL|1000|L-1|10\/2028/);
    expect(screen.getAllByRole("columnheader").map((h) => h.textContent)).toEqual(["Lun", "Mar", "Mié", "Jue", "Vie", "Sáb", "Dom"]);
    expect(screen.getByTestId("entregas-today-mark")).toBeTruthy();
  });

  it("navega entre meses y vuelve a Hoy", async () => {
    listMock.mockResolvedValue([]);
    render(<EntregasView />);
    await waitFor(() => expect(listMock).toHaveBeenCalledTimes(1));
    const label = () => screen.getByTestId("entregas-month").textContent;
    const start = label();
    fireEvent.click(screen.getByTestId("entregas-next"));
    await waitFor(() => expect(listMock).toHaveBeenCalledTimes(2));
    expect(label()).not.toBe(start);
    fireEvent.click(screen.getByTestId("entregas-prev"));
    fireEvent.click(screen.getByTestId("entregas-prev"));
    await waitFor(() => expect(listMock).toHaveBeenCalledTimes(4));
    expect(label()).not.toBe(start);
    fireEvent.click(screen.getByTestId("entregas-today"));
    await waitFor(() => expect(label()).toBe(start));
  });

  it("al tocar el cliente abre la tarjeta con TODAS sus entregas del día: productos, cantidades, lote, vencimiento y sector", async () => {
    listMock.mockResolvedValue([
      delivery({ id: "a", client: "FIRMEA", responsible: "Ana", notes: "Retira el cliente", items: [item({ id: "i1", product: "CREMA ACLARANTE", quantity: "1.200", lot: "L-77", vto: "03/2028", sector: "ENVASADO_PREMIUM" }), item({ id: "i2", product: "SERUM", quantity: null, lot: null })] }),
      delivery({ id: "b", client: "FIRMEA", items: [item({ id: "i3", product: "GEL" })] }),
    ]);
    render(<EntregasView />);
    const chip = (await screen.findAllByTestId("entregas-client"))[0]!;
    fireEvent.click(chip);
    const dlg = await screen.findByTestId("entrega-detail");
    expect(within(dlg).getAllByTestId("entrega-card")).toHaveLength(2);
    const names = within(dlg).getAllByTestId("entrega-item-name").map((n) => n.textContent);
    expect(names).toEqual(["CREMA ACLARANTE", "SERUM", "GEL"]);
    expect(dlg.textContent).toMatch(/1\.200 un\./);
    expect(dlg.textContent).toMatch(/L-77/);
    expect(dlg.textContent).toMatch(/03\/2028/);
    expect(dlg.textContent).toMatch(/Envasado Premium/);
    expect(dlg.textContent).toMatch(/Ana/);
    expect(dlg.textContent).toMatch(/Retira el cliente/);
    // Lo que no se conoce figura como pendiente (no se inventa).
    expect(dlg.textContent).toMatch(/Pendiente/);
    expect(within(dlg).getAllByTestId("entrega-edit").length).toBeGreaterThan(0);
  });

  it("Producción ve «Nueva entrega»; Depósito consulta sin acciones de edición; un sector sin acceso no ve el calendario", async () => {
    listMock.mockResolvedValue([delivery({ id: "a", client: "FIRMEA" })]);
    render(<EntregasView />);
    expect(await screen.findByTestId("entregas-new")).toBeTruthy();
    cleanup();

    sector = "DEPOSITO";
    listMock.mockResolvedValue([delivery({ id: "a", client: "FIRMEA" })]);
    render(<EntregasView />);
    fireEvent.click((await screen.findAllByTestId("entregas-client"))[0]!);
    const dlg = await screen.findByTestId("entrega-detail");
    expect(screen.queryByTestId("entregas-new")).toBeNull();
    expect(within(dlg).queryByTestId("entrega-edit")).toBeNull();
    expect(within(dlg).queryByTestId("entrega-reschedule-open")).toBeNull();
    expect(within(dlg).queryByTestId("entrega-cancel-open")).toBeNull();
    cleanup();

    sector = "CALIDAD";
    render(<EntregasView />);
    expect(screen.queryByTestId("entregas-view")).toBeNull();
    expect(listMock).toHaveBeenCalledTimes(2); // Calidad no consulta nada
  });

  it("una entrega cancelada se ve tachada y con su motivo; la reprogramada indica cuántas veces", async () => {
    listMock.mockResolvedValue([
      delivery({ id: "a", client: "CAV", state: "cancelada", status: "cancelada", cancelledAt: "2026-10-01T10:00:00.000Z", cancelledBy: "p@x", cancelReason: "Cliente suspendió el pedido" }),
      delivery({ id: "b", client: "TSU", rescheduleCount: 2 }),
    ]);
    render(<EntregasView />);
    const chips = await screen.findAllByTestId("entregas-client");
    expect(chips.find((c) => c.textContent === "CAV")!.className).toMatch(/line-through/);
    fireEvent.click(chips.find((c) => c.textContent === "CAV")!);
    expect((await screen.findByTestId("entrega-cancelled-note")).textContent).toMatch(/Cliente suspendió el pedido/);
    cleanup();
    render(<EntregasView />);
    fireEvent.click((await screen.findAllByTestId("entregas-client")).find((c) => c.textContent === "TSU")!);
    expect((await screen.findByTestId("entrega-reprogramada")).textContent).toMatch(/2 veces/);
  });
});
