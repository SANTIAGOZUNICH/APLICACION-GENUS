import { beforeEach, describe, expect, it, vi } from "vitest";
import type { SectorId } from "@/types/operational/sector";
import type { WorkItem, WorkItemStatus } from "@/types/operational/work-item";
import {
  createManualWorkItem,
  deleteOrCancelManualWorkItem,
  getManualWorkItemMeta,
  listAllManualWorkItems,
  listInactiveManualWorkItems,
  mergeManualWorkItems,
  restoreManualWorkItem,
  type CreateManualWorkItemInput,
} from "./manual-work-items-repository";

const STORAGE_KEY = "genus_os_manual_work_items";

describe("manual-work-items mutations", () => {
  const storage = new Map<string, string>();

  beforeEach(() => {
    storage.clear();
    const localStorageMock = {
      getItem: (key: string) => storage.get(key) ?? null,
      setItem: (key: string, value: string) => {
        storage.set(key, value);
      },
      removeItem: (key: string) => {
        storage.delete(key);
      },
    };
    vi.stubGlobal("localStorage", localStorageMock);
    vi.stubGlobal("window", { localStorage: localStorageMock });
  });

  it("PRODUCCION elimina pendiente y desaparece de listAllManualWorkItems / mergeManualWorkItems", () => {
    const item = createAssignedWork();

    const result = deleteOrCancelManualWorkItem({
      id: item.id,
      actorSectorId: "PRODUCCION",
      actorName: "Produccion",
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.action).toBe("eliminar");
    expect(listAllManualWorkItems().map((work) => work.id)).not.toContain(item.id);
    expect(mergeManualWorkItems(item.sector, []).map((work) => work.id)).not.toContain(item.id);
    expect(getManualWorkItemMeta(item.id)?.deleted).toBe(true);
  });

  it("PRODUCCION cancela en_curso con progreso y queda solo en inactivos", () => {
    const item = setStatus(createAssignedWork(), "en_curso");

    const result = deleteOrCancelManualWorkItem({
      id: item.id,
      actorSectorId: "PRODUCCION",
      actorName: "Produccion",
      cancelReason: "Cliente suspendio pedido",
      hasProgressRecord: true,
      finishedQty: "5",
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.action).toBe("cancelar");
    expect(result.item.status).toBe("cancelado");
    expect(listInactiveManualWorkItems().map((work) => work.id)).toContain(item.id);
    expect(mergeManualWorkItems(item.sector, []).map((work) => work.id)).not.toContain(item.id);
    expect(getManualWorkItemMeta(item.id)?.cancelReason).toBe("Cliente suspendio pedido");
  });

  it("ELABORACION no puede eliminar y no muta", () => {
    const item = createAssignedWork();

    const result = deleteOrCancelManualWorkItem({
      id: item.id,
      actorSectorId: "ELABORACION",
      actorName: "Elaboracion",
    });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.code).toBe("WORK_MUTATION_FORBIDDEN");
    }
    expect(listAllManualWorkItems().map((work) => work.id)).toContain(item.id);
    expect(getManualWorkItemMeta(item.id)?.deleted).toBeUndefined();
  });

  it("ENVASADO_MASIVO no puede eliminar y no muta", () => {
    const item = createAssignedWork({ sector: "ENVASADO_MASIVO", ownerPerson: null, line: "Línea 1" });

    const result = deleteOrCancelManualWorkItem({
      id: item.id,
      actorSectorId: "ENVASADO_MASIVO",
      actorName: "Envasado",
    });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.code).toBe("WORK_MUTATION_FORBIDDEN");
    }
    expect(listAllManualWorkItems().map((work) => work.id)).toContain(item.id);
    expect(getManualWorkItemMeta(item.id)?.deleted).toBeUndefined();
  });

  it("actorSectorId faltante falla sin mutar", () => {
    const item = createAssignedWork();

    const result = deleteOrCancelManualWorkItem({
      id: item.id,
      actorSectorId: undefined as unknown as SectorId,
      actorName: "Sin actor",
    });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.code).toBe("WORK_MUTATION_MISSING_ACTOR");
    }
    expect(listAllManualWorkItems().map((work) => work.id)).toContain(item.id);
  });

  it("completo no se elimina y sigue el camino de archivo", () => {
    const item = setStatus(createAssignedWork(), "completo");

    const result = deleteOrCancelManualWorkItem({
      id: item.id,
      actorSectorId: "PRODUCCION",
      actorName: "Produccion",
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.action).toBe("archivar");
    expect(getManualWorkItemMeta(item.id)?.archived).toBe(true);
    expect(getManualWorkItemMeta(item.id)?.deleted).toBeUndefined();
    expect(mergeManualWorkItems(item.sector, []).map((work) => work.id)).not.toContain(item.id);
  });

  it("no afecta otros trabajos", () => {
    const deleted = createAssignedWork({ product: "Producto a eliminar" });
    const kept = createAssignedWork({ product: "Producto vigente" });

    const result = deleteOrCancelManualWorkItem({
      id: deleted.id,
      actorSectorId: "PRODUCCION",
      actorName: "Produccion",
    });

    expect(result.ok).toBe(true);
    expect(listAllManualWorkItems().map((work) => work.id)).toEqual([kept.id]);
    expect(getManualWorkItemMeta(kept.id)?.deleted).toBeUndefined();
  });

  it("eliminar pendiente y restaurar vuelve a la lista activa", () => {
    const item = createAssignedWork();

    const deleted = deleteOrCancelManualWorkItem({
      id: item.id,
      actorSectorId: "PRODUCCION",
      actorName: "Produccion",
    });
    expect(deleted.ok).toBe(true);
    if (!deleted.ok) return;
    expect(listAllManualWorkItems().map((work) => work.id)).not.toContain(item.id);

    const restored = restoreManualWorkItem({
      id: item.id,
      actorSectorId: "PRODUCCION",
      actorName: "Produccion",
    });
    expect(restored.ok).toBe(true);
    if (!restored.ok) return;
    expect(restored.action).toBe("restaurar");
    expect(listAllManualWorkItems().map((work) => work.id)).toContain(item.id);
    expect(getManualWorkItemMeta(item.id)?.deleted).toBe(false);
  });

  it("cancelar y restaurar vuelve a pendiente activo", () => {
    const item = setStatus(createAssignedWork(), "en_curso");

    const cancelled = deleteOrCancelManualWorkItem({
      id: item.id,
      actorSectorId: "PRODUCCION",
      actorName: "Produccion",
      cancelReason: "Cliente suspendio pedido",
      hasProgressRecord: true,
      finishedQty: "5",
    });
    expect(cancelled.ok).toBe(true);
    if (!cancelled.ok) return;
    expect(cancelled.item.status).toBe("cancelado");
    expect(mergeManualWorkItems(item.sector, []).map((work) => work.id)).not.toContain(item.id);

    const restored = restoreManualWorkItem({
      id: item.id,
      actorSectorId: "PRODUCCION",
      actorName: "Produccion",
    });
    expect(restored.ok).toBe(true);
    if (!restored.ok) return;
    expect(restored.item.status).toBe("pendiente");
    expect(mergeManualWorkItems(item.sector, []).map((work) => work.id)).toContain(item.id);
    expect(getManualWorkItemMeta(item.id)?.cancelReason).toBeUndefined();
  });

  it("conflicto bloquea restaurar si ya existe un trabajo activo similar", () => {
    const original = createAssignedWork({ product: "Producto A", client: "Cliente X" });
    const replacement = createAssignedWork({ product: "Producto A", client: "Cliente X" });

    const deleted = deleteOrCancelManualWorkItem({
      id: original.id,
      actorSectorId: "PRODUCCION",
      actorName: "Produccion",
    });
    expect(deleted.ok).toBe(true);
    if (!deleted.ok) return;

    const restored = restoreManualWorkItem({
      id: original.id,
      actorSectorId: "PRODUCCION",
      actorName: "Produccion",
    });
    expect(restored.ok).toBe(false);
    if (restored.ok) return;
    expect(restored.code).toBe("RESTORE_CONFLICT");
    expect(listAllManualWorkItems().map((work) => work.id)).toContain(replacement.id);
    expect(listAllManualWorkItems().map((work) => work.id)).not.toContain(original.id);
  });
});

function createAssignedWork(overrides: Partial<CreateManualWorkItemInput> = {}): WorkItem {
  const input: CreateManualWorkItemInput = {
    sector: "ELABORACION",
    ownerPerson: "Rama 1",
    line: null,
    client: "Cliente",
    product: "Producto",
    plannedDate: "2026-07-20",
    deliveryDate: "2026-07-21",
    quantity: "10",
    unit: "kg",
    oeRef: "OE-1",
    oaRef: null,
    notes: null,
    assignedBy: "Produccion",
    ...overrides,
  };
  return createManualWorkItem(input);
}

function setStatus(item: WorkItem, status: WorkItemStatus): WorkItem {
  const updated = { ...item, status };
  const items = readStoredItems().map((stored) => (stored.id === item.id ? updated : stored));
  window.localStorage.setItem(STORAGE_KEY, JSON.stringify(items));
  return updated;
}

function readStoredItems(): WorkItem[] {
  const raw = window.localStorage.getItem(STORAGE_KEY);
  return raw ? (JSON.parse(raw) as WorkItem[]) : [];
}
