"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { formatUpdatedAgo, secondsSince } from "@/lib/api/live-sync-client";
import type { WeeklyPlanItemDto } from "@/lib/planning/weekly-plan-dto";
import type { PlanningSector } from "@/lib/planning/types";

const POLL_MS = 20_000;

export type PlanSectorFilter = "ALL" | PlanningSector;

interface UseSharedWeeklyPlanOptions {
  weekStart: string;
  planSector: PlanSectorFilter;
  enabled?: boolean;
}

interface UseSharedWeeklyPlanResult {
  items: WeeklyPlanItemDto[];
  uniqueCount: number;
  loading: boolean;
  error: string | null;
  lastSuccessAt: Date | null;
  updatedAgoLabel: string;
  refresh: () => void;
  allowedSectors: PlanningSector[];
}

interface WeeklyPlansResponse {
  items?: WeeklyPlanItemDto[];
  uniqueCount?: number;
  allowedSectors?: PlanningSector[];
  scannedAt?: string;
  error?: string;
}

export function useSharedWeeklyPlan({
  weekStart,
  planSector,
  enabled = true,
}: UseSharedWeeklyPlanOptions): UseSharedWeeklyPlanResult {
  const [items, setItems] = useState<WeeklyPlanItemDto[]>([]);
  const [uniqueCount, setUniqueCount] = useState(0);
  const [allowedSectors, setAllowedSectors] = useState<PlanningSector[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [lastSuccessAt, setLastSuccessAt] = useState<Date | null>(null);
  const [tick, setTick] = useState(0);
  const [clock, setClock] = useState(0);
  const mountedRef = useRef(true);
  const hasDataRef = useRef(false);

  const refresh = useCallback(() => setTick((v) => v + 1), []);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  useEffect(() => {
    const id = window.setInterval(() => setClock((c) => c + 1), 15_000);
    return () => window.clearInterval(id);
  }, []);

  useEffect(() => {
    if (!enabled) return;

    let cancelled = false;
    const run = async () => {
      if (!hasDataRef.current) setLoading(true);
      try {
        const params = new URLSearchParams({ weekStart });
        if (planSector !== "ALL") params.set("planSector", planSector);
        const res = await fetch(`/api/v1/weekly-plans?${params.toString()}`, {
          credentials: "include",
        });
        const body = (await res.json().catch(() => ({}))) as WeeklyPlansResponse;
        if (cancelled || !mountedRef.current) return;
        if (!res.ok) {
          setError(body.error || "No pudimos actualizar el plan");
          setLoading(false);
          return;
        }
        setItems(Array.isArray(body.items) ? body.items : []);
        setUniqueCount(typeof body.uniqueCount === "number" ? body.uniqueCount : body.items?.length ?? 0);
        setAllowedSectors(Array.isArray(body.allowedSectors) ? body.allowedSectors : []);
        setLastSuccessAt(body.scannedAt ? new Date(body.scannedAt) : new Date());
        setError(null);
        hasDataRef.current = true;
      } catch {
        if (cancelled || !mountedRef.current) return;
        setError("No pudimos actualizar el plan");
      } finally {
        if (!cancelled && mountedRef.current) setLoading(false);
      }
    };

    void run();
    return () => {
      cancelled = true;
    };
  }, [weekStart, planSector, enabled, tick]);

  useEffect(() => {
    if (!enabled) return;

    const onVisibility = () => {
      if (document.visibilityState === "visible") refresh();
    };
    document.addEventListener("visibilitychange", onVisibility);

    const id = window.setInterval(() => {
      if (document.hidden) return;
      refresh();
    }, POLL_MS);

    return () => {
      document.removeEventListener("visibilitychange", onVisibility);
      window.clearInterval(id);
    };
  }, [enabled, refresh]);

  void clock;
  const updatedAgoLabel = formatUpdatedAgo(
    lastSuccessAt ? secondsSince(lastSuccessAt.toISOString()) : null
  );

  return {
    items,
    uniqueCount,
    loading,
    error,
    lastSuccessAt,
    updatedAgoLabel,
    refresh,
    allowedSectors,
  };
}
