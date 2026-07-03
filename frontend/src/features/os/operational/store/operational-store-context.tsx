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
import type { QualityDecisionStatus } from "../types";
import {
  getEffectiveQualityStatus,
  readDecisionMap,
  recordQualityDecision,
  type DecisionMap,
} from "./operational-store";

interface OperationalStoreValue {
  decisionMap: DecisionMap;
  revision: number;
  getQualityStatus: (itemId: string, seedStatus: QualityDecisionStatus) => QualityDecisionStatus;
  approveQualityItem: (itemId: string, decidedBy?: string) => void;
  rejectQualityItem: (itemId: string, decidedBy?: string) => void;
  refreshDecisions: () => void;
}

const OperationalStoreContext = createContext<OperationalStoreValue | null>(null);

export function OperationalStoreProvider({ children }: { children: ReactNode }) {
  const [decisionMap, setDecisionMap] = useState<DecisionMap>({});
  const [revision, setRevision] = useState(0);

  const syncFromStorage = useCallback(() => {
    setDecisionMap(readDecisionMap());
    setRevision((v) => v + 1);
  }, []);

  useEffect(() => {
    syncFromStorage();

    const onStorage = (event: StorageEvent) => {
      if (event.key === null || event.key === "genus_os_operational_decisions") {
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

  const applyDecision = useCallback(
    (itemId: string, status: QualityDecisionStatus, decidedBy?: string) => {
      recordQualityDecision(itemId, status, decidedBy);
      syncFromStorage();
    },
    [syncFromStorage]
  );

  const approveQualityItem = useCallback(
    (itemId: string, decidedBy?: string) => applyDecision(itemId, "aprobado", decidedBy),
    [applyDecision]
  );

  const rejectQualityItem = useCallback(
    (itemId: string, decidedBy?: string) => applyDecision(itemId, "rechazado", decidedBy),
    [applyDecision]
  );

  const value = useMemo<OperationalStoreValue>(
    () => ({
      decisionMap,
      revision,
      getQualityStatus,
      approveQualityItem,
      rejectQualityItem,
      refreshDecisions: syncFromStorage,
    }),
    [
      decisionMap,
      revision,
      getQualityStatus,
      approveQualityItem,
      rejectQualityItem,
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
