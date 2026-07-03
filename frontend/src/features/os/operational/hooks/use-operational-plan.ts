"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { SectorId } from "@/types/operational/sector";
import { loadOperationalPlan } from "../adapters/operational-sheets-adapter";
import { useOperationalStore } from "../store/operational-store-context";
import type { OperationalPlanSnapshot } from "../types";
import { OPERATIONAL_POLL_INTERVAL_MS } from "../types";

interface UseOperationalPlanOptions {
  ownerPerson?: string | null;
  pollIntervalMs?: number;
  enabled?: boolean;
}

interface UseOperationalPlanResult {
  data: OperationalPlanSnapshot | null;
  loading: boolean;
  error: string | null;
  lastRefreshAt: Date | null;
  refresh: () => void;
}

/** Plan operativo con polling — preparado para refresco automático. */
export function useOperationalPlan(
  sector: SectorId,
  options?: UseOperationalPlanOptions
): UseOperationalPlanResult {
  const ownerPerson = options?.ownerPerson ?? null;
  const pollIntervalMs = options?.pollIntervalMs ?? OPERATIONAL_POLL_INTERVAL_MS;
  const enabled = options?.enabled ?? true;
  const { revision } = useOperationalStore();

  const [data, setData] = useState<OperationalPlanSnapshot | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [lastRefreshAt, setLastRefreshAt] = useState<Date | null>(null);
  const [tick, setTick] = useState(0);
  const mountedRef = useRef(true);

  const refresh = useCallback(() => {
    setTick((v) => v + 1);
  }, []);

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
        const snapshot = await loadOperationalPlan(sector, { ownerPerson });
        if (!cancelled && mountedRef.current) {
          setData(snapshot);
          setError(null);
          setLastRefreshAt(new Date());
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
  }, [sector, ownerPerson, tick, enabled, revision]);

  useEffect(() => {
    if (!enabled || pollIntervalMs <= 0) return;

    const id = window.setInterval(() => {
      setTick((v) => v + 1);
    }, pollIntervalMs);

    return () => window.clearInterval(id);
  }, [enabled, pollIntervalMs, sector, ownerPerson]);

  return { data, loading, error, lastRefreshAt, refresh };
}
