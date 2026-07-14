"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { SectorId } from "@/types/operational/sector";
import { loadOperationalPlan } from "../adapters/operational-sheets-adapter";
import { useOperationalStore } from "../store/operational-store-context";
import type { OperationalPlanSnapshot } from "../types";
import { useLiveSync } from "./use-live-sync";

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

/** Plan operativo con Live Sync — SSE en lugar de polling cada 30s. */
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

  const refresh = useCallback(() => {
    setTick((v) => v + 1);
  }, []);

  const { connected, updatedAgoLabel, revision: syncRevision } = useLiveSync({
    sector,
    enabled,
    onUpdate: refresh,
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
    syncRevision,
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
