"use client";

import { useEffect } from "react";
import { CheckCircle2, X } from "lucide-react";
import { usePreviewContext } from "@/features/os/session/preview-context";

/** Feedback visual por acción simulada — toast suave. */
export function ActionToast() {
  const { toast, dismissToast } = usePreviewContext();

  useEffect(() => {
    if (!toast) return;
    const timer = window.setTimeout(dismissToast, 3200);
    return () => window.clearTimeout(timer);
  }, [toast, dismissToast]);

  if (!toast) return null;

  return (
    <div
      role="status"
      className="os-slide-up pointer-events-auto fixed bottom-8 left-1/2 z-50 flex -translate-x-1/2 items-center gap-3 rounded-full border border-[var(--os-border)] bg-[var(--os-surface)] px-5 py-3 shadow-[var(--os-shadow-card-hover)]"
    >
      <CheckCircle2 className="size-5 text-emerald-600" aria-hidden="true" />
      <span className="text-sm font-medium text-[var(--os-text)]">{toast.message}</span>
      <button
        type="button"
        onClick={dismissToast}
        className="ml-1 rounded-full p-1 text-[var(--os-text-muted)] hover:bg-[var(--os-bg)]"
        aria-label="Cerrar"
      >
        <X className="size-3.5" />
      </button>
    </div>
  );
}
