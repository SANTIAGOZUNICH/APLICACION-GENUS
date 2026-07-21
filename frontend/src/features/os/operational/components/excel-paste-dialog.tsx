"use client";

import { useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  autoMapColumns,
  parseGrid,
  rowToObject,
  type ColumnMapping,
  type RowValidationIssue,
} from "@/features/os/operational/lib/clipboard-import";
import { displayCell } from "@/lib/inventory/calcs";

type FieldDef = { key: string; label: string; calculated?: boolean };

interface ExcelPasteDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  fields: FieldDef[];
  fieldAliases: Record<string, string[]>;
  /** Campos calculados a ignorar del pegado (TOTAL, FALTA, ESTADO…). */
  ignoreKeys?: string[];
  onConfirm: (rows: Record<string, string>[]) => void | Promise<void>;
}

interface PreviewRow {
  rowNumber: number;
  mapped: Record<string, string>;
  issues: RowValidationIssue[];
  include: boolean;
}

export function ExcelPasteDialog({
  open,
  onOpenChange,
  fields,
  fieldAliases,
  ignoreKeys = [],
  onConfirm,
}: ExcelPasteDialogProps) {
  const [raw, setRaw] = useState("");
  const [mapping, setMapping] = useState<ColumnMapping>({});
  const [preview, setPreview] = useState<PreviewRow[]>([]);
  const [headers, setHeaders] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);

  const calculated = useMemo(
    () => new Set([...ignoreKeys, ...fields.filter((f) => f.calculated).map((f) => f.key)]),
    [fields, ignoreKeys]
  );

  function analyze() {
    const grid = parseGrid(raw);
    const map = autoMapColumns(grid.headers, fieldAliases);
    for (const key of calculated) {
      map[key] = null;
    }
    setMapping(map);
    setHeaders(grid.headers);
    const rows: PreviewRow[] = grid.rows.map((cells, idx) => {
      const mapped = rowToObject(cells, map) as Record<string, string>;
      for (const key of calculated) delete mapped[key];
      const issues: RowValidationIssue[] = [];
      const hasAny = Object.values(mapped).some((v) => displayCell(v));
      if (!hasAny) issues.push({ rowIndex: idx, message: "Fila vacía" });
      return {
        rowNumber: idx + 1,
        mapped,
        issues,
        include: issues.length === 0,
      };
    });
    setPreview(rows);
  }

  async function confirm() {
    setBusy(true);
    try {
      const rows = preview.filter((p) => p.include && p.issues.length === 0).map((p) => p.mapped);
      await onConfirm(rows);
      setRaw("");
      setPreview([]);
      onOpenChange(false);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] max-w-3xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Pegar desde Excel</DialogTitle>
          <DialogDescription>
            Pegá filas copiadas. Se detectan tabulaciones y encabezados. Los campos calculados se
            recalculan en la app (no se importan valores pegados de TOTAL/FALTA/ESTADO).
          </DialogDescription>
        </DialogHeader>
        <textarea
          className="min-h-32 w-full rounded border border-[var(--os-border)] bg-[var(--os-bg)] p-3 font-mono text-xs"
          placeholder="Pegá aquí (Ctrl+V)…"
          value={raw}
          onChange={(e) => setRaw(e.target.value)}
        />
        <div className="flex gap-2">
          <Button type="button" variant="secondary" onClick={analyze} disabled={!raw.trim()}>
            Vista previa
          </Button>
        </div>
        {headers.length > 0 && (
          <p className="text-xs text-[var(--os-text-muted)]">
            Encabezados detectados: {headers.join(" · ")}
          </p>
        )}
        {preview.length > 0 && (
          <div className="overflow-x-auto rounded border border-[var(--os-border)]">
            <table className="min-w-full text-left text-xs">
              <thead className="bg-[var(--os-bg)]">
                <tr>
                  <th className="p-2">Incluir</th>
                  <th className="p-2">#</th>
                  {fields
                    .filter((f) => !calculated.has(f.key))
                    .map((f) => (
                      <th key={f.key} className="p-2">
                        {f.label}
                        {mapping[f.key] == null ? " (—)" : ""}
                      </th>
                    ))}
                  <th className="p-2">Errores</th>
                </tr>
              </thead>
              <tbody>
                {preview.map((row) => (
                  <tr key={row.rowNumber} className="border-t border-[var(--os-border-subtle)]">
                    <td className="p-2">
                      <input
                        type="checkbox"
                        checked={row.include}
                        disabled={row.issues.length > 0}
                        onChange={(e) =>
                          setPreview((prev) =>
                            prev.map((p) =>
                              p.rowNumber === row.rowNumber
                                ? { ...p, include: e.target.checked }
                                : p
                            )
                          )
                        }
                      />
                    </td>
                    <td className="p-2">{row.rowNumber}</td>
                    {fields
                      .filter((f) => !calculated.has(f.key))
                      .map((f) => (
                        <td key={f.key} className="p-2">
                          {displayCell(row.mapped[f.key])}
                        </td>
                      ))}
                    <td className="p-2 text-red-700">
                      {row.issues.map((i) => i.message).join("; ")}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <DialogFooter>
          <Button type="button" variant="secondary" onClick={() => onOpenChange(false)}>
            Cancelar
          </Button>
          <Button
            type="button"
            disabled={busy || preview.filter((p) => p.include).length === 0}
            onClick={() => void confirm()}
          >
            Confirmar importación
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
