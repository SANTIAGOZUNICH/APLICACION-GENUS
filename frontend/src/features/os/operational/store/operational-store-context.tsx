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
import { normalizeOptionalReason } from "@/lib/lifecycle";
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
  /** Resuelve cuando el servidor confirmó la decisión; ok:false si falló (dato local no se pierde). */
  approveQualityItem: (
    itemId: string,
    options: QualityDecisionOptions
  ) => Promise<QualityDecisionAttempt>;
  rejectQualityItem: (
    itemId: string,
    options: QualityDecisionOptions
  ) => Promise<QualityDecisionAttempt>;
  annulQualityItem: (itemId: string, options: QualityAnnulOptions) => Promise<QualityDecisionAttempt>;
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
    payload: { finishedQty: string; observation: string; updatedBy?: string }
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

  const applyQualityDecision = useCallback(
    async (
      itemId: string,
      status: QualityDecisionStatus,
      options: QualityDecisionOptions
    ): Promise<QualityDecisionAttempt> => {
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
        try {
          await postQualityDecision({
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
          });
        } catch (err) {
          return {
            ok: false,
            error:
              err instanceof Error
                ? err.message
                : "No se pudo registrar la decisión en el servidor.",
            code: "SERVER_ERROR",
          };
        }
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
    async (itemId: string, options: QualityAnnulOptions): Promise<QualityDecisionAttempt> => {
      const gate = gateQualityDecision(options.actorSectorId);
      if (!gate.ok) {
        return gate;
      }
      const reason = normalizeOptionalReason(options.reason);

      const previous = readDecisionMap()[itemId];
      recordQualityDecision(itemId, "pendiente", {
        decidedBy: options.actorName,
        decidedBySector: options.actorSectorId,
        decidedByEmail: options.actorEmail,
        observation: previous?.observation,
        changeReason: reason,
      });
      syncFromStorage();
      try {
        await postQualityAnnul({
          itemId,
          reason,
          decidedBy: options.actorName,
          actorSectorId: options.actorSectorId,
        });
      } catch (err) {
        return {
          ok: false,
          error:
            err instanceof Error ? err.message : "No se pudo anular la decisión en el servidor.",
          code: "SERVER_ERROR",
        };
      }
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
      payload: { finishedQty: string; observation: string; updatedBy?: string }
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
