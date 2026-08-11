/**
 * @vitest-environment happy-dom
 */
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { EditAssignmentDialog } from "./edit-assignment-dialog";
import { createTestWorkItem } from "@/lib/__fixtures__/work-item.factory";

const postEditAssignment = vi.fn().mockResolvedValue(new Response(JSON.stringify({ ok: true }), { status: 200 }));
const postUpdateLoteVto = vi.fn().mockResolvedValue(new Response(JSON.stringify({ ok: true }), { status: 200 }));

vi.mock("@/lib/api/live-sync-client", () => ({
  postEditAssignment: (...args: unknown[]) => postEditAssignment(...args),
  postUpdateLoteVto: (...args: unknown[]) => postUpdateLoteVto(...args),
}));

afterEach(() => {
  cleanup();
  postEditAssignment.mockClear();
  postUpdateLoteVto.mockClear();
});

/**
 * Producción edita trabajos de los 4 sectores que gestiona con el MISMO
 * diálogo — solo Lote/VTO cambia de visibilidad (ELABORACION no tiene
 * lote/VTO de envasado).
 */
describe("EditAssignmentDialog — edición unificada por sector", () => {
  it("Elaboración: no muestra la sección Lote/VTO", () => {
    const item = createTestWorkItem({ id: "el-1", sector: "ELABORACION", product: "Crema base" });
    render(
      <EditAssignmentDialog
        item={item}
        actorSectorId="PRODUCCION"
        actorName="Producción"
        onClose={() => {}}
        onSaved={() => {}}
      />
    );
    expect(screen.getByLabelText("Producto")).toBeTruthy();
    expect(screen.queryByText(/Lote \/ VTO/i)).toBeNull();
  });

  it.each(["ENVASADO_MASIVO", "ENVASADO_PREMIUM", "CODIFICADO"] as const)(
    "%s: muestra la sección Lote/VTO",
    (sector) => {
      const item = createTestWorkItem({ id: `s-${sector}`, sector, product: "Producto" });
      render(
        <EditAssignmentDialog
          item={item}
          actorSectorId="PRODUCCION"
          actorName="Producción"
          onClose={() => {}}
          onSaved={() => {}}
        />
      );
      expect(screen.getByText(/Lote \/ VTO/i)).toBeTruthy();
    }
  );

  it("no llama al servidor si no se cambió nada", async () => {
    const user = userEvent.setup();
    const item = createTestWorkItem({ id: "cod-1", sector: "CODIFICADO", product: "Producto" });
    const onSaved = vi.fn();
    render(
      <EditAssignmentDialog
        item={item}
        actorSectorId="PRODUCCION"
        actorName="Producción"
        onClose={() => {}}
        onSaved={onSaved}
      />
    );
    await user.click(screen.getByRole("button", { name: "Guardar cambios" }));
    expect(postEditAssignment).not.toHaveBeenCalled();
    expect(postUpdateLoteVto).not.toHaveBeenCalled();
  });

  it("exige motivo si se edita un campo de planificación (Codificado)", async () => {
    const user = userEvent.setup();
    const item = createTestWorkItem({ id: "cod-2", sector: "CODIFICADO", product: "Producto" });
    render(
      <EditAssignmentDialog
        item={item}
        actorSectorId="PRODUCCION"
        actorName="Producción"
        onClose={() => {}}
        onSaved={() => {}}
      />
    );
    await user.clear(screen.getByLabelText("Cantidad (un.)"));
    await user.type(screen.getByLabelText("Cantidad (un.)"), "150");
    await user.click(screen.getByRole("button", { name: "Guardar cambios" }));
    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toMatch(/motivo/i);
    expect(postEditAssignment).not.toHaveBeenCalled();
  });

  it("edita cantidad de un trabajo de Codificado con motivo — llama al endpoint de asignación, no al de lote/VTO", async () => {
    const user = userEvent.setup();
    const item = createTestWorkItem({ id: "cod-3", sector: "CODIFICADO", product: "Producto", quantity: "100" });
    const onSaved = vi.fn();
    render(
      <EditAssignmentDialog
        item={item}
        actorSectorId="PRODUCCION"
        actorName="Producción"
        onClose={() => {}}
        onSaved={onSaved}
      />
    );
    await user.clear(screen.getByLabelText("Cantidad (un.)"));
    await user.type(screen.getByLabelText("Cantidad (un.)"), "150");
    await user.type(screen.getByLabelText("Motivo de la edición"), "Corrección de cantidad");
    await user.click(screen.getByRole("button", { name: "Guardar cambios" }));

    await waitFor(() => expect(postEditAssignment).toHaveBeenCalledTimes(1));
    expect(postEditAssignment).toHaveBeenCalledWith(
      expect.objectContaining({ itemId: "cod-3", plannedQuantity: "150", reason: "Corrección de cantidad" })
    );
    expect(postUpdateLoteVto).not.toHaveBeenCalled();
    await waitFor(() => expect(onSaved).toHaveBeenCalled());
  });

  it("edita Lote/VTO de Envasado Masivo — llama al endpoint auditado existente, no al de planificación", async () => {
    const user = userEvent.setup();
    const item = createTestWorkItem({
      id: "em-1",
      sector: "ENVASADO_MASIVO",
      product: "Producto",
      packagingLote: "L-OLD",
    });
    render(
      <EditAssignmentDialog
        item={item}
        actorSectorId="PRODUCCION"
        actorName="Producción"
        onClose={() => {}}
        onSaved={() => {}}
      />
    );
    await user.clear(screen.getByLabelText("Lote"));
    await user.type(screen.getByLabelText("Lote"), "L-NEW");
    await user.type(screen.getByLabelText("Motivo de la edición"), "Corrección de lote");
    await user.click(screen.getByRole("button", { name: "Guardar cambios" }));

    await waitFor(() => expect(postUpdateLoteVto).toHaveBeenCalledTimes(1));
    expect(postUpdateLoteVto).toHaveBeenCalledWith(
      expect.objectContaining({ itemId: "em-1", packagingLote: "L-NEW", reason: "Corrección de lote" })
    );
    expect(postEditAssignment).not.toHaveBeenCalled();
  });
});
