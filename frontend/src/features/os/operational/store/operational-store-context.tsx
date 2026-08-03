"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import type { WorkItem, WorkItemStatus } from "@/types/operational/work-item";
import type { SectorId } from "@/types/operational/sector";
import {
  postCompleteWork,
  postQualityAnnul,
  postQualityDecision,
  postSaveProgress,
} from "@/lib/api/live-sync-client";
import type { CompletionEvent, QualityDecisionStatus, OperationalOverlay, QualityItem } from "../types";
import {
  gateQualityDecision,
  type QualityDecisionAttempt,
} from "../lib/quality-decision-rbac";
import {
  applyWorkProgressToItems,
  getEffectiveQualityStatus,
  getEffectiveWorkStatus,
  getQualityObservation,
  getWorkFinishedQty,
  getWorkObservation,
  readCompletionEvents,
  readDecisionMap,
  readProgressMap,
  recordQualityDecision,
  recordWorkCompletion,
  recordWorkPackaging,
  recordWorkProgress,
  recordSendToCodificado,
  recordDeliverFromCodificado,
  writeCompletionEvents,
  writeDecisionMap,
  writeProgressMap,
  type DecisionMap,
  type ProgressMap,
  type WorkProgressRecord,
} from "./operational-store";

export type QualityDecisionOptions = {
  /** Sector de la sesión activa — obligatorio para RBAC de decisión. */
  actorSectorId: SectorId;
  decidedBy?: string;
  decidedByEmail?: string;
  observation?: string;
  changeReason?: string;
  /** Client snapshot only for server-side approval matching; never authorizes the actor. */
  itemSnapshot?: QualityItem;
};

export type QualityAnnulOptions = {
  reason: string;
  actorSectorId: SectorId;
  actorName?: string;
  actorEmail?: string;
};

interface OperationalStoreValue {
  decisionMap: DecisionMap;
  progressMap: ProgressMap;
  completionEvents: CompletionEvent[];
  revision: number;
  getQualityStatus: (itemId: string, seedStatus: QualityDecisionStatus) => QualityDecisionStatus;
  getQualityObservation: (itemId: string) => string;
  approveQualityItem: (itemId: string, options: QualityDecisionOptions) => QualityDecisionAttempt;
  rejectQualityItem: (itemId: string, options: QualityDecisionOptions) => QualityDecisionAttempt;
  annulQualityItem: (itemId: string, options: QualityAnnulOptions) => QualityDecisionAttempt;
  getWorkStatus: (itemId: string, seedStatus: WorkItemStatus) => WorkItemStatus;
  getFinishedQty: (itemId: string) => string;
  getObservation: (itemId: string) => string;
  saveWorkProgress: (
    itemId: string,
    payload: { finishedQty: string; observation: string; updatedBy?: string; sector?: SectorId }
  ) => void;
  saveWorkPackaging: (
    itemId: string,
    payload: {
      updatedBy?: string;
      sector?: SectorId;
      packagingLote?: string | null;
      packagingVto?: string | null;
      packagingTotalUnits?: number | null;
      packagingCajas?: number | null;
      packagingUnidadesPorCaja?: number | null;
      packingGroups?: Array<{ cajas: number; unidadesPorCaja: number }> | null;
      packingMismatchObservation?: string | null;
      codificadoObservation?: string | null;
    }
  ) => void;
  markWorkFinished: (
    item: WorkItem,
    payload: { finishedQty: string; observation: string; updatedBy?: string }
  ) => void;
  sendToCodificado: (
    item: WorkItem,
    payload: {
      totalUnits: number;
      observation?: string;
      updatedBy?: string;
      bulkRemainderKg?: number | null;
      bulkRemainderObservation?: string | null;
      bulkRemainderId?: string | null;
    }
  ) => { already: boolean; progress: WorkProgressRecord };
  deliverFromCodificado: (
    item: WorkItem,
    payload: {
      updatedBy?: string;
      observation?: string;
      packagingLote?: string | null;
      packagingVto?: string | null;
      packagingTotalUnits?: number | null;
      packagingCajas?: number | null;
      packagingUnidadesPorCaja?: number | null;
      packingGroups?: Array<{ cajas: number; unidadesPorCaja: number }> | null;
      packingMismatchObservation?: string | null;
    }
  ) => { already: boolean; progress: WorkProgressRecord };
  applyProgressToWorkItems: <T extends { id: string; status: WorkItemStatus }>(items: T[]) => T[];
  refreshDecisions: () => void;
  mergeFromServer: (overlay: OperationalOverlay) => void;
}

const OperationalStoreContext = createContext<OperationalStoreValue | null>(null);

const STORAGE_KEYS = [
  "genus_os_operational_decisions",
  "genus_os_work_progress",
  "genus_os_completion_events",
] as const;

export function OperationalStoreProvider({ children }: { children: ReactNode }) {
  const [decisionMap, setDecisionMap] = useState<DecisionMap>({});
  const [progressMap, setProgressMap] = useState<ProgressMap>({});
  const [completionEvents, setCompletionEvents] = useState<CompletionEvent[]>([]);
  const [revision, setRevision] = useState(0);

  const syncFromStorage = useCallback(() => {
    setDecisionMap(readDecisionMap());
    setProgressMap(readProgressMap());
    setCompletionEvents(readCompletionEvents());
    setRevision((v) => v + 1);
  }, []);

  useEffect(() => {
    syncFromStorage();

    const onStorage = (event: StorageEvent) => {
      if (event.key === null || STORAGE_KEYS.includes(event.key as (typeof STORAGE_KEYS)[number])) {
        syncFromStorage();
      }
    };

    window.addEventListener("storage", onStorage);
    return () => window.removeEventListener("storage", onStorage);
  }, [syncFromStorage]);

  const getQualityStatus = useCallback(
    (itemId: string, seedStatus: QualityDecisionStatus) =>
      getEffectiveQualityStatus(itemId, seedStatus),
    [decisionMap]
  );

  const getQualityObs = useCallback(
    (itemId: string) => getQualityObservation(itemId),
    [decisionMap]
  );

  const applyQualityDecision = useCallback(
    (
      itemId: string,
      status: QualityDecisionStatus,
      options: QualityDecisionOptions
    ): QualityDecisionAttempt => {
      const gate = gateQualityDecision(options.actorSectorId);
      if (!gate.ok) {
        return gate;
      }

      recordQualityDecision(itemId, status, {
        decidedBy: options.decidedBy,
        decidedBySector: options.actorSectorId,
        decidedByEmail: options.decidedByEmail,
        observation: options.observation,
        changeReason: options.changeReason,
      });
      syncFromStorage();
      if (status === "aprobado" || status === "rechazado") {
        const item = options.itemSnapshot;
        void postQualityDecision({
          itemId,
          status,
          decidedBy: options.decidedBy,
          observation: options.observation,
          actorSectorId: options.actorSectorId,
          product: item?.product,
          client: item?.client,
          plannedDate: item?.deliveryDate ?? null,
          plannedDateTo: null,
          lote: item?.lote,
          quantity: item?.quantity,
          relatedWorkItemId: item?.relatedWorkItemId,
        }).catch(() => {});
      }
      return { ok: true };
    },
    [syncFromStorage]
  );

  const approveQualityItem = useCallback(
    (itemId: string, options: QualityDecisionOptions) =>
      applyQualityDecision(itemId, "aprobado", options),
    [applyQualityDecision]
  );

  const rejectQualityItem = useCallback(
    (itemId: string, options: QualityDecisionOptions) =>
      applyQualityDecision(itemId, "rechazado", options),
    [applyQualityDecision]
  );

  const annulQualityItem = useCallback(
    (itemId: string, options: QualityAnnulOptions): QualityDecisionAttempt => {
      const gate = gateQualityDecision(options.actorSectorId);
      if (!gate.ok) {
        return gate;
      }
      const reason = options.reason.trim();
      if (!reason) {
        return {
          ok: false,
          error: "Motivo obligatorio para anular la decisión.",
          code: "REASON_REQUIRED",
        };
      }

      const previous = readDecisionMap()[itemId];
      recordQualityDecision(itemId, "pendiente", {
        decidedBy: options.actorName,
        decidedBySector: options.actorSectorId,
        decidedByEmail: options.actorEmail,
        observation: previous?.observation,
        changeReason: reason,
      });
      syncFromStorage();
      void postQualityAnnul({
        itemId,
        reason,
        decidedBy: options.actorName,
        actorSectorId: options.actorSectorId,
      }).catch(() => {});
      return { ok: true };
    },
    [syncFromStorage]
  );

  const getWorkStatus = useCallback(
    (itemId: string, seedStatus: WorkItemStatus) =>
      getEffectiveWorkStatus(itemId, seedStatus),
    [progressMap]
  );

  const getFinishedQty = useCallback(
    (itemId: string) => getWorkFinishedQty(itemId),
    [progressMap]
  );

  const getObservation = useCallback(
    (itemId: string) => getWorkObservation(itemId),
    [progressMap]
  );

  const saveWorkProgress = useCallback(
    (
      itemId: string,
      payload: { finishedQty: string; observation: string; updatedBy?: string; sector?: SectorId }
    ) => {
      recordWorkProgress(itemId, {
        ...payload,
        status: "en_curso",
      });
      syncFromStorage();
      void postSaveProgress({
        itemId,
        sector: payload.sector,
        finishedQty: payload.finishedQty,
        observation: payload.observation,
        updatedBy: payload.updatedBy,
      }).catch(() => {});
    },
    [syncFromStorage]
  );

  const saveWorkPackaging = useCallback(
    (
      itemId: string,
      payload: {
        updatedBy?: string;
        sector?: SectorId;
        packagingLote?: string | null;
        packagingVto?: string | null;
        packagingTotalUnits?: number | null;
        packagingCajas?: number | null;
        packagingUnidadesPorCaja?: number | null;
        packingGroups?: Array<{ cajas: number; unidadesPorCaja: number }> | null;
        packingMismatchObservation?: string | null;
        codificadoObservation?: string | null;
      }
    ) => {
      const record = recordWorkPackaging(itemId, payload);
      syncFromStorage();
      void postSaveProgress({
        itemId,
        sector: payload.sector,
        finishedQty: record.finishedQty,
        observation: record.observation,
        updatedBy: payload.updatedBy,
        packagingLote: record.packagingLote,
        packagingVto: record.packagingVto,
        packagingTotalUnits: record.packagingTotalUnits,
        packagingCajas: record.packagingCajas,
        packagingUnidadesPorCaja: record.packagingUnidadesPorCaja,
        packingGroups: record.packingGroups,
        packingMismatchObservation: record.packingMismatchObservation,
      }).catch(() => {});
    },
    [syncFromStorage]
  );

  const markWorkFinished = useCallback(
    (
      item: WorkItem,
      payload: { finishedQty: string; observation: string; updatedBy?: string }
    ) => {
      const prior = readProgressMap()[item.id];
      const enriched: WorkItem = {
        ...item,
        packagingLote: item.packagingLote ?? prior?.packagingLote ?? null,
        packagingVto: item.packagingVto ?? prior?.packagingVto ?? null,
        packagingTotalUnits:
          item.packagingTotalUnits ?? prior?.packagingTotalUnits ?? null,
        packagingCajas: item.packagingCajas ?? prior?.packagingCajas ?? null,
        packagingUnidadesPorCaja:
          item.packagingUnidadesPorCaja ?? prior?.packagingUnidadesPorCaja ?? null,
        packingGroups: item.packingGroups ?? prior?.packingGroups ?? null,
        packingMismatchObservation:
          item.packingMismatchObservation ??
          prior?.packingMismatchObservation ??
          null,
      };
      recordWorkCompletion(enriched, {
        finishedQty: payload.finishedQty,
        observation: payload.observation,
        completedBy: payload.updatedBy ?? "Operario",
      });
      // Preservar embalaje al marcar revision.
      recordWorkPackaging(enriched.id, {
        updatedBy: payload.updatedBy,
        packagingLote: enriched.packagingLote,
        packagingVto: enriched.packagingVto,
        packagingTotalUnits: enriched.packagingTotalUnits,
        packagingCajas: enriched.packagingCajas,
        packagingUnidadesPorCaja: enriched.packagingUnidadesPorCaja,
        packingGroups: enriched.packingGroups,
        packingMismatchObservation: enriched.packingMismatchObservation,
      });
      syncFromStorage();
      void postCompleteWork({
        item: enriched,
        finishedQty: payload.finishedQty,
        observation: payload.observation,
        completedBy: payload.updatedBy,
      }).catch(() => {});
    },
    [syncFromStorage]
  );

  const sendToCodificado = useCallback(
    (
      item: WorkItem,
      payload: {
        totalUnits: number;
        observation?: string;
        updatedBy?: string;
        bulkRemainderKg?: number | null;
        bulkRemainderObservation?: string | null;
        bulkRemainderId?: string | null;
      }
    ) => {
      const result = recordSendToCodificado(item, {
        totalUnits: payload.totalUnits,
        observation: payload.observation,
        sentBy: payload.updatedBy ?? "Operario",
        bulkRemainderKg: payload.bulkRemainderKg,
        bulkRemainderObservation: payload.bulkRemainderObservation,
        bulkRemainderId: payload.bulkRemainderId,
      });
      syncFromStorage();
      return result;
    },
    [syncFromStorage]
  );

  const deliverFromCodificado = useCallback(
    (
      item: WorkItem,
      payload: {
        updatedBy?: string;
        observation?: string;
        packagingLote?: string | null;
        packagingVto?: string | null;
        packagingTotalUnits?: number | null;
        packagingCajas?: number | null;
        packagingUnidadesPorCaja?: number | null;
        packingGroups?: Array<{ cajas: number; unidadesPorCaja: number }> | null;
        packingMismatchObservation?: string | null;
      }
    ) => {
      const result = recordDeliverFromCodificado(item, {
        completedBy: payload.updatedBy ?? "Codificado",
        observation: payload.observation,
        packagingLote: payload.packagingLote,
        packagingVto: payload.packagingVto,
        packagingTotalUnits: payload.packagingTotalUnits,
        packagingCajas: payload.packagingCajas,
        packagingUnidadesPorCaja: payload.packagingUnidadesPorCaja,
        packingGroups: payload.packingGroups,
        packingMismatchObservation: payload.packingMismatchObservation,
      });
      syncFromStorage();
      if (!result.already) {
        void postCompleteWork({
          item: {
            ...item,
            sector: (result.progress.codificadoOriginSector ||
              item.sector) as WorkItem["sector"],
            packagingLote: result.progress.packagingLote,
            packagingVto: result.progress.packagingVto,
            packagingTotalUnits: result.progress.packagingTotalUnits,
            packagingCajas: result.progress.packagingCajas,
            packagingUnidadesPorCaja: result.progress.packagingUnidadesPorCaja,
            packingGroups: result.progress.packingGroups,
            packingMismatchObservation: result.progress.packingMismatchObservation,
          },
          finishedQty: result.progress.finishedQty,
          observation: result.progress.observation,
          completedBy: payload.updatedBy,
        }).catch(() => {});
      }
      return result;
    },
    [syncFromStorage]
  );

  const applyProgressToWorkItems = useCallback(
    <T extends { id: string; status: WorkItemStatus }>(items: T[]) =>
      applyWorkProgressToItems(items),
    [progressMap]
  );

  const mergeFromServer = useCallback((overlay: OperationalOverlay) => {
    const progressRecords: ProgressMap = { ...readProgressMap() };
    for (const record of Object.values(overlay.progress)) {
      const prev = progressRecords[record.itemId];
      progressRecords[record.itemId] = {
        itemId: record.itemId,
        finishedQty: record.finishedQty,
        observation: record.observation,
        status: record.status as WorkItemStatus | undefined,
        updatedAt: record.updatedAt,
        updatedBy: record.updatedBy,
        completedAt: record.completedAt,
        packagingLote:
          record.packagingLote !== undefined
            ? record.packagingLote
            : prev?.packagingLote ?? null,
        packagingVto:
          record.packagingVto !== undefined
            ? record.packagingVto
            : prev?.packagingVto ?? null,
        packagingTotalUnits:
          record.packagingTotalUnits !== undefined
            ? record.packagingTotalUnits
            : prev?.packagingTotalUnits ?? null,
        packagingCajas:
          record.packagingCajas !== undefined
            ? record.packagingCajas
            : prev?.packagingCajas ?? null,
        packagingUnidadesPorCaja:
          record.packagingUnidadesPorCaja !== undefined
            ? record.packagingUnidadesPorCaja
            : prev?.packagingUnidadesPorCaja ?? null,
        packingGroups:
          record.packingGroups !== undefined
            ? record.packingGroups
            : prev?.packingGroups ?? null,
        packingMismatchObservation:
          record.packingMismatchObservation !== undefined
            ? record.packingMismatchObservation
            : prev?.packingMismatchObservation ?? null,
        sentToCodificadoAt: prev?.sentToCodificadoAt ?? null,
        sentToCodificadoBy: prev?.sentToCodificadoBy ?? null,
        codificadoOriginSector: prev?.codificadoOriginSector ?? null,
        codificadoObservation: prev?.codificadoObservation ?? null,
        viaCodificado: prev?.viaCodificado ?? false,
        deliveredFromCodificadoAt: prev?.deliveredFromCodificadoAt ?? null,
        deliveredFromCodificadoBy: prev?.deliveredFromCodificadoBy ?? null,
        bulkRemainderKg: prev?.bulkRemainderKg ?? null,
        bulkRemainderObservation: prev?.bulkRemainderObservation ?? null,
        bulkRemainderId: prev?.bulkRemainderId ?? null,
      };
    }
    writeProgressMap(progressRecords);

    const decisions: DecisionMap = { ...readDecisionMap(), ...overlay.decisions };
    writeDecisionMap(decisions);

    if (overlay.completions.length > 0) {
      const byWorkItem = new Map(readCompletionEvents().map((e) => [e.workItemId, e]));
      for (const event of overlay.completions) {
        byWorkItem.set(event.workItemId, event);
      }
      writeCompletionEvents([...byWorkItem.values()]);
    }

    syncFromStorage();
  }, [syncFromStorage]);

  const value = useMemo<OperationalStoreValue>(
    () => ({
      decisionMap,
      progressMap,
      completionEvents,
      revision,
      getQualityStatus,
      getQualityObservation: getQualityObs,
      approveQualityItem,
      rejectQualityItem,
      annulQualityItem,
      getWorkStatus,
      getFinishedQty,
      getObservation,
      saveWorkProgress,
      saveWorkPackaging,
      markWorkFinished,
      sendToCodificado,
      deliverFromCodificado,
      applyProgressToWorkItems,
      refreshDecisions: syncFromStorage,
      mergeFromServer,
    }),
    [
      decisionMap,
      progressMap,
      completionEvents,
      revision,
      getQualityStatus,
      getQualityObs,
      approveQualityItem,
      rejectQualityItem,
      annulQualityItem,
      getWorkStatus,
      getFinishedQty,
      getObservation,
      saveWorkProgress,
      saveWorkPackaging,
      markWorkFinished,
      sendToCodificado,
      deliverFromCodificado,
      applyProgressToWorkItems,
      syncFromStorage,
      mergeFromServer,
    ]
  );

  return (
    <OperationalStoreContext.Provider value={value}>{children}</OperationalStoreContext.Provider>
  );
}

export function useOperationalStore(): OperationalStoreValue {
  const ctx = useContext(OperationalStoreContext);
  if (!ctx) {
    throw new Error("useOperationalStore debe usarse dentro de OperationalStoreProvider");
  }
  return ctx;
}
