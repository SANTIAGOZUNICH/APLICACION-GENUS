"use client";

/**
 * Prioridad de Semanas en «Mi trabajo» (solo lectura): la MISMA que fijó Producción en Semanas, solo en trabajos
 * vinculados explícitamente a esa tarea. Un trabajo sin vínculo muestra una indicación NEUTRAL (nunca una prioridad
 * inventada). Si la función no está disponible (sin planificación nativa), no se muestra nada.
 */
import type { CSSProperties } from "react";
import type { Priority } from "@/lib/semanas-sheet/priorities";
import { useWorkItemPrioritiesAvailable, useWorkItemSemanasPriority } from "../hooks/use-work-item-priorities";
import { PriorityTag } from "./plan-task-card";
import { PRIORITY_STYLE } from "./semanas-priority-chip";

export const NEUTRAL_PRIORITY_TEXT = "Sin prioridad";
const NEUTRAL_TITLE = "Sin prioridad asignada: Producción todavía no vinculó este trabajo con una tarea de Semanas.";

/** Borde lateral por prioridad (inset: no cambia el tamaño del elemento). Neutral = sin borde de color. */
export function priorityEdge(priority: Priority | null | undefined, width = 4): CSSProperties | undefined {
  return priority ? { boxShadow: `inset ${width}px 0 0 ${PRIORITY_STYLE[priority].accent}` } : undefined;
}

/**
 * `tone="solid"`: etiqueta compacta de color pleno, legible sobre fondo claro u oscuro (p. ej. la columna «HOY» del
 * tablero semanal). `soft` (por defecto) es la etiqueta de Semanas sobre azul marino.
 */
export function WorkItemPriorityBadge({ itemId, className = "", tone = "soft" }: { itemId: string; className?: string; tone?: "soft" | "solid" }) {
  const p = useWorkItemSemanasPriority(itemId);
  const available = useWorkItemPrioritiesAvailable();
  if (!p) {
    if (!available) return null;
    return (
      <span className={`inline-flex ${className}`} title={NEUTRAL_TITLE} data-testid="work-item-priority" data-priority="NONE">
        {tone === "solid" ? (
          <span className="inline-flex items-center whitespace-nowrap rounded px-1.5 text-[10px] font-bold tracking-wide" style={{ background: "#64748b", color: "#fff" }}>
            {NEUTRAL_PRIORITY_TEXT.toUpperCase()}
          </span>
        ) : (
          <span className="inline-flex items-center gap-1.5 whitespace-nowrap rounded-full border border-white/15 bg-white/5 px-2.5 py-0.5 text-[11px] font-semibold tracking-wide text-[var(--os-text-muted)]">
            <span className="inline-block size-[0.6em] rounded-full bg-white/30" aria-hidden="true" />
            {NEUTRAL_PRIORITY_TEXT.toUpperCase()}
          </span>
        )}
      </span>
    );
  }
  const who = p.priorityInfo ? ` · ${p.priorityInfo.updatedByName || p.priorityInfo.updatedBy}, ${new Date(p.priorityInfo.updatedAt).toLocaleString("es-AR")}` : "";
  return (
    <span
      className={`inline-flex ${className}`}
      title={`Prioridad asignada por Producción en Semanas${who}. Tarea: ${p.taskProducts.join(" / ")}${p.taskClient ? ` (${p.taskClient})` : ""}.`}
      data-testid="work-item-priority"
      data-priority={p.priority}
    >
      {tone === "solid" ? (
        <span className="inline-flex items-center whitespace-nowrap rounded px-1.5 text-[10px] font-bold tracking-wide" style={{ background: PRIORITY_STYLE[p.priority].accent, color: p.priority === "IMPORTANTE" ? "#1f1300" : "#fff" }}>
          {p.priority}
        </span>
      ) : (
        <PriorityTag priority={p.priority} />
      )}
    </span>
  );
}
