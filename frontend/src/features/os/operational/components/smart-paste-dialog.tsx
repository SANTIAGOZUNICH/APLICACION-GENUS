"use client";

import { useMemo, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { runSmartPaste, type SmartPasteMasterData, type SmartPasteResult, type SmartPasteRow } from "@/lib/smart-paste";
import type { SmartPasteFieldKey } from "@/lib/smart-paste/types";
import { SmartDataGrid, type SmartGridCellStatus } from "./smart-data-grid";

export interface SmartPasteDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description?: string;
  /** Campos a mostrar como columnas, en el orden que la pantalla prefiera (NO afecta cómo se interpreta el pegado). */
  fields: Array<{ key: SmartPasteFieldKey; label: string }>;
  master: SmartPasteMasterData;
  checkDuplicate?: (row: SmartPasteRow) => string | undefined;
  onConfirm: (args: { rows: SmartPasteRow[]; batchId: string }) => void | Promise<void>;
  batchIdPrefix?: string;
}

const ROW_STATUS_TO_GRID: Record<SmartPasteRow["status"], SmartGridCellStatus> = {
  valido: "valido",
  revisar: "revisar",
  error: "error",
  duplicado: "duplicado",
};

/**
 * Dialogo reutilizable de Smart Paste — interpretar → normalizar → validar
 * → preview → confirmar. Piloto: Asignación de Lotes. Cualquier pantalla
 * que use los mismos SmartPasteFieldKey (lote/vto/cantidad/cliente/
 * producto/codigo) puede reusar este componente tal cual, pasando su
 * propio master data y su propio hook de duplicados (cada dominio declara
 * su clave — ver plan de expansión).
 */
export function SmartPasteDialog({
  open,
  onOpenChange,
  title,
  description = "Pegá filas desde Excel/Sheets en cualquier orden — interpretamos cada celda por su contenido, no por su posición.",
  fields,
  master,
  checkDuplicate,
  onConfirm,
  batchIdPrefix = "smart-paste",
}: SmartPasteDialogProps) {
  const [raw, setRaw] = useState("");
  const [selected, setSelected] = useState<Record<number, boolean>>({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const importLockRef = useRef(false);

  const result: SmartPasteResult | null = useMemo(() => {
    if (!raw.trim()) return null;
    return runSmartPaste(raw, master, { checkDuplicate, batchIdPrefix });
  }, [raw, master, checkDuplicate, batchIdPrefix]);

  const rows = result?.rows ?? [];
  const isSelected = (row: SmartPasteRow) =>
    selected[row.rowIndex] ?? (row.status === "valido" || row.status === "revisar");
  const selectedRows = rows.filter(isSelected);

  function setAll(value: boolean) {
    const next: Record<number, boolean> = {};
    for (const row of rows) next[row.rowIndex] = value && row.status !== "duplicado";
    setSelected(next);
  }

  async function confirm() {
    if (busy || importLockRef.current || !result) return;
    const toImport = rows.filter((r) => isSelected(r) && r.status !== "error" && r.status !== "duplicado");
    if (toImport.length === 0) return;
    importLockRef.current = true;
    setBusy(true);
    setError(null);
    try {
      await onConfirm({ rows: toImport, batchId: result.batchId });
      setRaw("");
      setSelected({});
      onOpenChange(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : "No se pudo importar.");
    } finally {
      setBusy(false);
      importLockRef.current = false;
    }
  }

  const columns = [
    ...fields.map((f) => ({
      key: f.key,
      label: f.label,
      minWidth: 100,
      render: (row: SmartPasteRow) => row.assignments[f.key]?.value ?? "—",
      cellText: (row: SmartPasteRow) => row.assignments[f.key]?.value ?? "",
      status: (row: SmartPasteRow): SmartGridCellStatus | undefined => {
        const assignment = row.assignments[f.key];
        if (!assignment) return undefined;
        if (assignment.confidence === "media") return "revisar";
        return undefined;
      },
      reason: (row: SmartPasteRow) => row.assignments[f.key]?.reason,
    })),
    {
      key: "__estado",
      label: "Estado",
      minWidth: 140,
      render: (row: SmartPasteRow) => estadoLabel(row),
      cellText: (row: SmartPasteRow) => estadoLabel(row),
      reason: (row: SmartPasteRow) =>
        row.possibleDuplicateOf ?? row.issues.map((i) => i.message).join(" ") ?? undefined,
    },
  ];

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex h-[min(94vh,920px)] w-[min(97vw,1400px)] max-w-[97vw] flex-col gap-0 overflow-hidden p-0">
        <div className="shrink-0 space-y-2 border-b border-[var(--os-border)] px-4 py-3 sm:px-5">
          <DialogHeader className="space-y-1 pr-8">
            <DialogTitle>{title}</DialogTitle>
            <DialogDescription>{description}</DialogDescription>
          </DialogHeader>
          <textarea
            className="min-h-24 w-full rounded border border-[var(--os-border)] bg-[var(--os-bg)] p-3 font-mono text-xs"
            placeholder="Pegá aquí (Ctrl+V) — en cualquier orden de columnas…"
            value={raw}
            onChange={(e) => {
              setRaw(e.target.value);
              setSelected({});
              setError(null);
            }}
            disabled={busy}
            data-testid="smart-paste-textarea"
          />
          {result && (
            <p className="text-xs text-[var(--os-text-muted)]" data-testid="smart-paste-summary">
              PEGADO INTERPRETADO — {result.summary.totalRows} fila(s) detectada(s): {result.summary.valid}{" "}
              correctas, {result.summary.review} para revisar, {result.summary.error} con error,{" "}
              {result.summary.duplicate} posibles duplicados.
            </p>
          )}
        </div>

        <div className="flex shrink-0 flex-wrap items-center gap-2 border-b border-[var(--os-border)] bg-[var(--os-surface)] px-4 py-2 sm:px-5">
          <Button type="button" variant="secondary" size="sm" disabled={!rows.length || busy} onClick={() => setAll(true)}>
            Seleccionar todo
          </Button>
          <Button type="button" variant="secondary" size="sm" disabled={!rows.length || busy} onClick={() => setAll(false)}>
            Deseleccionar todo
          </Button>
          <div className="ml-auto flex items-center gap-2">
            <Button type="button" variant="secondary" disabled={busy} onClick={() => onOpenChange(false)}>
              Cancelar
            </Button>
            <Button
              type="button"
              disabled={busy || selectedRows.filter((r) => r.status !== "error" && r.status !== "duplicado").length === 0}
              onClick={() => void confirm()}
              data-testid="smart-paste-confirm"
            >
              {busy
                ? "Importando…"
                : `Confirmar ${selectedRows.filter((r) => r.status !== "error" && r.status !== "duplicado").length} fila(s)`}
            </Button>
          </div>
        </div>
        {error && (
          <p className="shrink-0 px-4 py-2 text-xs text-[var(--genus-error)] sm:px-5">{error}</p>
        )}

        <div className="min-h-0 flex-1 overflow-hidden px-2 pb-3 sm:px-4">
          {!result ? (
            <p className="px-2 py-8 text-center text-sm text-[var(--os-text-muted)]">
              Pegá datos para ver la interpretación antes de guardar.
            </p>
          ) : (
            <SmartDataGrid
              columns={columns}
              rows={rows}
              rowKey={(row) => String(row.rowIndex)}
              stickyColumns={1}
              rowStatus={(row) => ROW_STATUS_TO_GRID[row.status]}
              onSelectRow={(row) => setSelected((prev) => ({ ...prev, [row.rowIndex]: !isSelected(row) }))}
            />
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}

function estadoLabel(row: SmartPasteRow): string {
  switch (row.status) {
    case "valido":
      return "🟢 Listo";
    case "revisar":
      return "🟡 Revisar";
    case "error":
      return "🔴 Error";
    case "duplicado":
      return "⚪ Posible duplicado";
    default:
      return row.status;
  }
}
