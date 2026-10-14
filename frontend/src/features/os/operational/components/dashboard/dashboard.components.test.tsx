/**
 * @vitest-environment happy-dom
 */
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { computeDashboard, type DashboardComputeContext } from "@/lib/dashboard/compute";
import type { DashboardFilters, DashboardRows, DashboardTarget } from "@/lib/dashboard/types";
import { DashboardBarChart } from "./dashboard-bar-chart";
import { DashboardContent } from "./dashboard-content";
import { DashboardFiltersBar } from "./dashboard-filters";
import { DashboardSemaforo } from "./dashboard-semaforo";

afterEach(() => cleanup());

const NOW = "2026-10-14T15:00:00.000Z";
const F: DashboardFilters = { year: 2026, month: null, sector: "ALL", client: null };
const ctx = (over: Partial<DashboardComputeContext> = {}): DashboardComputeContext => ({
  level: "full",
  sector: "PRODUCCION",
  targets: [],
  generatedAt: NOW,
  lastDataChangeAt: "2026-10-01T12:00:00.000Z",
  targetsSchemaPending: false,
  dataSource: "database",
  ...over,
});

const DATA: DashboardRows = {
  pedidos: [
    { id: "p1", fecha: "2026-03-10", cliente: "E2E Alfa", producto: "Crema", estado: "ENTREGADO", q: 1000 },
    { id: "p2", fecha: "2026-03-12", cliente: "E2E Beta", producto: "Tónico", estado: "EN_ENVASADO", q: 500 },
  ],
  works: [
    { id: "w1", productionSector: "ENVASADO_MASIVO", operationalStatus: "completo", cancelled: false, finishedQty: "900", packagingTotalUnits: null, client: "E2E Alfa", product: "Crema", productionPedidoId: "p1", completedAt: "2026-03-18T12:00:00.000Z" },
    { id: "w2", productionSector: "ENVASADO_PREMIUM", operationalStatus: "completo", cancelled: false, finishedQty: "300", packagingTotalUnits: null, client: "E2E Beta", product: "Tónico", productionPedidoId: null, completedAt: "2026-05-18T12:00:00.000Z" },
  ],
  deliveries: [{ id: "d1", workItemId: "w1", sourceSector: "ENVASADO_MASIVO", client: "E2E Alfa", pedidoId: "p1", actualDeliveredAt: "2026-03-25T12:00:00.000Z", status: "ENTREGADO" }],
};

function renderContent(rows: DashboardRows, c: DashboardComputeContext, filters: DashboardFilters = F, handlers: Partial<React.ComponentProps<typeof DashboardContent>> = {}) {
  const payload = computeDashboard(rows, filters, c);
  const props = { payload, filters, onFiltersChange: vi.fn(), onSaveTarget: vi.fn().mockResolvedValue(undefined), onClearTarget: vi.fn().mockResolvedValue(undefined), ...handlers };
  render(<DashboardContent {...props} />);
  return props;
}

describe("«Sin datos suficientes»", () => {
  it("sin datos reales ninguna tarjeta muestra un número: dice Sin datos suficientes con motivo y qué registrar", () => {
    renderContent({ pedidos: [], works: [], deliveries: [] }, ctx({ lastDataChangeAt: null }));
    for (const id of ["kpi-nivel_servicio", "kpi-sin_reclamos", "kpi-lead_time", "kpi-unidades_producidas", "kpi-pedidos_activos", "kpi-pedidos_entregados", "kpi-pedidos_en_despacho", "kpi-productos_distintos"]) {
      const card = screen.getByTestId(id);
      expect(card.getAttribute("data-has-value")).toBe("0");
      expect(within(card).getByTestId("sin-datos-suficientes").textContent).toMatch(/Sin datos suficientes/);
      expect(within(card).queryByTestId(`${id}-value`)).toBeNull();
    }
    expect(screen.getByTestId("kpi-sin_reclamos").textContent).toMatch(/no registra reclamos/i);
    expect(screen.getByTestId("kpi-sin_reclamos").textContent).toMatch(/Para calcularlo/);
    expect(screen.getByTestId("dashboard-summary").textContent).toMatch(/Sin datos suficientes para generar el resumen/);
    expect(screen.getByTestId("chart-sin-datos")).toBeTruthy();
    expect(screen.getByTestId("dashboard-updated").textContent).toMatch(/sin datos cargados/);
  });

  it("con datos muestra valores, tipo de fecha y período por indicador", () => {
    renderContent(DATA, ctx());
    expect(screen.getByTestId("kpi-unidades_producidas-value").textContent).toBe("1.200");
    expect(screen.getByTestId("kpi-nivel_servicio-value").textContent).toBe("90,0 %");
    expect(screen.getByTestId("kpi-lead_time-value").textContent).toBe("15,0 días");
    const basis = (id: string) => within(screen.getByTestId(id)).getByTestId("kpi-date-basis").textContent;
    expect(basis("kpi-pedidos_activos")).toBe("Fecha de pedido");
    expect(basis("kpi-lead_time")).toBe("Fecha de entrega");
    expect(basis("kpi-unidades_producidas")).toBe("Fecha de producción");
    expect(within(screen.getByTestId("kpi-lead_time")).getByTestId("kpi-period").textContent).toBe("Año 2026");
    expect(screen.getByTestId("dashboard-title").textContent).toBe("Dashboard Operativo");
    expect(screen.getByTestId("dashboard-year").textContent).toBe("Año 2026");
    expect(screen.getByTestId("prod-masivo-share").textContent).toBe("75,0 %");
  });

  it("el criterio de cada tarjeta se despliega y aclara que está pendiente de validar", () => {
    renderContent(DATA, ctx());
    fireEvent.click(screen.getByRole("button", { name: /Ver criterio de Nivel de servicio/ }));
    expect(screen.getByTestId("kpi-nivel_servicio").textContent).toMatch(/pendiente de validar contra la planilla/);
  });
});

describe("semáforo", () => {
  it("sin objetivo: «Sin objetivo definido» (gris), nunca un color inventado", () => {
    renderContent(DATA, ctx());
    const row = screen.getByTestId("indicator-nivel_servicio");
    expect(row.getAttribute("data-light")).toBe("sin_objetivo");
    expect(within(row).getByTestId("dashboard-semaforo").textContent).toBe("Sin objetivo definido");
    expect(within(screen.getByTestId("indicator-nivel_servicio-target")).getByText("Sin objetivo definido")).toBeTruthy();
  });

  it("con objetivo: verde / amarillo / rojo según la regla", () => {
    const targets: DashboardTarget[] = [
      { key: "nivel_servicio", targetValue: 90, direction: "min", unit: "percent", updatedBy: "u", updatedAt: NOW }, // 90 → verde
      { key: "lead_time", targetValue: 14, direction: "max", unit: "days", updatedBy: "u", updatedAt: NOW }, // 15 ≤ 15,4 → amarillo
      { key: "unidades_producidas", targetValue: 5000, direction: "min", unit: "units", updatedBy: "u", updatedAt: NOW }, // 1200 → rojo
    ];
    renderContent(DATA, ctx({ targets }));
    expect(screen.getByTestId("indicator-nivel_servicio").getAttribute("data-light")).toBe("verde");
    expect(screen.getByTestId("indicator-lead_time").getAttribute("data-light")).toBe("amarillo");
    expect(screen.getByTestId("indicator-unidades_producidas").getAttribute("data-light")).toBe("rojo");
    expect(within(screen.getByTestId("indicator-unidades_producidas")).getByTestId("dashboard-semaforo").textContent).toBe("Crítico");
    expect(screen.getByTestId("indicator-sin_reclamos").getAttribute("data-light")).toBe("sin_datos");
  });

  it("el componente de semáforo muestra texto además del color", () => {
    render(<DashboardSemaforo light="amarillo" />);
    expect(screen.getByTestId("dashboard-semaforo").textContent).toBe("Atención");
  });

  it("Producción edita el objetivo desde el propio Dashboard; el resto no ve el editor", async () => {
    const props = renderContent(DATA, ctx());
    fireEvent.click(screen.getByTestId("target-edit-nivel_servicio"));
    fireEvent.change(screen.getByTestId("target-input-nivel_servicio"), { target: { value: "97,5" } });
    fireEvent.change(screen.getByTestId("target-direction-nivel_servicio"), { target: { value: "min" } });
    fireEvent.click(screen.getByTestId("target-save-nivel_servicio"));
    await waitFor(() => expect(props.onSaveTarget).toHaveBeenCalledWith({ key: "nivel_servicio", value: 97.5, direction: "min" }));
    cleanup();
    renderContent(DATA, ctx({ level: "aggregate", sector: "CALIDAD" }));
    expect(screen.queryByTestId("target-edit-unidades_producidas")).toBeNull();
  });

  it("rechaza un objetivo no numérico sin llamar al servidor", async () => {
    const props = renderContent(DATA, ctx());
    fireEvent.click(screen.getByTestId("target-edit-lead_time"));
    fireEvent.change(screen.getByTestId("target-input-lead_time"), { target: { value: "abc" } });
    fireEvent.click(screen.getByTestId("target-save-lead_time"));
    expect((await screen.findByRole("alert")).textContent).toMatch(/Ingresá un número/);
    expect(props.onSaveTarget).not.toHaveBeenCalled();
  });
});

describe("filtros", () => {
  it("año, mes y sector notifican el cambio; cliente solo existe si el servidor lo permite", () => {
    const onChange = vi.fn();
    const payload = computeDashboard(DATA, F, ctx());
    const { rerender } = render(<DashboardFiltersBar filters={F} options={{ ...payload.filterOptions, years: [2026, 2025] }} canFilterClient onChange={onChange} />);
    fireEvent.change(screen.getByTestId("filter-month"), { target: { value: "3" } });
    expect(onChange).toHaveBeenLastCalledWith({ ...F, month: 3 });
    fireEvent.change(screen.getByTestId("filter-sector"), { target: { value: "ENVASADO_PREMIUM" } });
    expect(onChange).toHaveBeenLastCalledWith({ ...F, sector: "ENVASADO_PREMIUM" });
    fireEvent.change(screen.getByTestId("filter-client"), { target: { value: "E2E Beta" } });
    expect(onChange).toHaveBeenLastCalledWith({ ...F, client: "E2E Beta" });
    fireEvent.change(screen.getByTestId("filter-year"), { target: { value: "2025" } });
    expect(onChange).toHaveBeenLastCalledWith({ ...F, year: 2025 });
    rerender(<DashboardFiltersBar filters={F} options={{ years: [2026], clients: [] }} canFilterClient={false} onChange={onChange} />);
    expect(screen.queryByTestId("filter-client")).toBeNull();
    expect(screen.getByTestId("filter-client-unavailable").textContent).toMatch(/solo Producción y Dirección/);
  });

  it("limpiar filtros vuelve a Año completo / Todos, conservando el año", () => {
    const onChange = vi.fn();
    const filters: DashboardFilters = { year: 2026, month: 3, sector: "ENVASADO_MASIVO", client: "E2E Alfa" };
    render(<DashboardFiltersBar filters={filters} options={{ years: [2026], clients: ["E2E Alfa"] }} canFilterClient onChange={onChange} />);
    fireEvent.click(screen.getByTestId("filter-reset"));
    expect(onChange).toHaveBeenCalledWith({ year: 2026, month: null, sector: "ALL", client: null });
  });

  it("el contenido refleja el filtro aplicado en la cabecera", () => {
    renderContent(DATA, ctx(), { year: 2026, month: 3, sector: "ENVASADO_MASIVO", client: null });
    expect(screen.getByTestId("dashboard-period").textContent).toBe("Marzo 2026");
  });
});

describe("permisos en pantalla (el payload ya viene recortado)", () => {
  it("Producción ve ranking y comparación de clientes", () => {
    renderContent(DATA, ctx());
    expect(screen.getByTestId("clients-block")).toBeTruthy();
    expect(screen.getByTestId("clients-ranking").textContent).toMatch(/E2E Alfa/);
    expect(screen.getByTestId("clients-comparison").textContent).toMatch(/E2E Beta/);
  });

  it("Envasado no ve clientes: «No disponible para tu sector» y nada de nombres en el DOM", () => {
    renderContent(DATA, ctx({ level: "aggregate", sector: "ENVASADO_MASIVO" }));
    expect(screen.getByTestId("clients-not-available").textContent).toMatch(/No disponible para tu sector/);
    expect(screen.getAllByTestId("kpi-not-available").length).toBe(3);
    const html = document.body.innerHTML;
    expect(html).not.toMatch(/E2E Alfa/);
    expect(html).not.toMatch(/E2E Beta/);
    expect(screen.getByTestId("prod-masivo").textContent).toMatch(/Tu sector/);
    expect(screen.queryByTestId("filter-client")).toBeNull();
  });
});

describe("gráfico SVG propio", () => {
  const monthly = Array.from({ length: 12 }, (_, i) => ({ month: i + 1, masivo: i === 2 ? 700 : 0, premium: i === 4 ? 300 : 0 }));

  it("es accesible: role=img, etiquetas de valor y tabla equivalente", () => {
    render(<DashboardBarChart data={monthly} selectedMonth={null} sector="ALL" year={2026} />);
    const fig = screen.getByTestId("dashboard-bar-chart");
    const svg = fig.querySelector("svg");
    expect(svg?.getAttribute("role")).toBe("img");
    expect(svg?.getAttribute("aria-label")).toMatch(/Total del año: 1\.000 unidades/);
    expect(fig.textContent).toMatch(/700/);
    expect(fig.textContent).toMatch(/300/);
    const rows = fig.querySelectorAll("table tbody tr");
    expect(rows).toHaveLength(12);
    expect(rows[2].textContent).toMatch(/Marzo700/);
  });

  it("no se mueve el filtro de sector: la otra serie queda atenuada, no oculta", () => {
    render(<DashboardBarChart data={monthly} selectedMonth={3} sector="ENVASADO_MASIVO" year={2026} />);
    expect(screen.getByTestId("dashboard-bar-chart").textContent).toMatch(/300/);
  });
});
