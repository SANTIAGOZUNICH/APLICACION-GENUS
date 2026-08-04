"use client";

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  autoMapColumns,
  parseGrid,
  rowToObject,
  type ColumnMapping,
} from "@/features/os/operational/lib/clipboard-import";
import {
  buildExcelTsv,
  classifyExcelPreviewIssues,
  computeExcelPreviewCounts,
  copyTextToClipboard,
  isExcelPreviewImportable,
  mintImportIdempotencyKey,
  selectionMasterState,
  type ExcelPreviewIssue,
} from "@/features/os/operational/lib/excel-import-preview-utils";
import { displayCell } from "@/lib/inventory/calcs";
import { cn } from "@/lib/utils/cn";

export type ExcelImportFieldDef = {
  key: string;
  label: string;
  required?: boolean;
  calculated?: boolean;
  showInPreview?: boolean;
  mobilePrimary?: boolean;
  formatDisplay?: (value: string, mapped: Record<string, string>) => string;
};

export type ExcelImportPreviewRow = {
  id: string;
  rowNumber: number;
  mapped: Record<string, string>;
  issues: ExcelPreviewIssue[];
  selected: boolean;
  payload?: unknown;
};

export type ExcelImportPreviewDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title?: string;
  description?: string;
  fields: ExcelImportFieldDef[];
  fieldAliases: Record<string, string[]>;
  ignoreKeys?: string[];
  analyzeMode?: "live" | "button";
  allowColumnRemap?: boolean;
  acceptCsvFile?: boolean;
  placeholder?: string;
  /** Prefills textarea when the dialog opens (e.g. CSV file load). */
  initialText?: string;
  validateMappedRow?: (
    mapped: Record<string, string>,
    ctx: { rowNumber: number; headers: string[]; mapping: ColumnMapping }
  ) => { issues: ExcelPreviewIssue[]; payload?: unknown };
  onConfirm: (args: {
    rows: ExcelImportPreviewRow[];
    mapping: ColumnMapping;
    idempotencyKey: string;
  }) => void | Promise<void>;
  onToast?: (message: string, type?: "success" | "info") => void;
  idempotencyPrefix?: string;
};

type UndoSnapshot = {
  excluded: number[];
  selection: Record<number, boolean>;
};

function emptyIssueCheck(mapped: Record<string, string>, rowIndex: number): ExcelPreviewIssue[] {
  const hasAny = Object.values(mapped).some((v) => displayCell(v));
  return hasAny ? [] : [{ rowIndex, message: "Fila vacía" }];
}

export function ExcelImportPreviewDialog({
  open,
  onOpenChange,
  title = "Pegar desde Excel",
  description = "Pegá filas copiadas desde Excel. Se asocian columnas por encabezado sin inventar valores.",
  fields,
  fieldAliases,
  ignoreKeys = [],
  analyzeMode = "live",
  allowColumnRemap = true,
  acceptCsvFile = true,
  placeholder = "Pegá aquí (Ctrl+V)…",
  initialText,
  validateMappedRow,
  onConfirm,
  onToast,
  idempotencyPrefix = "excel-import",
}: ExcelImportPreviewDialogProps) {
  const [raw, setRaw] = useState("");
  const [customMapping, setCustomMapping] = useState<ColumnMapping>({});
  const [buttonReady, setButtonReady] = useState(false);
  const [excluded, setExcluded] = useState<number[]>([]);
  const [selection, setSelection] = useState<Record<number, boolean>>({});
  const [busy, setBusy] = useState(false);
  const [confirmRemove, setConfirmRemove] = useState(false);
  const [undoStack, setUndoStack] = useState<UndoSnapshot[]>([]);
  const [rowErrors, setRowErrors] = useState<Record<number, string>>({});
  const [idempotencyKey, setIdempotencyKey] = useState(() =>
    mintImportIdempotencyKey(idempotencyPrefix)
  );
  const masterRef = useRef<HTMLInputElement>(null);
  const importLock = useRef(false);
  const validateRef = useRef(validateMappedRow);
  validateRef.current = validateMappedRow;

  const calculated = useMemo(
    () => new Set([...ignoreKeys, ...fields.filter((f) => f.calculated).map((f) => f.key)]),
    [fields, ignoreKeys]
  );

  const previewFields = useMemo(
    () => fields.filter((f) => !calculated.has(f.key) && f.showInPreview !== false && !f.calculated),
    [fields, calculated]
  );

  const mobileFields = useMemo(() => {
    const primary = previewFields.filter((f) => f.mobilePrimary);
    return primary.length > 0 ? primary : previewFields.slice(0, 4);
  }, [previewFields]);

  const moreFields = useMemo(
    () => previewFields.filter((f) => !mobileFields.some((m) => m.key === f.key)),
    [previewFields, mobileFields]
  );

  const shouldAnalyze =
    open &&
    Boolean(raw.trim()) &&
    (analyzeMode === "live" || buttonReady);

  const parsed = useMemo(() => {
    if (!shouldAnalyze) {
      return { headers: [] as string[], mapping: {} as ColumnMapping, allRows: [] as ExcelImportPreviewRow[] };
    }
    const grid = parseGrid(raw);
    const auto = autoMapColumns(grid.headers, fieldAliases);
    for (const key of calculated) auto[key] = null;
    const nextMapping: ColumnMapping = { ...auto, ...customMapping };
    const allRows = grid.rows.map((cells, idx) => {
      const rowNumber = grid.hasHeaderRow ? idx + 2 : idx + 1;
      const mapped = rowToObject(cells, nextMapping) as Record<string, string>;
      for (const key of calculated) delete mapped[key];
      const baseIssues = emptyIssueCheck(mapped, rowNumber);
      const extra = validateRef.current?.(mapped, {
        rowNumber,
        headers: grid.headers,
        mapping: nextMapping,
      });
      const issues = [...baseIssues, ...(extra?.issues ?? [])];
      return {
        id: `r-${rowNumber}-${idx}`,
        rowNumber,
        mapped,
        issues,
        selected: false,
        payload: extra?.payload,
      };
    });
    return { headers: grid.headers, mapping: nextMapping, allRows };
  }, [shouldAnalyze, raw, fieldAliases, calculated, customMapping]);

  const excludedSet = useMemo(() => new Set(excluded), [excluded]);

  const rows = useMemo(() => {
    return parsed.allRows
      .filter((row) => !excludedSet.has(row.rowNumber))
      .map((row) => {
        // Default: select importable rows; allow selecting invalid for copy/remove.
        const defaultSelected = isExcelPreviewImportable(row.issues);
        const selected =
          selection[row.rowNumber] === undefined
            ? defaultSelected
            : Boolean(selection[row.rowNumber]);
        return { ...row, selected };
      });
  }, [parsed.allRows, excludedSet, selection]);

  // Fresh paste/mapping => new idempotency key; clear row errors.
  useEffect(() => {
    if (!shouldAnalyze) return;
    setIdempotencyKey(mintImportIdempotencyKey(idempotencyPrefix));
    setRowErrors({});
  }, [raw, customMapping, shouldAnalyze, idempotencyPrefix]);

  useEffect(() => {
    if (!open) return;
    if (initialText != null && initialText !== "") {
      setRaw(initialText);
      setCustomMapping({});
      setExcluded([]);
      setSelection({});
      setUndoStack([]);
      setButtonReady(true);
    }
  }, [open, initialText]);

  useEffect(() => {
    if (open) return;
    setRaw("");
    setCustomMapping({});
    setButtonReady(false);
    setExcluded([]);
    setSelection({});
    setUndoStack([]);
    setConfirmRemove(false);
    setRowErrors({});
    setBusy(false);
    importLock.current = false;
    setIdempotencyKey(mintImportIdempotencyKey(idempotencyPrefix));
  }, [open, idempotencyPrefix]);

  const counts = useMemo(() => computeExcelPreviewCounts(rows), [rows]);
  const master = selectionMasterState(counts.selected, counts.total);

  useEffect(() => {
    if (masterRef.current) masterRef.current.indeterminate = master === "indeterminate";
  }, [master]);

  function setAllSelection(value: boolean) {
    const next: Record<number, boolean> = { ...selection };
    for (const row of rows) {
      next[row.rowNumber] = value ? isExcelPreviewImportable(row.issues) : false;
    }
    setSelection(next);
  }

  async function copySelected() {
    const selected = rows.filter((r) => r.selected);
    if (!selected.length) {
      onToast?.("No hay filas seleccionadas para copiar.", "info");
      return;
    }
    const labels = previewFields.map((f) => f.label);
    const body = selected.map((row) => previewFields.map((f) => row.mapped[f.key] ?? ""));
    const ok = await copyTextToClipboard(buildExcelTsv(labels, body));
    onToast?.(
      ok ? `${selected.length} filas copiadas` : "No se pudo copiar al portapapeles.",
      ok ? "success" : "info"
    );
  }

  function removeSelected() {
    if (!rows.some((r) => r.selected)) {
      onToast?.("No hay filas seleccionadas para quitar.", "info");
      return;
    }
    setConfirmRemove(true);
  }

  function confirmRemoveSelected() {
    const selectedNumbers = rows.filter((r) => r.selected).map((r) => r.rowNumber);
    setUndoStack((stack) => [
      ...stack,
      { excluded: [...excluded], selection: { ...selection } },
    ]);
    setExcluded((prev) => [...new Set([...prev, ...selectedNumbers])]);
    setConfirmRemove(false);
    onToast?.("Filas quitadas del preview. Podés deshacer mientras el modal esté abierto.", "info");
  }

  function undoRemove() {
    setUndoStack((stack) => {
      if (!stack.length) return stack;
      const previous = stack[stack.length - 1]!;
      setExcluded(previous.excluded);
      setSelection(previous.selection);
      return stack.slice(0, -1);
    });
    onToast?.("Se restauraron las filas quitadas.", "success");
  }

  async function importSelected() {
    if (busy || importLock.current) return;
    const selectedImportable = rows.filter(
      (r) => r.selected && isExcelPreviewImportable(r.issues)
    );
    if (!selectedImportable.length) return;
    importLock.current = true;
    setBusy(true);
    setRowErrors({});
    try {
      await onConfirm({
        rows: selectedImportable,
        mapping: parsed.mapping,
        idempotencyKey,
      });
      onOpenChange(false);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Error al importar";
      const next: Record<number, string> = {};
      for (const row of selectedImportable) next[row.rowNumber] = message;
      setRowErrors(next);
      onToast?.(message, "info");
    } finally {
      setBusy(false);
      importLock.current = false;
    }
  }

  async function onCsvFile(file: File | null) {
    if (!file) return;
    if (file.name.toLowerCase().endsWith(".xlsx")) {
      onToast?.("Para .xlsx preferimos CSV o pegar desde Excel.", "info");
      return;
    }
    const text = await file.text();
    setRaw(text);
    setCustomMapping({});
    setExcluded([]);
    setSelection({});
    setButtonReady(true);
  }

  const showPreview = rows.length > 0;
  const importDisabledReason = busy
    ? "Importación en curso…"
    : counts.selectedImportable === 0
      ? counts.selected === 0
        ? "Seleccioná al menos una fila válida para importar"
        : "Las filas seleccionadas tienen errores y no se pueden importar"
      : null;

  function cellText(field: ExcelImportFieldDef, row: ExcelImportPreviewRow): string {
    if (field.formatDisplay) return field.formatDisplay(row.mapped[field.key] ?? "", row.mapped);
    return displayCell(row.mapped[field.key]);
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className={cn(
          "flex h-[min(94vh,920px)] w-[min(97vw,1400px)] max-w-[97vw] flex-col gap-0 overflow-hidden p-0"
        )}
      >
        <div className="shrink-0 space-y-2 border-b border-[var(--os-border)] px-4 py-3 sm:px-5">
          <DialogHeader className="space-y-1 pr-8">
            <DialogTitle>{title}</DialogTitle>
            <DialogDescription>{description}</DialogDescription>
          </DialogHeader>
          <textarea
            className="min-h-20 w-full rounded border border-[var(--os-border)] bg-[var(--os-bg)] p-3 font-mono text-xs"
            placeholder={placeholder}
            value={raw}
            onChange={(e) => {
              setRaw(e.target.value);
              setCustomMapping({});
              setExcluded([]);
              setSelection({});
              setUndoStack([]);
              if (analyzeMode === "button") setButtonReady(false);
            }}
            disabled={busy}
          />
          <div className="flex flex-wrap items-center gap-2">
            {analyzeMode === "button" && (
              <Button
                type="button"
                variant="secondary"
                onClick={() => setButtonReady(true)}
                disabled={!raw.trim() || busy}
              >
                Vista previa
              </Button>
            )}
            {acceptCsvFile && (
              <label className="inline-flex min-h-9 cursor-pointer items-center rounded border border-[var(--os-border)] px-3 text-xs font-medium">
                Cargar CSV
                <input
                  type="file"
                  accept=".csv,text/csv,text/plain"
                  className="sr-only"
                  disabled={busy}
                  onChange={(e) => void onCsvFile(e.target.files?.[0] ?? null)}
                />
              </label>
            )}
            {showPreview && (
              <p className="text-xs text-[var(--os-text-muted)]">
                {counts.selected} seleccionadas · {counts.valid} válidas · {counts.warnings} con
                advertencias · {counts.invalid} inválidas
              </p>
            )}
          </div>
        </div>

        {showPreview && allowColumnRemap && parsed.headers.length > 0 && (
          <div className="shrink-0 border-b border-[var(--os-border)] px-4 py-2 sm:px-5">
            <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-[var(--os-text-muted)]">
              Mapeo de columnas
            </p>
            <div className="grid max-h-28 grid-cols-2 gap-2 overflow-y-auto overflow-x-hidden sm:grid-cols-3 lg:grid-cols-4">
              {previewFields.map((field) => (
                <label key={field.key} className="space-y-0.5 text-[11px] font-medium">
                  {field.label}
                  {field.required ? "*" : ""}
                  <select
                    value={parsed.mapping[field.key] ?? ""}
                    disabled={busy}
                    onChange={(event) =>
                      setCustomMapping((current) => ({
                        ...current,
                        [field.key]:
                          event.target.value === "" ? null : Number(event.target.value),
                      }))
                    }
                    className="w-full rounded border border-[var(--os-border)] bg-[var(--os-surface)] px-2 py-1"
                  >
                    <option value="">Sin mapear</option>
                    {parsed.headers.map((header, index) => (
                      <option key={`${header}-${index}`} value={index}>
                        {header}
                      </option>
                    ))}
                  </select>
                </label>
              ))}
            </div>
          </div>
        )}

        <div className="z-20 flex shrink-0 flex-wrap items-center gap-2 border-b border-[var(--os-border)] bg-[var(--os-surface)] px-4 py-2 sm:px-5">
          <Button
            type="button"
            variant="secondary"
            size="sm"
            disabled={!showPreview || busy}
            onClick={() => setAllSelection(true)}
          >
            Seleccionar todo
          </Button>
          <Button
            type="button"
            variant="secondary"
            size="sm"
            disabled={!showPreview || busy}
            onClick={() => setAllSelection(false)}
          >
            Deseleccionar todo
          </Button>
          <Button
            type="button"
            variant="secondary"
            size="sm"
            disabled={!showPreview || busy || counts.selected === 0}
            onClick={() => void copySelected()}
          >
            Copiar seleccionados
          </Button>
          <Button
            type="button"
            variant="secondary"
            size="sm"
            disabled={!showPreview || busy || counts.selected === 0}
            onClick={removeSelected}
          >
            Quitar seleccionados
          </Button>
          {undoStack.length > 0 && (
            <Button type="button" variant="secondary" size="sm" disabled={busy} onClick={undoRemove}>
              Deshacer
            </Button>
          )}
          <div className="ml-auto flex flex-wrap items-center gap-2">
            <Button type="button" variant="secondary" disabled={busy} onClick={() => onOpenChange(false)}>
              Cancelar
            </Button>
            <Button
              type="button"
              disabled={Boolean(importDisabledReason)}
              title={importDisabledReason ?? undefined}
              onClick={() => void importSelected()}
            >
              {busy
                ? "Importando…"
                : `Importar ${counts.selectedImportable} seleccionado${counts.selectedImportable === 1 ? "" : "s"}`}
            </Button>
          </div>
          {importDisabledReason && counts.selectedImportable === 0 && showPreview && (
            <p className="w-full text-xs text-[var(--os-text-muted)]">{importDisabledReason}</p>
          )}
          {confirmRemove && (
            <div className="flex w-full flex-wrap items-center gap-2 rounded border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-sm">
              <span>¿Quitar {counts.selected} fila(s) solo de este preview?</span>
              <Button type="button" size="sm" variant="secondary" onClick={() => setConfirmRemove(false)}>
                Cancelar
              </Button>
              <Button type="button" size="sm" onClick={confirmRemoveSelected}>
                Quitar
              </Button>
            </div>
          )}
        </div>

        <div className="min-h-0 flex-1 overflow-hidden px-2 pb-3 sm:px-4">
          {!showPreview ? (
            <p className="px-2 py-8 text-center text-sm text-[var(--os-text-muted)]">
              {raw.trim()
                ? analyzeMode === "button"
                  ? "Pulsá «Vista previa» para revisar las filas."
                  : "No hay filas para mostrar."
                : "Pegá datos de Excel para ver la vista previa."}
            </p>
          ) : (
            <>
              <div className="hidden h-full overflow-auto md:block">
                <table className="w-full min-w-0 table-fixed border-separate border-spacing-0 text-left text-[13px]">
                  <thead className="sticky top-0 z-10 bg-[var(--os-bg)]">
                    <tr className="text-[11px] uppercase tracking-wide text-[var(--os-text-muted)]">
                      <th className="sticky left-0 z-20 w-10 bg-[var(--os-bg)] px-2 py-2">
                        <input
                          ref={masterRef}
                          type="checkbox"
                          checked={master === true}
                          onChange={() => setAllSelection(master !== true)}
                          aria-label="Seleccionar todas"
                          disabled={busy}
                        />
                      </th>
                      <th className="w-12 px-2 py-2">#</th>
                      {previewFields.map((f) => (
                        <th key={f.key} className="px-2 py-2">
                          {f.label}
                        </th>
                      ))}
                      <th className="w-36 px-2 py-2">Estado</th>
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map((row) => {
                      const status = classifyExcelPreviewIssues(row.issues);
                      return (
                        <tr key={row.id} className="border-t border-[var(--os-border-subtle)] align-top">
                          <td className="sticky left-0 bg-[var(--os-surface)] px-2 py-2">
                            <input
                              type="checkbox"
                              checked={row.selected}
                              disabled={busy}
                              onChange={(e) =>
                                setSelection((prev) => ({
                                  ...prev,
                                  [row.rowNumber]: e.target.checked,
                                }))
                              }
                              aria-label={`Seleccionar fila ${row.rowNumber}`}
                            />
                          </td>
                          <td className="px-2 py-2 tabular-nums">{row.rowNumber}</td>
                          {previewFields.map((f) => (
                            <td key={f.key} className="max-w-0 truncate px-2 py-2 font-mono text-xs">
                              <span title={row.mapped[f.key] ?? ""}>{cellText(f, row)}</span>
                            </td>
                          ))}
                          <td className="px-2 py-2 text-xs">
                            {status === "valid" && <span className="text-[var(--os-teal)]">Lista</span>}
                            {status === "warning" && (
                              <span className="text-amber-700">Advertencia</span>
                            )}
                            {status === "invalid" && (
                              <span className="text-rose-700">
                                {row.issues.map((i) => i.message).join("; ")}
                              </span>
                            )}
                            {rowErrors[row.rowNumber] && (
                              <p className="mt-1 text-rose-700">{rowErrors[row.rowNumber]}</p>
                            )}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>

              <div className="h-full space-y-2 overflow-y-auto overflow-x-hidden p-1 md:hidden">
                <label className="mb-2 flex items-center gap-2 text-sm font-medium">
                  <input
                    type="checkbox"
                    checked={master === true}
                    ref={(el) => {
                      if (el) el.indeterminate = master === "indeterminate";
                    }}
                    onChange={() => setAllSelection(master !== true)}
                    disabled={busy}
                  />
                  Seleccionar todo
                </label>
                {rows.map((row) => {
                  const status = classifyExcelPreviewIssues(row.issues);
                  return (
                    <article
                      key={row.id}
                      className="rounded border border-[var(--os-border)] bg-[var(--os-surface)] p-3"
                    >
                      <div className="flex items-start gap-2">
                        <input
                          type="checkbox"
                          className="mt-1"
                          checked={row.selected}
                          disabled={busy}
                          onChange={(e) =>
                            setSelection((prev) => ({
                              ...prev,
                              [row.rowNumber]: e.target.checked,
                            }))
                          }
                        />
                        <div className="min-w-0 flex-1">
                          <p className="text-xs text-[var(--os-text-muted)]">Fila {row.rowNumber}</p>
                          {mobileFields.map((f) => (
                            <p key={f.key} className="os-break text-sm">
                              <span className="text-[var(--os-text-muted)]">{f.label}: </span>
                              {cellText(f, row) || "—"}
                            </p>
                          ))}
                          {moreFields.length > 0 && (
                            <details className="mt-2">
                              <summary className="cursor-pointer text-xs font-medium text-[var(--os-teal)]">
                                Más datos
                              </summary>
                              <div className="mt-1 space-y-1">
                                {moreFields.map((f) => (
                                  <p key={f.key} className="os-break text-xs">
                                    <span className="text-[var(--os-text-muted)]">{f.label}: </span>
                                    {cellText(f, row) || "—"}
                                  </p>
                                ))}
                              </div>
                            </details>
                          )}
                          <p className="mt-2 text-xs">
                            {status === "valid" && (
                              <span className="text-[var(--os-teal)]">Lista</span>
                            )}
                            {status === "warning" && (
                              <span className="text-amber-700">
                                {row.issues.map((i) => i.message).join("; ") || "Advertencia"}
                              </span>
                            )}
                            {status === "invalid" && (
                              <span className="text-rose-700">
                                {row.issues.map((i) => i.message).join("; ")}
                              </span>
                            )}
                          </p>
                          {rowErrors[row.rowNumber] && (
                            <p className="mt-1 text-xs text-rose-700">{rowErrors[row.rowNumber]}</p>
                          )}
                        </div>
                      </div>
                    </article>
                  );
                })}
              </div>
            </>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}

/** Backward-compatible wrapper for ME Ingresos/Salidas and MP Hub. */
export function ExcelPasteDialog(props: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  fields: { key: string; label: string; calculated?: boolean }[];
  fieldAliases: Record<string, string[]>;
  ignoreKeys?: string[];
  onConfirm: (rows: Record<string, string>[]) => void | Promise<void>;
  onToast?: (message: string, type?: "success" | "info") => void;
}): ReactNode {
  return (
    <ExcelImportPreviewDialog
      open={props.open}
      onOpenChange={props.onOpenChange}
      fields={props.fields}
      fieldAliases={props.fieldAliases}
      ignoreKeys={props.ignoreKeys}
      analyzeMode="live"
      allowColumnRemap
      onToast={props.onToast}
      onConfirm={async ({ rows }) => {
        await props.onConfirm(rows.map((r) => r.mapped));
      }}
    />
  );
}
