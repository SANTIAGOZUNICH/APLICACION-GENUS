/**
 * @vitest-environment happy-dom
 */
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import type { ScheduledDelivery, ScheduledDeliveryItem } from "@/lib/entregas/types";

const listMock = vi.fn();
const detailMock = vi.fn();
const recoveryMock = vi.fn();
vi.mock("@/lib/entregas/entregas-client", () => ({
  entregasApi: { list: (...a: unknown[]) => listMock(...a), detail: (...a: unknown[]) => detailMock(...a), create: vi.fn(), patch: vi.fn(), recovery: (...a: unknown[]) => recoveryMock(...a) },
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
  recoveryMock.mockReset();
  recoveryMock.mockResolvedValue(null);
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
    // Lo que no se conoce figura como «No registrado» (no se inventa).
    expect(dlg.textContent).toMatch(/No registrado/);
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

  it("lo recuperado de los trabajos: UN solo «FIRMEA» con 3 productos, solo lectura, con origen y fecha real; pie «N históricas · M futuras»", async () => {
    const derivedWork = (id: string, o: Record<string, unknown> = {}) => ({
      linkId: `derived:${id}`, workItemId: id, linkedAt: "", linkedBy: "", client: "FIRMEA", product: id, sector: "ENVASADO_MASIVO", line: "Línea 1", responsible: "Línea 1",
      plannedDate: "2026-10-01", plannedDateTo: null, plannedQuantity: "1000", unit: "un.", deliveryDate: TODAY, packagingLote: "L-9", packagingVto: "10/2028",
      operationalStatus: "completo", finishedQty: "950", orderNumber: "OA-5", notes: null, completedAt: "2026-10-02", realDeliveries: [], deliveredQty: null, deliveredAt: null,
      delivered: false, cancelled: false, snapshot: {}, ...o,
    });
    const ditem = (id: string) => item({ id: `work:${id}`, deliveryId: "derived:x", product: id, quantity: "1000", works: [derivedWork(id)] as never, status: "lista_para_entregar", version: 0 });
    listMock.mockResolvedValue([
      delivery({ id: "derived:desde_trabajo:firmea:x", client: "FIRMEA", origin: "desde_trabajo", version: 0, status: "lista_para_entregar", items: [ditem("CREMA"), ditem("SERUM"), ditem("GEL")] }),
      delivery({
        id: "derived:entrega_registrada:cav:x", client: "CAV", origin: "entrega_registrada", version: 0, status: "entregada",
        items: [item({ id: "work:z:r1", product: "TONICO", status: "entregada", works: [derivedWork("TONICO", { client: "CAV", delivered: true, deliveredQty: 950, deliveredAt: TODAY, completedAt: "2026-09-01" })] as never })],
      }),
    ]);
    recoveryMock.mockResolvedValue({ historicas: { total: 12, sueltas: 10, enEntregaProgramada: 2 }, futuras: { total: 5, sueltas: 4, enEntregaProgramada: 1 }, vencidasSinEntregar: 0, fuera: { entregadoSinFechaReal: 3, sinFechaDeEntrega: 40, canceladosOEliminados: 0 } });
    render(<EntregasView />);
    const chips = await screen.findAllByTestId("entregas-client");
    const dayCell = document.querySelector(`[data-testid='entregas-day'][data-date='${TODAY}']`) as HTMLElement;
    expect(within(dayCell).getAllByTestId("entregas-client").map((c) => c.textContent)).toEqual(["CAV", "FIRMEA"]);
    fireEvent.click(chips.find((c) => c.textContent === "FIRMEA")!);
    const dlg = await screen.findByTestId("entrega-detail");
    expect(within(dlg).getAllByTestId("entrega-item-name").map((n) => n.textContent).sort()).toEqual(["CREMA", "GEL", "SERUM"]);
    expect(within(dlg).getByTestId("entrega-origin").textContent).toBe("Desde trabajo");
    // Solo lectura: sin editar/reprogramar/cancelar/vincular ni historial; no pide detalle al servidor.
    for (const id of ["entrega-edit", "entrega-reschedule-open", "entrega-cancel-open", "entrega-link-open", "entrega-history-toggle"]) expect(within(dlg).queryByTestId(id)).toBeNull();
    expect(detailMock).not.toHaveBeenCalled();
    expect(within(dlg).getAllByTestId("entrega-work-open").length).toBe(3); // enlace al trabajo original
    expect(dlg.textContent).toMatch(/Lista para entregar/);
    expect(dlg.textContent).toMatch(/Fecha de producción/);
    expect(dlg.textContent).toMatch(/Pendiente de entregar/);
    cleanup();

    listMock.mockResolvedValue([delivery({ id: "derived:entrega_registrada:cav:x", client: "CAV", origin: "entrega_registrada", version: 0, status: "entregada", items: [item({ id: "work:z:r1", product: "TONICO", status: "entregada", works: [derivedWork("TONICO", { client: "CAV", delivered: true, deliveredQty: 950, deliveredAt: TODAY, completedAt: "2026-09-01" })] as never })] })]);
    render(<EntregasView />);
    fireEvent.click((await screen.findAllByTestId("entregas-client"))[0]!);
    const dlg2 = await screen.findByTestId("entrega-detail");
    expect(within(dlg2).getByTestId("entrega-origin").textContent).toBe("Entrega registrada");
    expect(within(dlg2).getByTestId("entrega-fecha-real").textContent).toMatch(/\d{2}\/\d{2}\/\d{4}/);
    expect(within(dlg2).getByTestId("entrega-work-completed").textContent).toMatch(/01\/09\/2026/); // fin de producción, distinta de la entrega
    expect(within(dlg2).getAllByTestId("entrega-status").every((e) => e.getAttribute("data-status") === "entregada")).toBe(true);
    cleanup();

    render(<EntregasView />);
    expect((await screen.findByTestId("entregas-recovery-summary")).textContent).toBe("12 históricas · 5 futuras");
    expect(screen.getByTestId("entregas-recovery-detail").textContent).toMatch(/3 entregado\(s\) sin fecha real.*40 vigente\(s\) sin fecha de entrega/);
  });

  it("el mismo cliente con distinta tilde/mayúscula en el mismo día es UNA sola entrada y abre todas sus tarjetas", async () => {
    listMock.mockResolvedValue([
      delivery({ id: "a", client: "Café Martínez", items: [item({ id: "i1", product: "A" })] }),
      delivery({ id: "b", client: "CAFE MARTINEZ", origin: "desde_trabajo", version: 0, items: [item({ id: "i2", product: "B" })] }),
    ]);
    render(<EntregasView />);
    const chips = await screen.findAllByTestId("entregas-client");
    expect(chips.filter((c) => c.closest("[data-testid='entregas-day']")?.getAttribute("data-date") === TODAY && c.closest("[data-testid='entregas-day']"))).toHaveLength(1);
    fireEvent.click(chips[0]!);
    const dlg = await screen.findByTestId("entrega-detail");
    expect(within(dlg).getAllByTestId("entrega-card")).toHaveLength(2);
  });
});
