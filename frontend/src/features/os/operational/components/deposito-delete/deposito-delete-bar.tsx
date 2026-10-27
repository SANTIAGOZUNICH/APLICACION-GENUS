"use client";

import { useState } from "react";
import { Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";

export type DeleteScope = "selected" | "visible" | "table";

function plural(n: number, one: string, many: string) {
  return n === 1 ? one : many;
}

/**
 * Barra compacta de eliminación de Depósito: «X filas seleccionadas | Eliminar seleccionadas | Cancelar selección» y, siempre,
 * «Eliminar…» con los otros dos alcances (visibles / toda la tabla), nunca mezclados. Una sola confirmación, sin motivo.
 */
export function DepositoDeleteBar({
  selectedCount,
  visibleCount,
  tableCount,
  noun,
  busy,
  message,
  onCancelSelection,
  onConfirm,
  onOpenHistory,
}: {
  selectedCount: number;
  visibleCount: number;
  tableCount: number;
  noun: string;
  busy: boolean;
  message: string | null;
  onCancelSelection: () => void;
  onConfirm: (scope: DeleteScope) => Promise<void>;
  /** Abre el historial interno de eliminaciones (auditoría), si la tabla lo ofrece. */
  onOpenHistory?: () => void;
}) {
  const [menu, setMenu] = useState(false);
  const [pending, setPending] = useState<DeleteScope | null>(null);
  const count = pending === "selected" ? selectedCount : pending === "visible" ? visibleCount : tableCount;
  const rows = plural(count, "registro", "registros");
  const title =
    pending === "selected"
      ? `Eliminar ${count} ${rows} seleccionado${count === 1 ? "" : "s"}`
      : pending === "visible"
        ? `Eliminar las ${count} ${plural(count, "fila visible", "filas visibles")}`
        : `Eliminar TODOS los registros de la tabla (${count})`;
  const detail =
    pending === "table"
      ? `Se eliminarán los ${count} ${noun} de la tabla, también los que hoy no se ven por filtros o búsqueda.`
      : pending === "visible"
        ? `Se ${count === 1 ? "eliminará solo la fila que se ve" : `eliminarán solo las ${count} filas que se ven`} ahora (según filtros y búsqueda).`
        : `Se ${count === 1 ? "eliminará la fila marcada" : `eliminarán las ${count} filas marcadas`}.`;

  return (
    <div className="mb-3 flex flex-wrap items-center gap-2" data-testid="deposito-delete-bar">
      {selectedCount > 0 ? (
        <div className="flex flex-wrap items-center gap-2 rounded-[var(--os-radius-sm)] border border-[var(--os-teal)]/30 bg-[var(--os-teal-soft)]/40 px-3 py-1.5">
          <span className="text-sm font-medium text-[var(--os-text)]" data-testid="deposito-delete-count">
            {selectedCount} {plural(selectedCount, "fila seleccionada", "filas seleccionadas")}
          </span>
          <Button type="button" size="sm" disabled={busy} onClick={() => setPending("selected")} data-testid="deposito-delete-selected">
            <Trash2 className="mr-1 size-4" aria-hidden="true" />
            Eliminar seleccionadas
          </Button>
          <Button type="button" variant="secondary" size="sm" disabled={busy} onClick={onCancelSelection} data-testid="deposito-delete-cancel">
            Cancelar selección
          </Button>
        </div>
      ) : null}
      <div className="relative">
        <Button type="button" variant="secondary" size="sm" disabled={busy || tableCount === 0} onClick={() => setMenu((v) => !v)} aria-expanded={menu} data-testid="deposito-delete-all-menu">
          Eliminar todas…
        </Button>
        {menu ? (
          <div className="absolute left-0 z-20 mt-1 w-72 rounded-[var(--os-radius-sm)] border border-[var(--os-border)] bg-[var(--os-surface)] p-1 shadow-lg" role="menu">
            <button
              type="button"
              role="menuitem"
              className="block w-full rounded px-3 py-2 text-left text-sm hover:bg-[var(--os-teal-soft)]/50 disabled:opacity-50"
              disabled={visibleCount === 0}
              onClick={() => {
                setMenu(false);
                setPending("visible");
              }}
              data-testid="deposito-delete-visible"
            >
              Eliminar todas las filas visibles ({visibleCount})
            </button>
            <button
              type="button"
              role="menuitem"
              className="block w-full rounded px-3 py-2 text-left text-sm text-red-700 hover:bg-red-50"
              onClick={() => {
                setMenu(false);
                setPending("table");
              }}
              data-testid="deposito-delete-table"
            >
              Eliminar todos los registros de la tabla ({tableCount})
            </button>
          </div>
        ) : null}
      </div>
      {onOpenHistory ? (
        <Button type="button" variant="secondary" size="sm" onClick={onOpenHistory} data-testid="deposito-delete-history">
          Historial de eliminaciones
        </Button>
      ) : null}
      {message ? (
        <span className="text-sm text-[var(--os-text-muted)]" role="status" data-testid="deposito-delete-message">
          {message}
        </span>
      ) : null}

      <Dialog open={pending !== null} onOpenChange={(o) => (!o && !busy ? setPending(null) : undefined)}>
        <DialogContent className="w-[min(28rem,calc(100vw-24px))] max-w-none">
          <DialogHeader>
            <DialogTitle>{title}</DialogTitle>
            <DialogDescription>{detail} Queda registrado en el historial interno.</DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button type="button" variant="secondary" disabled={busy} onClick={() => setPending(null)}>
              Cancelar
            </Button>
            <Button
              type="button"
              disabled={busy || count === 0}
              onClick={async () => {
                const scope = pending!;
                setPending(null);
                await onConfirm(scope);
              }}
              data-testid="deposito-delete-confirm"
            >
              Eliminar {count}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
