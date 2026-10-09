"use client";

/**
 * Prioridad de Semanas en «Mi trabajo» (SOLO LECTURA).
 *
 * El servidor (GET /api/v1/semanas/work-item-priorities) devuelve la prioridad que fijó Producción solo para los trabajos
 * VINCULADOS explícitamente a una tarea de Semanas y solo los del sector del usuario. Un trabajo sin vínculo no muestra
 * prioridad (no se inventa NORMAL). Se relee cada 60 s mientras se ve una pantalla de trabajos; si falla, se conserva lo
 * último. No cambia nada del trabajo operativo: los botones y acciones de cada sector siguen igual.
 */
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { getClientPlanningSource } from "@/lib/planning/planning-source";
import type { OrdersClientSession } from "@/lib/orders/orders-client";
import { fetchWorkItemPriorities } from "@/lib/semanas-sheet/semanas-client";
import type { WorkItemPriorityDto } from "@/lib/semanas-sheet/task-links";

const REFRESH_MS = 60_000;
interface CtxValue {
  /** true = el servidor respondió (planificación nativa + 0042): un trabajo sin entrada está SIN VINCULAR (neutral). */
  available: boolean;
  byWorkItem: Record<string, WorkItemPriorityDto>;
  /** Relee del servidor (p. ej. tras cambiar una prioridad desde «Mi trabajo»). */
  reload: () => Promise<void>;
}
const EMPTY: CtxValue = { available: false, byWorkItem: {}, reload: async () => undefined };
const Ctx = createContext<CtxValue>(EMPTY);

export function WorkItemPrioritiesProvider({ session, enabled, children }: { session: OrdersClientSession; enabled: boolean; children: ReactNode }) {
  const [state, setState] = useState<CtxValue>(EMPTY);
  const inflight = useRef(false);
  const active = enabled && getClientPlanningSource() === "native";

  const again = useRef(false);
  const load = useCallback(async () => {
    // Si ya hay una lectura en curso, se repite al terminar (un cambio recién guardado nunca queda tapado por datos viejos).
    if (inflight.current) {
      again.current = true;
      return;
    }
    inflight.current = true;
    try {
      do {
        again.current = false;
        try {
          const r = await fetchWorkItemPriorities(session);
          if (r.available) setState((prev) => ({ ...prev, available: true, byWorkItem: r.byWorkItem }));
        } catch {
          /* sin conexión: se conserva lo último (nunca se inventa una prioridad) */
        }
      } while (again.current);
    } finally {
      inflight.current = false;
    }
  }, [session]);

  useEffect(() => {
    if (!active) return;
    // Carga inicial y actualización periódica (mismo patrón que el resto de las vistas operativas).
    void load();
    const t = setInterval(() => {
      if (document.visibilityState === "visible") void load();
    }, REFRESH_MS);
    return () => clearInterval(t);
  }, [active, load]);

  const value = useMemo(() => (active ? { ...state, reload: load } : EMPTY), [active, state, load]);
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

/** Prioridad de Semanas de un trabajo (por su id de cliente, p. ej. `native:<uuid>`), o null si no está vinculado. */
export function useWorkItemSemanasPriority(itemId: string | null | undefined): WorkItemPriorityDto | null {
  const { byWorkItem } = useContext(Ctx);
  return itemId ? (byWorkItem[itemId] ?? null) : null;
}

/** ¿Se sabe qué trabajos están vinculados? (si no, no se muestra ni prioridad ni «sin prioridad»). */
export function useWorkItemPrioritiesAvailable(): boolean {
  return useContext(Ctx).available;
}

export function useReloadWorkItemPriorities(): () => Promise<void> {
  return useContext(Ctx).reload;
}

/** Mapa completo (para tablas que arman sus columnas una sola vez). */
export function useWorkItemPrioritiesMap(): Record<string, WorkItemPriorityDto> {
  return useContext(Ctx).byWorkItem;
}
