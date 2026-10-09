"use client";

/**
 * Lectura de la planificación de Semanas de un sector (GET /api/v1/semanas/plan) con actualización automática.
 * Seguro ante cortes: si una actualización falla se conserva el último dato bueno y se informa el error.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import type { OrdersClientSession } from "@/lib/orders/orders-client";
import type { PlanSector } from "@/lib/semanas-sheet/plan-tasks";
import { fetchSectorPlan, type SectorPlanResponse } from "@/lib/semanas-sheet/semanas-client";

export const PLAN_REFRESH_MS = 60_000;

export interface SectorPlanState {
  data: SectorPlanResponse | null;
  /** Hora de la última lectura correcta. */
  at: Date | null;
  error: string | null;
  loading: boolean;
  reload: () => Promise<void>;
}

export function useSectorPlan(session: OrdersClientSession, sector: PlanSector | "ALL" | undefined, refreshMs = PLAN_REFRESH_MS): SectorPlanState {
  const [data, setData] = useState<SectorPlanResponse | null>(null);
  const [at, setAt] = useState<Date | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const seq = useRef(0);

  const reload = useCallback(async () => {
    const mine = ++seq.current;
    setLoading(true);
    try {
      const next = await fetchSectorPlan(session, sector);
      if (mine !== seq.current) return; // llegó tarde: ya se pidió otro sector
      setData(next);
      setAt(new Date());
      setError(null);
    } catch (e) {
      if (mine !== seq.current) return;
      setError(e instanceof Error ? e.message : "Sin conexión con el servidor.");
    } finally {
      if (mine === seq.current) setLoading(false);
    }
  }, [session, sector]);

  useEffect(() => {
    // Carga inicial / cambio de sector y actualización periódica (solo con la pestaña visible).
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void reload();
    if (refreshMs <= 0) return;
    const t = setInterval(() => {
      if (document.visibilityState === "visible") void reload();
    }, refreshMs);
    return () => clearInterval(t);
  }, [reload, refreshMs]);

  return { data, at, error, loading, reload };
}
