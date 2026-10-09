"use client";

/** Historial de cambios (auditoría) de un ingreso, salida o material ME: quién, cuándo, antes → después y motivo. */
import { useEffect, useState } from "react";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import type { InventoryAudit } from "@/lib/inventory/types";
import { fetchMeHistorial } from "../adapters/inventory-client";

const ACTION: Record<string, string> = { create: "Alta", update: "Edición (formulario)", cell_edit: "Edición en planilla", anular: "Anulación", adjust: "Ajuste de inventario", archive: "Archivo" };
const fmt = (v: unknown) => (v === null || v === undefined || v === "" ? "—" : typeof v === "boolean" ? (v ? "Sí" : "No") : String(v));

export function MeHistoryDialog({ target, onClose }: { target: { id: string; label: string } | null; onClose: () => void }) {
  const [entries, setEntries] = useState<InventoryAudit[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    if (!target) return;
    let alive = true;
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setEntries(null);
    setError(null);
    fetchMeHistorial(target.id)
      .then((e) => alive && setEntries(e))
      .catch((e: unknown) => alive && setError(e instanceof Error ? e.message : "No se pudo leer el historial."));
    return () => {
      alive = false;
    };
  }, [target]);
  return (
    <Dialog open={Boolean(target)} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-h-[85vh] overflow-y-auto" data-testid="me-history-dialog">
        <DialogHeader>
          <DialogTitle>Historial · {target?.label}</DialogTitle>
          <DialogDescription>Cada cambio con valor anterior, nuevo, usuario, fecha y motivo.</DialogDescription>
        </DialogHeader>
        {error && <p className="text-sm text-red-400" role="alert">{error}</p>}
        {!entries && !error && <p className="text-sm text-[var(--os-text-muted)]">Cargando…</p>}
        {entries?.length === 0 && <p className="text-sm text-[var(--os-text-muted)]">Sin cambios registrados.</p>}
        <ol className="space-y-2 text-sm">
          {(entries ?? []).map((e) => {
            const keys = [...new Set([...Object.keys(e.after ?? {}), ...Object.keys(e.before ?? {})])].filter((k) => !["updatedAt", "updatedBy", "createdAt", "createdBy", "id"].includes(k)).slice(0, 8);
            return (
              <li key={e.id} className="rounded-md border border-[var(--os-border)] px-3 py-2" data-testid="me-history-entry">
                <div className="flex flex-wrap justify-between gap-2 text-xs text-[var(--os-text-muted)]">
                  <span>{ACTION[e.action] ?? e.action} · {e.actor} · {e.actorSector}</span>
                  <span>{new Date(e.createdAt).toLocaleString("es-AR", { dateStyle: "short", timeStyle: "short" })}</span>
                </div>
                {e.action !== "create" && keys.map((k) => (
                  <p key={k}>
                    <b>{k}</b>: <span className="line-through opacity-70">{fmt(e.before?.[k])}</span> → <b>{fmt(e.after?.[k])}</b>
                  </p>
                ))}
                {e.reason && <p className="text-xs text-[var(--os-text-muted)]">Motivo: {e.reason}</p>}
              </li>
            );
          })}
        </ol>
      </DialogContent>
    </Dialog>
  );
}
