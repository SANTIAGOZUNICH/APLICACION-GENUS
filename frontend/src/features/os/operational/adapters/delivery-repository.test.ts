import { beforeEach, describe, expect, it, vi } from "vitest";
import type { SectorId } from "@/types/operational/sector";
import {
  annulDelivery,
  archiveDelivery,
  deleteDeliveryRecord,
  deliverWork,
  getDeliveryByWorkItemId,
  listActiveDeliveries,
  listArchivedDeliveries,
  listDeliveryAudit,
  restoreDelivery,
} from "./delivery-repository";

describe("delivery-repository", () => {
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

  it("entrega un trabajo y no duplica entregas del mismo workItem", () => {
    const first = createDelivery();
    expect(first.ok).toBe(true);
    if (!first.ok) return;

    const second = createDelivery();
    expect(second.ok).toBe(true);
    if (!second.ok) return;
    expect(second.record.id).toBe(first.record.id);
    expect(listActiveDeliveries()).toHaveLength(1);
    expect(getDeliveryByWorkItemId("work-1")?.status).toBe("ENTREGADO");
  });

  it("archiva y restaura entregas", () => {
    const delivered = createDelivery();
    expect(delivered.ok).toBe(true);
    if (!delivered.ok) return;

    const archived = archiveDelivery({
      id: delivered.record.id,
      actorSectorId: "PRODUCCION",
      actorName: "Produccion",
    });
    expect(archived.ok).toBe(true);
    expect(listActiveDeliveries()).toHaveLength(0);
    expect(listArchivedDeliveries()).toHaveLength(1);

    const restored = restoreDelivery({
      id: delivered.record.id,
      actorSectorId: "PRODUCCION",
      actorName: "Produccion",
    });
    expect(restored.ok).toBe(true);
    expect(listActiveDeliveries()).toHaveLength(1);
    expect(listArchivedDeliveries()).toHaveLength(0);
  });

  it("eliminación definitiva requiere archivado y motivo", () => {
    const delivered = createDelivery();
    expect(delivered.ok).toBe(true);
    if (!delivered.ok) return;

    expect(
      deleteDeliveryRecord({
        id: delivered.record.id,
        actorSectorId: "PRODUCCION",
        actorName: "Produccion",
        reason: " ",
      })
    ).toMatchObject({ ok: false, code: "REASON_REQUIRED" });

    expect(
      deleteDeliveryRecord({
        id: delivered.record.id,
        actorSectorId: "PRODUCCION",
        actorName: "Produccion",
        reason: "Error administrativo",
      })
    ).toMatchObject({ ok: false, code: "MUST_ARCHIVE_FIRST" });

    archiveDelivery({
      id: delivered.record.id,
      actorSectorId: "PRODUCCION",
      actorName: "Produccion",
    });
    const deleted = deleteDeliveryRecord({
      id: delivered.record.id,
      actorSectorId: "PRODUCCION",
      actorName: "Produccion",
      reason: "Duplicado",
    });
    expect(deleted.ok).toBe(true);
    expect(listArchivedDeliveries()).toHaveLength(0);
    expect(listDeliveryAudit()[0]).toMatchObject({
      workItemId: "work-1",
      deleteReason: "Duplicado",
    });
  });

  it("anular entrega la quita de entregados y vuelve a pendiente", () => {
    const delivered = createDelivery();
    expect(delivered.ok).toBe(true);
    if (!delivered.ok) return;

    const annulled = annulDelivery({
      id: delivered.record.id,
      actorSectorId: "PRODUCCION",
      actorName: "Produccion",
      reason: "Cliente no recibió",
    });
    expect(annulled.ok).toBe(true);
    if (!annulled.ok) return;
    expect(annulled.record.status).toBe("ANULADO");
    expect(getDeliveryByWorkItemId("work-1")).toBeNull();
    expect(listActiveDeliveries()).toHaveLength(0);
  });

  it("actor faltante falla sin mutar", () => {
    const result = deliverWork({
      actorSectorId: undefined as unknown as SectorId,
      actorName: "Produccion",
      workItemId: "work-1",
      qualityItemId: "quality-1",
      product: "Creamy Facial",
      sourceSector: "ELABORACION",
      actualDeliveredAt: "2026-07-21T10:00:00.000Z",
    });
    expect(result.ok).toBe(false);
    expect(listActiveDeliveries()).toHaveLength(0);
  });

  it("otro sector no puede confirmar entrega", () => {
    const result = createDelivery("CALIDAD");
    expect(result).toMatchObject({ ok: false, code: "DELIVERY_MUTATION_FORBIDDEN" });
    expect(listActiveDeliveries()).toHaveLength(0);
  });

  it("anular entrega archivada exige restaurar primero", () => {
    const delivered = createDelivery();
    expect(delivered.ok).toBe(true);
    if (!delivered.ok) return;

    archiveDelivery({
      id: delivered.record.id,
      actorSectorId: "PRODUCCION",
      actorName: "Produccion",
    });

    expect(
      annulDelivery({
        id: delivered.record.id,
        actorSectorId: "PRODUCCION",
        actorName: "Produccion",
        reason: "Error de carga",
      })
    ).toMatchObject({ ok: false, code: "MUST_RESTORE_FIRST" });

    restoreDelivery({
      id: delivered.record.id,
      actorSectorId: "PRODUCCION",
      actorName: "Produccion",
    });

    const annulled = annulDelivery({
      id: delivered.record.id,
      actorSectorId: "PRODUCCION",
      actorName: "Produccion",
      reason: "Error de carga",
    });
    expect(annulled.ok).toBe(true);
  });
});

function createDelivery(actorSectorId: SectorId = "PRODUCCION") {
  return deliverWork({
    actorSectorId,
    actorName: "Produccion",
    workItemId: "work-1",
    qualityItemId: "quality-1",
    product: "Creamy Facial",
    codigo: "CR-001",
    client: "Cliente",
    lote: "L-1",
    sourceSector: "ELABORACION",
    quantity: "10",
    unit: "kg",
    plannedDeliveryDate: "2026-07-20",
    actualDeliveredAt: "2026-07-21T10:00:00.000Z",
    remito: "R-1",
    receivedBy: "Cliente",
    observations: "OK",
  });
}
