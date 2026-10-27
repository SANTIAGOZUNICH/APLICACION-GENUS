"use client";

import { useEffect, useState } from "react";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { fetchMeDeletions, type MeDeletionHistoryEntry } from "@/features/os/operational/adapters/inventory-client";

const summary = (b: Record<string, unknown> | null) => {
  if (!b) return "—";
  const parts = [b.ingresoNro, b.egresoNro, b.codigo, b.descripcionInsumo ?? b.descripcion, b.cantidad != null ? `cant. ${b.cantidad}` : null].filter((v) => v != null && String(v).trim() !== "");
  return parts.map(String).join(" · ") || String(b.id ?? "—");
};

/** Historial interno de eliminaciones (auditoría): no devuelve los registros a las tablas operativas. */
export function DeletionHistoryDialog({ open, onOpenChange, resource, title }: { open: boolean; onOpenChange: (o: boolean) => void; resource: "me_ingresos" | "me_salidas" | "me_stock"; title: string }) {
  const [state, setState] = useState<{ entries: MeDeletionHistoryEntry[] | null; error: string | null }>({ entries: null, error: null });
  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    fetchMeDeletions(resource)
      .then((entries) => !cancelled && setState({ entries, error: null }))
      .catch((e) => !cancelled && setState({ entries: null, error: e instanceof Error ? e.message : "No se pudo cargar." }));
    return () => {
      cancelled = true;
    };
  }, [open, resource]);
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[80dvh] w-[min(40rem,calc(100vw-24px))] max-w-none overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Historial de eliminaciones · {title}</DialogTitle>
          <DialogDescription>Auditoría interna: quién eliminó, cuándo y cómo era el registro.</DialogDescription>
        </DialogHeader>
        {state.error ? <p className="text-sm text-red-700">{state.error}</p> : null}
        {state.entries === null && !state.error ? <p className="text-sm text-[var(--os-text-muted)]">Cargando…</p> : null}
        {state.entries?.length === 0 ? <p className="text-sm text-[var(--os-text-muted)]">Todavía no hay eliminaciones.</p> : null}
        <ul className="space-y-1 text-sm" data-testid="deletion-history-list">
          {state.entries?.map((e) => (
            <li key={e.id} className="rounded border border-[var(--os-border)] px-2 py-1">
              <span className="font-medium">{new Date(e.createdAt).toLocaleString("es-AR")}</span> · {e.actor}
              <div className="text-[var(--os-text-muted)]">{summary(e.before)}</div>
            </li>
          ))}
        </ul>
      </DialogContent>
    </Dialog>
  );
}
