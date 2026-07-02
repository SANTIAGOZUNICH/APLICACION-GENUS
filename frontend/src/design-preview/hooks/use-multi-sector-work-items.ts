"use client";

import { useEffect, useState } from "react";
import { fetchWorkItems, OperationsApiError } from "@/lib/api/operations-client";
import type { WorkItem } from "@/types/operational/work-item";
import type { SectorId } from "@/types/operational/sector";

/** Sectores operativos con WorkItems en SEMANAS — preview agregador F9.6. */
export const TWIN_DATA_SECTORS: SectorId[] = [
  "ELABORACION",
  "ENVASADO_MASIVO",
  "ENVASADO_PREMIUM",
  "DEPOSITO",
  "PRODUCCION",
];

interface MultiSectorState {
  items: WorkItem[];
  loading: boolean;
  error: string | null;
  scannedAt: string | null;
}

/** Carga WorkItems de varios sectores en paralelo — solo design-preview. */
export function useMultiSectorWorkItems(sectors: SectorId[]): MultiSectorState {
  const sectorKey = sectors.join(",");
  const [items, setItems] = useState<WorkItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [scannedAt, setScannedAt] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    void (async () => {
      try {
        const responses = await Promise.all(sectors.map((sector) => fetchWorkItems(sector)));
        if (cancelled) return;
        const merged = responses.flatMap((r) => r.workItems);
        setItems(merged);
        const latest = responses
          .map((r) => r.scannedAt)
          .filter(Boolean)
          .sort()
          .pop();
        setScannedAt(latest ?? null);
        setError(null);
      } catch (err) {
        if (cancelled) return;
        setError(
          err instanceof OperationsApiError
            ? err.message
            : "No se pudieron cargar los WorkItems."
        );
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [sectorKey, sectors]);

  return { items, loading, error, scannedAt };
}
