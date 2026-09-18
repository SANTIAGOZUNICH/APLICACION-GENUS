/**
 * @vitest-environment happy-dom
 */
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { WorkItemEditDeleteActions } from "./work-item-edit-delete-actions";
import type { WorkItem } from "@/types/operational/work-item";

const fetchMock = vi.fn();

function baseItem(overrides: Partial<WorkItem> = {}): WorkItem {
  return {
    id: "native:wi-1",
    sector: "ENVASADO_MASIVO",
    ownerSector: "ENVASADO_MASIVO",
    ownerPerson: "Turno A",
    source: "semanas_2026",
    sourceFileId: "genus-os-native",
    sourceSheet: "native_planning",
    sourceRange: null,
    productSourceRange: null,
    quantitySourceRange: null,
    originStage: "ACONDICIONAMIENTO",
    date: "2026-09-14",
    plannedDate: "2026-09-14",
    plannedDateTo: "2026-09-14",
    dateHeaderSourceRange: null,
    dateResolutionMethod: null,
    dayLabel: "Lunes",
    dayOfWeek: "Lunes",
    weekLabel: "Semana 2026-09-14",
    weekStart: "2026-09-14",
    weekId: "week-1",
    client: "NIZA",
    product: "SERUM",
    quantity: "100",
    unit: "u",
    line: "Línea 1",
    lineExpectedInSheet: true,
    deliveryDate: null,
    status: "pendiente",
    priority: 0,
    pedidoRef: null,
    pedidoOp: null,
    oeRef: null,
    oaRef: null,
    loteRef: null,
    notes: "",
    version: 1,
    packagingLote: "G26043",
    packagingVto: "2028-10-31",
    packagingTotalUnits: null,
    packagingCajas: null,
    packagingUnidadesPorCaja: null,
    packingGroups: null,
    packingMismatchObservation: null,
    sampleUnits: null,
    deliverableUnits: null,
    packagingClosedAt: null,
    packagingClosedBy: null,
    actionLabel: "Abrir trabajo",
    href: null,
    confidence: "high",
    createdFrom: "test",
    generatedEntities: [],
    dependsOn: null,
    blockedBy: null,
    unblocks: null,
    ...overrides,
  } as WorkItem;
}

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status });
}

describe("WorkItemEditDeleteActions — Editar/Eliminar trabajo siempre accesibles para Producción", () => {
  beforeEach(() => {
    fetchMock.mockReset();
    vi.stubGlobal("fetch", fetchMock);
  });

  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it("sector sin permiso (Envasado) no ve los botones — solo Producción puede editar/eliminar", () => {
    render(
      <WorkItemEditDeleteActions
        item={baseItem()}
        actorSectorId="ENVASADO_MASIVO"
        actorName="Envasado"
      />
    );
    expect(screen.queryByTestId("work-item-edit-native:wi-1")).toBeNull();
  });

  it("Eliminar sin motivo queda bloqueado — el motivo es obligatorio", async () => {
    fetchMock.mockImplementation((url: string) => {
      if (url.includes("/api/v1/work-items/native%3Awi-1")) {
        return Promise.resolve(jsonResponse({ item: baseItem(), version: 1, deletedAt: null }));
      }
      return Promise.resolve(jsonResponse({}));
    });
    const user = userEvent.setup();
    render(<WorkItemEditDeleteActions item={baseItem()} actorSectorId="PRODUCCION" actorName="Producción" />);
    await user.click(screen.getByTestId("work-item-delete-native:wi-1"));
    const confirmBtn = await screen.findByTestId("work-item-delete-confirm");
    expect((confirmBtn as HTMLButtonElement).disabled).toBe(true);
  });

  it("Eliminar trabajo hace fresh-fetch antes de mostrar el diálogo y manda expectedVersion + motivo al confirmar", async () => {
    fetchMock.mockImplementation((url: string, init?: RequestInit) => {
      if (url.includes("/api/v1/work-items/native%3Awi-1") && (!init || init.method === undefined)) {
        return Promise.resolve(jsonResponse({ item: baseItem({ version: 5 }), version: 5, deletedAt: null }));
      }
      if (url.includes("/api/v1/live-sync/operations")) {
        return Promise.resolve(jsonResponse({ ok: true }));
      }
      return Promise.resolve(jsonResponse({}));
    });
    const onChanged = vi.fn();
    const user = userEvent.setup();
    render(
      <WorkItemEditDeleteActions
        item={baseItem()}
        actorSectorId="PRODUCCION"
        actorName="Producción"
        onChanged={onChanged}
      />
    );
    await user.click(screen.getByTestId("work-item-delete-native:wi-1"));
    await screen.findByTestId("work-item-delete-reason-input");
    await user.type(screen.getByTestId("work-item-delete-reason-input"), "Pedido duplicado");
    await user.click(screen.getByTestId("work-item-delete-confirm"));

    await waitFor(() => expect(onChanged).toHaveBeenCalled());
    const deleteCall = fetchMock.mock.calls.find((call: unknown[]) => (call[0] as string).includes("/api/v1/live-sync/operations"));
    expect(deleteCall).toBeTruthy();
    const body = JSON.parse((deleteCall![1] as RequestInit).body as string);
    expect(body.action).toBe("delete_work");
    expect(body.reason).toBe("Pedido duplicado");
    expect(body.expectedVersion).toBe(5); // versión del fresh-fetch, no la del prop viejo
  });

  it("conflicto de versión (409) al eliminar muestra el aviso específico, no un error genérico", async () => {
    fetchMock.mockImplementation((url: string) => {
      if (url.includes("/api/v1/work-items/native%3Awi-1")) {
        return Promise.resolve(jsonResponse({ item: baseItem(), version: 1, deletedAt: null }));
      }
      if (url.includes("/api/v1/live-sync/operations")) {
        return Promise.resolve(jsonResponse({ error: "conflicto de versión" }, 409));
      }
      return Promise.resolve(jsonResponse({}));
    });
    const user = userEvent.setup();
    render(<WorkItemEditDeleteActions item={baseItem()} actorSectorId="PRODUCCION" actorName="Producción" />);
    await user.click(screen.getByTestId("work-item-delete-native:wi-1"));
    await user.type(await screen.findByTestId("work-item-delete-reason-input"), "Motivo");
    await user.click(screen.getByTestId("work-item-delete-confirm"));
    await waitFor(() => expect(screen.getByText(/modificado mientras lo estabas eliminando/)).toBeTruthy());
  });

  it("Editar abre el diálogo con el WorkItem fresco (fresh-fetch), no el prop viejo pasado por la fila", async () => {
    fetchMock.mockImplementation((url: string) => {
      if (url.includes("/api/v1/work-items/native%3Awi-1")) {
        return Promise.resolve(
          jsonResponse({ item: baseItem({ product: "SERUM ACTUALIZADO", version: 7 }), version: 7, deletedAt: null })
        );
      }
      return Promise.resolve(jsonResponse({}));
    });
    const user = userEvent.setup();
    render(
      <WorkItemEditDeleteActions
        item={baseItem({ product: "SERUM VIEJO EN REACT" })}
        actorSectorId="PRODUCCION"
        actorName="Producción"
      />
    );
    await user.click(screen.getByTestId("work-item-edit-native:wi-1"));
    await waitFor(() => expect(screen.getByDisplayValue("SERUM ACTUALIZADO")).toBeTruthy());
  });
});
