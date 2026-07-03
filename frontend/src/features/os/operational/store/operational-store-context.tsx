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
import type { WorkItemStatus } from "@/types/operational/work-item";
import type { QualityDecisionStatus } from "../types";
import {
  applyWorkProgressToItems,
  getEffectiveQualityStatus,
  getEffectiveWorkStatus,
  getQualityObservation,
  getWorkFinishedQty,
  getWorkObservation,
  readDecisionMap,
  readProgressMap,
  recordQualityDecision,
  recordWorkProgress,
  type DecisionMap,
  type ProgressMap,
} from "./operational-store";

interface OperationalStoreValue {
  decisionMap: DecisionMap;
  progressMap: ProgressMap;
  revision: number;
  getQualityStatus: (itemId: string, seedStatus: QualityDecisionStatus) => QualityDecisionStatus;
  getQualityObservation: (itemId: string) => string;
  approveQualityItem: (itemId: string, options?: { decidedBy?: string; observation?: string }) => void;
  rejectQualityItem: (itemId: string, options?: { decidedBy?: string; observation?: string }) => void;
  getWorkStatus: (itemId: string, seedStatus: WorkItemStatus) => WorkItemStatus;
  getFinishedQty: (itemId: string) => string;
  getObservation: (itemId: string) => string;
  saveWorkProgress: (
    itemId: string,
    payload: { finishedQty: string; observation: string; updatedBy?: string }
  ) => void;
  markWorkFinished: (
    itemId: string,
    payload: { finishedQty: string; observation: string; updatedBy?: string }
  ) => void;
  applyProgressToWorkItems: <T extends { id: string; status: WorkItemStatus }>(items: T[]) => T[];
  refreshDecisions: () => void;
}

const OperationalStoreContext = createContext<OperationalStoreValue | null>(null);

export function OperationalStoreProvider({ children }: { children: ReactNode }) {
  const [decisionMap, setDecisionMap] = useState<DecisionMap>({});
  const [progressMap, setProgressMap] = useState<ProgressMap>({});
  const [revision, setRevision] = useState(0);

  const syncFromStorage = useCallback(() => {
    setDecisionMap(readDecisionMap());
    setProgressMap(readProgressMap());
    setRevision((v) => v + 1);
  }, []);

  useEffect(() => {
    syncFromStorage();

    const onStorage = (event: StorageEvent) => {
      if (
        event.key === null ||
        event.key === "genus_os_operational_decisions" ||
        event.key === "genus_os_work_progress"
      ) {
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
      options?: { decidedBy?: string; observation?: string }
    ) => {
      recordQualityDecision(itemId, status, options);
      syncFromStorage();
    },
    [syncFromStorage]
  );

  const approveQualityItem = useCallback(
    (itemId: string, options?: { decidedBy?: string; observation?: string }) =>
      applyQualityDecision(itemId, "aprobado", options),
    [applyQualityDecision]
  );

  const rejectQualityItem = useCallback(
    (itemId: string, options?: { decidedBy?: string; observation?: string }) =>
      applyQualityDecision(itemId, "rechazado", options),
    [applyQualityDecision]
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
      payload: { finishedQty: string; observation: string; updatedBy?: string }
    ) => {
      recordWorkProgress(itemId, {
        ...payload,
        status: "en_curso",
      });
      syncFromStorage();
    },
    [syncFromStorage]
  );

  const markWorkFinished = useCallback(
    (
      itemId: string,
      payload: { finishedQty: string; observation: string; updatedBy?: string }
    ) => {
      recordWorkProgress(itemId, {
        ...payload,
        status: "completo",
      });
      syncFromStorage();
    },
    [syncFromStorage]
  );

  const applyProgressToWorkItems = useCallback(
    <T extends { id: string; status: WorkItemStatus }>(items: T[]) =>
      applyWorkProgressToItems(items),
    [progressMap]
  );

  const value = useMemo<OperationalStoreValue>(
    () => ({
      decisionMap,
      progressMap,
      revision,
      getQualityStatus,
      getQualityObservation: getQualityObs,
      approveQualityItem,
      rejectQualityItem,
      getWorkStatus,
      getFinishedQty,
      getObservation,
      saveWorkProgress,
      markWorkFinished,
      applyProgressToWorkItems,
      refreshDecisions: syncFromStorage,
    }),
    [
      decisionMap,
      progressMap,
      revision,
      getQualityStatus,
      getQualityObs,
      approveQualityItem,
      rejectQualityItem,
      getWorkStatus,
      getFinishedQty,
      getObservation,
      saveWorkProgress,
      markWorkFinished,
      applyProgressToWorkItems,
      syncFromStorage,
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
