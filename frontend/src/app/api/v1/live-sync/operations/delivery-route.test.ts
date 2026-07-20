import { describe, expect, it } from "vitest";
import type { DeliveryRecord } from "@/features/os/operational/adapters/delivery-repository";
import {
  DELIVERY_MUTATION_DENIED_MESSAGE,
  DELIVERY_MUTATION_MISSING_ACTOR_MESSAGE,
  validateDeliveryMutationActor,
} from "@/features/os/operational/lib/delivery-rbac";
import { serverOperationalState } from "@/lib/live-sync/server-operational-state";

function makeDeliveryRecord(
  workItemId: string,
  overrides: Partial<DeliveryRecord> = {}
): DeliveryRecord {
  const now = new Date().toISOString();
  return {
    id: `del-${workItemId}`,
    workItemId,
    qualityItemId: `qc:${workItemId}`,
    product: "Creamy Facial",
    codigo: "PR-120",
    client: "Cliente A",
    lote: "L-CR-001",
    sourceSector: "ELABORACION",
    quantity: "100",
    unit: "kg",
    plannedDeliveryDate: "2026-07-19",
    actualDeliveredAt: now,
    remito: "R-1",
    receivedBy: "Cliente A",
    observations: null,
    status: "ENTREGADO",
    deliveredBy: "Producción",
    deliveredBySector: "PRODUCCION",
    createdAt: now,
    updatedAt: now,
    archived: false,
    ...overrides,
  };
}

describe("live-sync delivery operations", () => {
  it("deliver_work sin actorSectorId responde 403 vía validateDeliveryMutationActor", () => {
    const gate = validateDeliveryMutationActor(undefined);
    expect(gate.ok).toBe(false);
    if (!gate.ok) {
      expect(gate.error).toBe(DELIVERY_MUTATION_MISSING_ACTOR_MESSAGE);
      expect(gate.code).toBe("DELIVERY_MUTATION_MISSING_ACTOR");
    }
  });

  it("deliver_work con CALIDAD responde 403 vía validateDeliveryMutationActor", () => {
    const gate = validateDeliveryMutationActor("CALIDAD");
    expect(gate.ok).toBe(false);
    if (!gate.ok) {
      expect(gate.error).toBe(DELIVERY_MUTATION_DENIED_MESSAGE);
      expect(gate.code).toBe("DELIVERY_MUTATION_FORBIDDEN");
    }
  });

  it("deliver_work con PRODUCCION registra entrega e idempotiza por workItemId", () => {
    const workItemId = `wi-deliver-${Date.now()}`;
    const payload = makeDeliveryRecord(workItemId);

    expect(validateDeliveryMutationActor("PRODUCCION").ok).toBe(true);

    const first = serverOperationalState.deliverWork(payload);
    const second = serverOperationalState.deliverWork({
      ...payload,
      id: `del-other-${workItemId}`,
      remito: "R-2",
    });

    expect(first.status).toBe("ENTREGADO");
    expect(second.id).toBe(first.id);
    expect(second.remito).toBe(first.remito);

    const snapshot = serverOperationalState.snapshot();
    const deliveredForWork = snapshot.deliveries.filter(
      (record) => record.workItemId === workItemId && record.status === "ENTREGADO"
    );
    expect(deliveredForWork).toHaveLength(1);
  });

  it("archive_delivery, restore_delivery, annul_delivery y delete_delivery_record", () => {
    const workItemId = `wi-lifecycle-${Date.now()}`;
    const delivered = serverOperationalState.deliverWork(makeDeliveryRecord(workItemId));

    const archived = serverOperationalState.archiveDelivery(delivered.id, "Producción");
    expect(archived?.archived).toBe(true);

    const restored = serverOperationalState.restoreDelivery(delivered.id);
    expect(restored?.archived).toBe(false);

    const annulled = serverOperationalState.annulDelivery(
      delivered.id,
      "Cliente no recibió",
      "Producción"
    );
    expect(annulled?.status).toBe("ANULADO");

    const reDelivered = serverOperationalState.deliverWork(makeDeliveryRecord(workItemId, { id: delivered.id }));
    expect(reDelivered.status).toBe("ENTREGADO");

    const archivedAgain = serverOperationalState.archiveDelivery(reDelivered.id, "Producción");
    expect(archivedAgain?.archived).toBe(true);

    const deleted = serverOperationalState.deleteDeliveryRecord(reDelivered.id, {
      reason: "Duplicado administrativo",
      actorName: "Producción",
    });
    expect(deleted?.status).toBe("REGISTRO_ELIMINADO");

    const snapshot = serverOperationalState.snapshot();
    expect(snapshot.deliveries.some((record) => record.id === reDelivered.id)).toBe(false);
  });

  it("annul_delivery sobre entrega archivada exige restaurar primero", () => {
    const workItemId = `wi-archived-annul-${Date.now()}`;
    const delivered = serverOperationalState.deliverWork(makeDeliveryRecord(workItemId));

    serverOperationalState.archiveDelivery(delivered.id, "Producción");
    expect(serverOperationalState.annulDelivery(delivered.id, "Error", "Producción")).toBeNull();

    serverOperationalState.restoreDelivery(delivered.id);
    const annulled = serverOperationalState.annulDelivery(delivered.id, "Error", "Producción");
    expect(annulled?.status).toBe("ANULADO");
  });
});
