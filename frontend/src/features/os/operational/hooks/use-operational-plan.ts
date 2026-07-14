"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { SectorId } from "@/types/operational/sector";
import { shouldAcceptLiveSyncUpdate } from "@/lib/live-sync/live-sync-version";
import { loadOperationalPlan } from "../adapters/operational-sheets-adapter";
import { useOperationalStore } from "../store/operational-store-context";
import type { OperationalPlanSnapshot } from "../types";
import { useLiveSync, type LiveSyncSheetUpdate } from "./use-live-sync";

interface UseOperationalPlanOptions {
  ownerPerson?: string | null;
  enabled?: boolean;
  date?: string | null;
  weekStart?: string | null;
}

interface UseOperationalPlanResult {
  data: OperationalPlanSnapshot | null;
  loading: boolean;
  error: string | null;
  lastRefreshAt: Date | null;
  updatedAgoLabel: string;
  liveConnected: boolean;
  refresh: () => void;
}

/** Plan operativo: carga inicial /work-items; Sheet→app vía /check autoritativo. */
export function useOperationalPlan(
  sector: SectorId,
  options?: UseOperationalPlanOptions
): UseOperationalPlanResult {
  const ownerPerson = options?.ownerPerson ?? null;
  const date = options?.date ?? null;
  const weekStart = options?.weekStart ?? null;
  const enabled = options?.enabled ?? true;
  const { revision, mergeFromServer } = useOperationalStore();

  const [data, setData] = useState<OperationalPlanSnapshot | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [lastRefreshAt, setLastRefreshAt] = useState<Date | null>(null);
  const [tick, setTick] = useState(0);
  const mountedRef = useRef(true);
  const appliedRevisionRef = useRef<number | null>(null);
  const appliedVersionRef = useRef<string | null>(null);

  const refresh = useCallback(() => {
    setTick((v) => v + 1);
  }, []);

  const handleSheetUpdate = useCallback(
    (update: LiveSyncSheetUpdate) => {
      if (!mountedRef.current) return;

      appliedRevisionRef.current = update.revision;
      appliedVersionRef.current = update.version;

      setData((prev) => ({
        sector,
        ownerPerson,
        source: "drive",
        scannedAt: update.checkedAt,
        workItems: update.workItems,
        qualityItems: prev?.qualityItems ?? [],
        operationalOverlay: prev?.operationalOverlay,
        message: undefined,
        semanasVersion: update.version,
        revision: update.revision,
      }));
      setLastRefreshAt(new Date(update.checkedAt));
      setError(null);
      setLoading(false);
    },
    [sector, ownerPerson]
  );

  const { connected, updatedAgoLabel } = useLiveSync({
    sector,
    enabled,
    ownerPerson,
    date,
    weekStart,
    onOperationalEvent: refresh,
    onSheetUpdate: handleSheetUpdate,
  });

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  useEffect(() => {
    if (!enabled) return;

    let cancelled = false;

    void (async () => {
      if (tick === 0) setLoading(true);

      try {
        const snapshot = await loadOperationalPlan(sector, {
          ownerPerson,
          date,
          weekStart,
        });
        if (!cancelled && mountedRef.current) {
          // Respuesta stale de otra lambda: no revertir 161→160.
          if (appliedRevisionRef.current != null) {
            if (
              snapshot.revision == null ||
              snapshot.revision < appliedRevisionRef.current
            ) {
              return;
            }
            const accept = shouldAcceptLiveSyncUpdate({
              appliedRevision: appliedRevisionRef.current,
              appliedVersion: appliedVersionRef.current,
              incomingRevision: snapshot.revision,
              incomingVersion: snapshot.semanasVersion ?? "",
            });
            if (!accept) return;
          }

          if (snapshot.revision != null) {
            appliedRevisionRef.current = Math.max(
              appliedRevisionRef.current ?? 0,
              snapshot.revision
            );
          }
          if (snapshot.semanasVersion) {
            appliedVersionRef.current = snapshot.semanasVersion;
          }

          setData(snapshot);
          if (snapshot.operationalOverlay) {
            mergeFromServer(snapshot.operationalOverlay);
          }
          setError(null);
          setLastRefreshAt(new Date(snapshot.scannedAt));
        }
      } catch (err) {
        if (!cancelled && mountedRef.current) {
          setError(err instanceof Error ? err.message : "Error al cargar plan operativo.");
        }
      } finally {
        if (!cancelled && mountedRef.current) setLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [
    sector,
    ownerPerson,
    date,
    weekStart,
    tick,
    enabled,
    revision,
    mergeFromServer,
  ]);

  return {
    data,
    loading,
    error,
    lastRefreshAt,
    updatedAgoLabel,
    liveConnected: connected,
    refresh,
  };
}
