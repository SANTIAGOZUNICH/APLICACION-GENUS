import { describe, expect, it, beforeEach, vi } from "vitest";
import {
  canDeliverFromCodificado,
  canReopenCodificadoDelivery,
  canSendToCodificado,
  resolveTotalUnitsForCodificado,
} from "./codificado-flow";
import { parseBulkRemainderKg } from "./bulk-remainder";
import {
  clearWorkProgress,
  recordDeliverFromCodificado,
  recordSendToCodificado,
  readProgressMap,
  recordWorkCompletion,
  recordWorkPackaging,
  clearCompletionEvents,
} from "../store/operational-store";
import {
  getGranelByWorkItemId,
  listGranelRemainders,
  upsertGranelFromEnvasado,
  createManualGranel,
  deleteOrAnnulGranel,
} from "../adapters/graneles-repository";
import type { WorkItem } from "@/types/operational/work-item";
import { createSectorWorkItem } from "@/lib/__fixtures__/work-item.factory";

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
    clear: () => storage.clear(),
  };
  vi.stubGlobal("localStorage", localStorageMock);
  vi.stubGlobal("window", { localStorage: localStorageMock });
  clearWorkProgress();
  clearCompletionEvents();
});

function envasadoItem(overrides?: Partial<WorkItem>): WorkItem {
  return createSectorWorkItem("ENVASADO_MASIVO", "wi-cod-1", {
    product: "CREMA FACIAL",
    client: "Cliente X",
    quantity: "1052",
    status: "en_curso",
    packingGroups: null,
    packagingTotalUnits: null,
    ...overrides,
  });
}

describe("codificado-flow", () => {
  it("permite Enviar a Codificado solo con cantidad total (sin cajas)", () => {
    const resolved = resolveTotalUnitsForCodificado({
      packagingTotalUnits: 1052,
      finishedQty: "",
      quantity: "1000",
    });
    expect(resolved.ok).toBe(true);
    if (resolved.ok) expect(resolved.total).toBe(1052);
    expect(canSendToCodificado("en_curso").ok).toBe(true);
  });

  it("no exige packingGroups para enviar", () => {
    const item = envasadoItem({ packingGroups: null, packagingCajas: null });
    const { progress, already } = recordSendToCodificado(item, {
      totalUnits: 1052,
      sentBy: "Operario",
    });
    expect(already).toBe(false);
    expect(progress.status).toBe("en_codificado");
    expect(progress.packagingTotalUnits).toBe(1052);
    expect(progress.packingGroups).toBeNull();
    expect(progress.codificadoOriginSector).toBe("ENVASADO_MASIVO");
  });

  it("conserva packingGroups existentes al enviar", () => {
    const groups = [{ cajas: 10, unidadesPorCaja: 100 }];
    const item = envasadoItem({ packingGroups: groups });
    const { progress } = recordSendToCodificado(item, {
      totalUnits: 1052,
      sentBy: "Op",
    });
    expect(progress.packingGroups).toEqual(groups);
  });

  it("segunda entrega a Codificado es idempotente", () => {
    const item = envasadoItem();
    recordSendToCodificado(item, { totalUnits: 100, sentBy: "A" });
    const second = recordSendToCodificado(
      { ...item, status: "en_codificado" },
      { totalUnits: 200, sentBy: "B" }
    );
    expect(second.already).toBe(true);
    expect(second.progress.packagingTotalUnits).toBe(100);
    expect(canSendToCodificado("en_codificado").ok).toBe(false);
  });

  it("finalizar directo a Calidad sigue creando revision", () => {
    const item = envasadoItem();
    const { progress } = recordWorkCompletion(item, {
      finishedQty: "900",
      observation: "ok",
      completedBy: "Op",
    });
    expect(progress.status).toBe("revision");
  });

  it("Codificado entrega una sola vez a Calidad", () => {
    const item = envasadoItem();
    recordSendToCodificado(item, { totalUnits: 1052, sentBy: "Env" });
    const first = recordDeliverFromCodificado(
      { ...item, status: "en_codificado" },
      { completedBy: "Cod", packagingLote: "L-1", packagingVto: "2027-01-01" }
    );
    expect(first.already).toBe(false);
    expect(first.progress.status).toBe("revision");
    expect(first.progress.viaCodificado).toBe(true);
    expect(first.progress.packagingLote).toBe("L-1");
    const second = recordDeliverFromCodificado(
      { ...item, status: "revision" },
      { completedBy: "Cod" }
    );
    expect(second.already).toBe(true);
    expect(canDeliverFromCodificado("revision").ok).toBe(false);
  });

  it("tarea asignada a CODIFICADO (pendiente) puede entregarse", () => {
    expect(canDeliverFromCodificado("pendiente").ok).toBe(false);
    expect(canDeliverFromCodificado("pendiente", { sector: "CODIFICADO" }).ok).toBe(true);
  });

  it("Codificado entrega con cajas y total finales", () => {
    const item = envasadoItem({ packagingTotalUnits: 1000 });
    recordSendToCodificado(item, { totalUnits: 1000, sentBy: "Env" });
    const groups = [
      { cajas: 8, unidadesPorCaja: 100 },
      { cajas: 2, unidadesPorCaja: 50 },
    ];
    const first = recordDeliverFromCodificado(
      { ...item, status: "en_codificado" },
      {
        completedBy: "Cod",
        packagingLote: "L-FINAL",
        packagingVto: "2027-06-01",
        packagingTotalUnits: 900,
        packingGroups: groups,
      }
    );
    expect(first.already).toBe(false);
    expect(first.progress.packagingTotalUnits).toBe(900);
    expect(first.progress.packagingLote).toBe("L-FINAL");
    expect(first.progress.packingGroups).toEqual(groups);
    expect(first.progress.deliveredFromCodificadoBy).toBe("Cod");
    expect(first.progress.viaCodificado).toBe(true);
  });

  it("save packaging no borra viaCodificado / sentBy", () => {
    const item = envasadoItem();
    recordSendToCodificado(item, { totalUnits: 50, sentBy: "Env" });
    recordWorkPackaging(item.id, {
      packagingLote: "L2",
      packagingVto: "2028-01-01",
      packagingTotalUnits: 48,
      packingGroups: [{ cajas: 4, unidadesPorCaja: 12 }],
    });
    const p = readProgressMap()[item.id];
    expect(p.viaCodificado).toBe(true);
    expect(p.sentToCodificadoBy).toBe("Env");
    expect(p.status).toBe("en_codificado");
    expect(p.packagingLote).toBe("L2");
  });

  it("Premium también puede enviar a Codificado", () => {
    const item = createSectorWorkItem("ENVASADO_PREMIUM", "wi-p", {
      status: "en_curso",
      product: "Serum",
    });
    const { progress } = recordSendToCodificado(item, {
      totalUnits: 50,
      sentBy: "Prem",
    });
    expect(progress.codificadoOriginSector).toBe("ENVASADO_PREMIUM");
  });
});

describe("canReopenCodificadoDelivery — Rehacer entrega", () => {
  const deliveredItem = {
    sector: "CODIFICADO",
    deliveredFromCodificadoAt: "2026-08-10T16:20:00.000Z",
    codificadoCancelledAt: null,
    qualityStatus: "pendiente",
    hasActiveClientDelivery: false,
  };

  it("permite rehacer un trabajo entregado, en Codificado, con Calidad pendiente y sin entrega real", () => {
    expect(canReopenCodificadoDelivery(deliveredItem).ok).toBe(true);
  });

  it("bloquea si el trabajo no está en sector CODIFICADO", () => {
    const result = canReopenCodificadoDelivery({ ...deliveredItem, sector: "ENVASADO_MASIVO" });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe("NOT_IN_CODIFICADO");
  });

  it("bloquea si nunca fue entregado (no hay nada que rehacer)", () => {
    const result = canReopenCodificadoDelivery({ ...deliveredItem, deliveredFromCodificadoAt: null });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe("NOT_DELIVERED");
  });

  it("bloquea si el envío a Codificado fue cancelado", () => {
    const result = canReopenCodificadoDelivery({
      ...deliveredItem,
      codificadoCancelledAt: "2026-08-10T18:00:00.000Z",
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe("HANDOFF_CANCELLED");
  });

  it("bloquea si Calidad ya aprobó — no se auto-corrige la decisión en silencio", () => {
    const result = canReopenCodificadoDelivery({ ...deliveredItem, qualityStatus: "aprobado" });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.code).toBe("QUALITY_DECIDED");
      expect(result.error).toMatch(/anule su decisión/i);
    }
  });

  it("bloquea si Calidad ya rechazó", () => {
    const result = canReopenCodificadoDelivery({ ...deliveredItem, qualityStatus: "rechazado" });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe("QUALITY_DECIDED");
  });

  it("bloquea si ya existe una entrega real a cliente en work_item_deliveries", () => {
    const result = canReopenCodificadoDelivery({ ...deliveredItem, hasActiveClientDelivery: true });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe("ALREADY_DELIVERED_TO_CLIENT");
  });
});

describe("bulk remainder / graneles", () => {
  it("parsea coma/punto y rechaza negativos; vacío (no informado) != 0 (confirmado sin sobrante)", () => {
    expect(parseBulkRemainderKg("")).toEqual({ ok: true, kg: null });
    // "0" tipeado explícitamente se preserva — no colapsa a null (H, AUDIT_TRAZABILIDAD).
    expect(parseBulkRemainderKg("0")).toEqual({ ok: true, kg: 0 });
    expect(parseBulkRemainderKg("12,5")).toEqual({ ok: true, kg: 12.5 });
    expect(parseBulkRemainderKg("12.5").ok && (parseBulkRemainderKg("12.5") as { kg: number }).kg).toBe(
      12.5
    );
    expect(parseBulkRemainderKg("-1").ok).toBe(false);
  });

  it("12,5 kg crea un registro; repetición no duplica", () => {
    const a = upsertGranelFromEnvasado({
      workItemId: "wi-1",
      originSector: "ENVASADO_MASIVO",
      product: "CREMA FACIAL",
      client: "Cliente X",
      bulkLot: "G-1",
      kg: 12.5,
      reportedBy: "Op",
      actorSector: "ENVASADO_MASIVO",
    });
    expect(a.created).toBe(true);
    const b = upsertGranelFromEnvasado({
      workItemId: "wi-1",
      originSector: "ENVASADO_MASIVO",
      product: "CREMA FACIAL",
      client: "Cliente X",
      bulkLot: "G-1",
      kg: 12.5,
      reportedBy: "Op",
      actorSector: "ENVASADO_MASIVO",
    });
    expect(b.duplicated).toBe(true);
    expect(listGranelRemainders().length).toBe(1);
  });

  it("segundo reporte desde Envasado no reescribe kg (una sola vez)", () => {
    upsertGranelFromEnvasado({
      workItemId: "wi-2",
      originSector: "ENVASADO_MASIVO",
      product: "P",
      client: "C",
      bulkLot: "L",
      kg: 10,
      reportedBy: "Op",
      actorSector: "ENVASADO_MASIVO",
    });
    const next = upsertGranelFromEnvasado({
      workItemId: "wi-2",
      originSector: "ENVASADO_MASIVO",
      product: "P",
      client: "C",
      bulkLot: "L",
      kg: 8,
      reportedBy: "Op",
      actorSector: "ENVASADO_MASIVO",
    });
    expect(next.created).toBe(false);
    expect(next.duplicated).toBe(true);
    expect(getGranelByWorkItemId("wi-2")?.kgAvailable).toBe(10);
  });

  it("Depósito puede crear manual; otro sector no", () => {
    const ok = createManualGranel({
      actorSector: "DEPOSITO",
      actorName: "Dep",
      product: "Granel",
      kg: 3,
    });
    expect(ok.ok).toBe(true);
    const deny = createManualGranel({
      actorSector: "PRODUCCION",
      actorName: "Prod",
      kg: 1,
    });
    expect(deny.ok).toBe(false);
  });

  it("eliminar manual borrador vs anular originado en envasado", () => {
    const manual = createManualGranel({
      actorSector: "DEPOSITO",
      actorName: "Dep",
      kg: 1,
      asDraft: true,
    });
    expect(manual.ok).toBe(true);
    if (!manual.ok) return;
    const del = deleteOrAnnulGranel({
      id: manual.record.id,
      actorSector: "DEPOSITO",
      actorName: "Dep",
      reason: "prueba",
    });
    expect(del).toEqual({ ok: true, action: "eliminar" });

    const fromEnv = upsertGranelFromEnvasado({
      workItemId: "wi-3",
      originSector: "ENVASADO_MASIVO",
      product: "P",
      client: "C",
      bulkLot: "L",
      kg: 5,
      reportedBy: "Op",
      actorSector: "ENVASADO_MASIVO",
    });
    const annul = deleteOrAnnulGranel({
      id: fromEnv.record.id,
      actorSector: "DEPOSITO",
      actorName: "Dep",
      reason: "error carga",
    });
    expect(annul).toEqual({ ok: true, action: "anular" });
  });
});

describe("mismo workItemId", () => {
  it("conserva id a lo largo del flujo Codificado", () => {
    const item = envasadoItem({ id: "same-id-42" });
    const sent = recordSendToCodificado(item, { totalUnits: 10, sentBy: "A" });
    expect(sent.progress.itemId).toBe("same-id-42");
    const delivered = recordDeliverFromCodificado(
      { ...item, status: "en_codificado" },
      { completedBy: "B", packagingLote: "L", packagingVto: "2028-01-01" }
    );
    expect(delivered.progress.itemId).toBe("same-id-42");
    expect(delivered.progress.status).toBe("revision");
    expect(readProgressMap()["same-id-42"]?.status).toBe("revision");
  });
});
