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
import { postCompleteWork, postSaveProgress } from "@/lib/api/live-sync-client";
import type { CompletionEvent, QualityDecisionStatus, OperationalOverlay } from "../types";
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

interface OperationalStoreValue {
  decisionMap: DecisionMap;
  progressMap: ProgressMap;
  completionEvents: CompletionEvent[];
  revision: number;
  /** SOLO LECTURA — decisiones históricas de Calidad (el circuito ya no genera nuevas). */
  getQualityStatus: (itemId: string, seedStatus: QualityDecisionStatus) => QualityDecisionStatus;
  getQualityObservation: (itemId: string) => string;
  getWorkStatus: (itemId: string, seedStatus: WorkItemStatus) => WorkItemStatus;
  getFinishedQty: (itemId: string) => string;
  getObservation: (itemId: string) => string;
  /** Resuelve cuando el servidor confirmó persistencia; rechaza si falló (dato local no se pierde). */
  saveWorkProgress: (
    itemId: string,
    payload: { finishedQty: string; observation: string; updatedBy?: string; sector?: SectorId }
  ) => Promise<void>;
  /** Resuelve cuando el servidor confirmó persistencia; rechaza si falló (dato local no se pierde). */
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
      /** Unidades producidas pero no entregables (PARTE A). */
      sampleUnits?: number | null;
    }
  ) => Promise<void>;
  /** Resuelve cuando el servidor confirmó persistencia; rechaza si falló (dato local no se pierde). */
  markWorkFinished: (
    item: WorkItem,
    payload: {
      finishedQty: string;
      observation: string;
      updatedBy?: string;
      bulkRemainderKg?: number | null;
      bulkRemainderObservation?: string | null;
      bulkRemainderId?: string | null;
    }
  ) => Promise<void>;
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
    ): Promise<void> => {
      recordWorkProgress(itemId, {
        ...payload,
        status: "en_curso",
      });
      syncFromStorage();
      return postSaveProgress({
        itemId,
        sector: payload.sector,
        finishedQty: payload.finishedQty,
        observation: payload.observation,
        updatedBy: payload.updatedBy,
      });
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
        sampleUnits?: number | null;
      }
    ): Promise<void> => {
      const record = recordWorkPackaging(itemId, payload);
      syncFromStorage();
      return postSaveProgress({
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
        sampleUnits: record.sampleUnits,
      });
    },
    [syncFromStorage]
  );

  const markWorkFinished = useCallback(
    (
      item: WorkItem,
      payload: {
        finishedQty: string;
        observation: string;
        updatedBy?: string;
        bulkRemainderKg?: number | null;
        bulkRemainderObservation?: string | null;
        bulkRemainderId?: string | null;
      }
    ): Promise<void> => {
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
      return postCompleteWork({
        item: enriched,
        finishedQty: payload.finishedQty,
        observation: payload.observation,
        completedBy: payload.updatedBy,
        bulkRemainderKg: payload.bulkRemainderKg,
        bulkRemainderObservation: payload.bulkRemainderObservation,
        bulkRemainderId: payload.bulkRemainderId,
      });
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
      // Nota: completedAt/operationalStatus/finishedQty ya quedan persistidos
      // de forma atómica por deliverFromCodificadoDurable (misma transacción
      // que packagingLote/Vto/etc — ver codificado-handoff-service.ts). Antes
      // había acá un POST secundario fire-and-forget (postCompleteWork) que
      // era la única forma en que el work item quedaba visible para la cola
      // de Calidad; si fallaba en silencio, la entrega quedaba "hecha" pero
      // invisible para Calidad. Se eliminó — la transacción del handoff ya
      // cubre esto, esto queda solo como espejo local optimista (UI).
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
