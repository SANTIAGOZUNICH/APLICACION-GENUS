"use client";

import { useCallback, useEffect, useState } from "react";
import { fetchWorkItems, OperationsApiError } from "@/lib/api/operations-client";
import type { WorkItemsResponse } from "@/types/operational/work-item";
import type { SectorId } from "@/types/operational/sector";

interface UseSectorWorkItemsOptions {
  ownerPerson?: string | null;
}

interface UseSectorWorkItemsResult {
  data: WorkItemsResponse | null;
  loading: boolean;
  error: string | null;
  refresh: () => void;
}

/** Carga WorkItems reales vía API — SEMANAS 2026 → Mapper → WorkItems. */
export function useSectorWorkItems(
  sector: SectorId,
  options?: UseSectorWorkItemsOptions
): UseSectorWorkItemsResult {
  const ownerPerson = options?.ownerPerson ?? null;
  const [data, setData] = useState<WorkItemsResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [tick, setTick] = useState(0);

  const refresh = useCallback(() => {
    setTick((value) => value + 1);
  }, []);

  useEffect(() => {
    let cancelled = false;

    void (async () => {
      try {
        const response = await fetchWorkItems(sector, { ownerPerson });
        if (!cancelled) {
          setData(response);
          setError(null);
        }
      } catch (err) {
        if (!cancelled) {
          setError(
            err instanceof OperationsApiError
              ? err.message
              : "No se pudieron cargar los WorkItems."
          );
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [sector, ownerPerson, tick]);

  return { data, loading, error, refresh };
}
