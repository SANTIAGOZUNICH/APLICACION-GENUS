"use client";

/** Historial de un lote: quién cambió qué (valor anterior → nuevo), alta y archivo con motivo. Solo lectura. */
import { useEffect, useState } from "react";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { fetchAsignacionLoteHistoryApi, type AsignacionLoteHistoryEntryDto } from "@/lib/asignacion-lotes/asignacion-lotes-client";
import type { OrdersClientSession } from "@/lib/orders/orders-client";
import type { AsignacionLote } from "@/lib/asignacion-lotes/types";

const FIELD_LABEL: Record<string, string> = {
  lote: "Lote", fecha: "Fecha", producto: "Producto", codigo: "Código", marca: "Marca", cantidades: "Cantidades", vto: "Vencimiento",
  muestras: "Muestras", cjMuestra: "Cj. muestra", fechaAnalisis: "Fecha de análisis", observaciones: "Observaciones",
};
const when = (iso: string) => new Date(iso).toLocaleString("es-AR", { dateStyle: "short", timeStyle: "short" });

export function AsignacionLoteHistoryDialog({ session, target, onClose }: { session: OrdersClientSession; target: AsignacionLote | null; onClose: () => void }) {
  const [entries, setEntries] = useState<AsignacionLoteHistoryEntryDto[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    if (!target) return;
    let alive = true;
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setEntries(null);
    setError(null);
    fetchAsignacionLoteHistoryApi(session, target.id)
      .then((e) => alive && setEntries(e))
      .catch((e: unknown) => alive && setError(e instanceof Error ? e.message : "No se pudo leer el historial."));
    return () => {
      alive = false;
    };
  }, [session, target]);
  return (
    <Dialog open={Boolean(target)} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-h-[85vh] overflow-y-auto" data-testid="lote-history-dialog">
        <DialogHeader>
          <DialogTitle>Historial del lote {target?.lote}</DialogTitle>
          <DialogDescription>{target?.producto} · cada cambio con valor anterior, nuevo, usuario y fecha.</DialogDescription>
        </DialogHeader>
        {error && <p className="text-sm text-red-400" role="alert">{error}</p>}
        {!entries && !error && <p className="text-sm text-[var(--os-text-muted)]">Cargando…</p>}
        {entries && (
          <ol className="space-y-2 text-sm">
            {entries.map((e, i) => (
              <li key={i} className="rounded-md border border-[var(--os-border)] px-3 py-2" data-testid="lote-history-entry">
                <div className="flex flex-wrap justify-between gap-2 text-xs text-[var(--os-text-muted)]">
                  <span>{e.actor}{e.kind === "CHANGE" ? ` · ${e.actorSector}` : ""}</span>
                  <span>{when(e.at)}</span>
                </div>
                {e.kind === "CHANGE" && (
                  <p>
                    <b>{FIELD_LABEL[e.field] ?? e.field}</b>: <span className="line-through opacity-70">{e.oldValue || "—"}</span> → <b>{e.newValue || "—"}</b>
                    <span className="ml-2 text-xs text-[var(--os-text-muted)]">{e.origin === "FORM" ? "formulario" : "planilla"}</span>
                  </p>
                )}
                {e.kind === "CREATED" && <p>Alta del lote {e.origin === "SYNC" ? "(sincronizado desde Google Sheets)" : "(carga manual)"}</p>}
                {e.kind === "ARCHIVED" && <p>Archivado{e.reason ? ` — motivo: ${e.reason}` : ""}</p>}
              </li>
            ))}
            {entries.length <= 1 && <li className="text-xs text-[var(--os-text-muted)]">Sin cambios registrados después del alta.</li>}
          </ol>
        )}
      </DialogContent>
    </Dialog>
  );
}
