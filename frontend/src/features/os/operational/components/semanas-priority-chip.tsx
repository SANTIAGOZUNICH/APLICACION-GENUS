"use client";

/**
 * Prioridad operativa (URGENTE / IMPORTANTE / NORMAL): se muestra con color Y texto (nunca solo color) y se cambia
 * desde la misma tarjeta con un menú mínimo (sin ventanas grandes). Prioridad ≠ estado de producción.
 */
import { useEffect, useRef, useState } from "react";
import { PRIORITIES, PRIORITY_META, type Priority } from "@/lib/semanas-sheet/priorities";

export const PRIORITY_STYLE: Record<Priority, { accent: string; soft: string; text: string }> = {
  URGENTE: { accent: "#ef4444", soft: "rgba(239,68,68,0.16)", text: "#fecaca" },
  IMPORTANTE: { accent: "#f59e0b", soft: "rgba(245,158,11,0.16)", text: "#fde68a" },
  NORMAL: { accent: "#22c55e", soft: "rgba(34,197,94,0.14)", text: "#bbf7d0" },
};

export function PriorityBadge({ priority, size = "md" }: { priority: Priority; size?: "md" | "lg" }) {
  const st = PRIORITY_STYLE[priority];
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full border font-bold tracking-wide ${size === "lg" ? "px-4 py-1.5 text-xl" : "px-2.5 py-0.5 text-[11px]"}`}
      style={{ background: st.soft, borderColor: st.accent, color: st.text, opacity: priority === "NORMAL" && size === "md" ? 0.8 : 1 }}
      data-priority={priority}
    >
      <span aria-hidden="true">{PRIORITY_META[priority].icon}</span>
      {PRIORITY_META[priority].label}
    </span>
  );
}

interface Props {
  priority: Priority;
  /** null = solo lectura (sin permiso o sin tabla): se muestra el motivo. */
  readOnlyReason: string | null;
  onChange: (next: Priority) => void;
  busy?: boolean;
  /** Info de auditoría para el tooltip. */
  info?: string;
}

export function PriorityChip({ priority, readOnlyReason, onChange, busy, info }: Props) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent | KeyboardEvent) => {
      if (e instanceof KeyboardEvent) {
        if (e.key === "Escape") setOpen(false);
      } else if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", close);
    document.addEventListener("keydown", close);
    return () => {
      document.removeEventListener("mousedown", close);
      document.removeEventListener("keydown", close);
    };
  }, [open]);

  if (readOnlyReason) {
    return (
      <span title={`${info ? `${info} · ` : ""}${readOnlyReason}`} data-testid="priority-chip" data-readonly="1">
        <PriorityBadge priority={priority} />
      </span>
    );
  }
  return (
    <div ref={ref} className="relative" onMouseDown={(e) => e.stopPropagation()}>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        disabled={busy}
        aria-haspopup="menu"
        aria-expanded={open}
        title={`${info ? `${info} · ` : ""}Cambiar prioridad`}
        className="rounded-full focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--os-teal)] disabled:opacity-60"
        data-testid="priority-chip"
      >
        <PriorityBadge priority={priority} />
      </button>
      {open && (
        <div role="menu" className="absolute right-0 top-full z-30 mt-1 w-56 rounded-xl border border-[var(--os-border)] bg-[var(--os-surface)] p-1 shadow-xl" data-testid="priority-menu">
          {PRIORITIES.map((p) => (
            <button
              key={p}
              type="button"
              role="menuitemradio"
              aria-checked={p === priority}
              onClick={() => {
                setOpen(false);
                if (p !== priority) onChange(p);
              }}
              className="flex w-full items-center justify-between gap-2 rounded-lg px-2 py-1.5 text-left text-sm hover:bg-[var(--os-teal-soft)]"
              data-testid={`priority-option-${p}`}
            >
              <PriorityBadge priority={p} />
              {p === priority && <span aria-hidden="true">✓</span>}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
