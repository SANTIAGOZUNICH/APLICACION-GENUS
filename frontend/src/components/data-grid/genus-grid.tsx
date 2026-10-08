"use client";

/**
 * GenusGrid — grilla editable tipo Excel, reutilizable en todo GENUS OS.
 *
 * Motor: react-datasheet-grid (MIT, DOM + virtualización, React 19). Ver
 * docss/38-grilla-excel-asignacion-lotes.md para la evaluación contra AG Grid
 * Community (selección de rango = Enterprise/pago), Glide Data Grid (canvas,
 * sin soporte React 19) y TanStack Table (headless, sin rangos).
 *
 * Esta capa agrega lo que el motor no trae y que GENUS exige:
 * - guardado POR CELDA (nunca la fila entera) vía `onCommit(changes)`;
 * - estados Guardando… / ✓ Guardado / 🔴 Error + reintentar / descartar;
 * - rollback: si falla, la celda vuelve al valor anterior;
 * - celdas protegidas por política/permiso (solo lectura + motivo);
 * - preview antes de pegados masivos, borrados múltiples o columnas sensibles;
 * - deshacer (Ctrl+Z) del último guardado, re-guardando el valor anterior;
 * - sin éxito "falso": el check aparece recién cuando el servidor confirma.
 *
 * El adaptador de cada pantalla aporta: columnas, permisos (`protection`),
 * validación y `onCommit` (que llama al PATCH específico de su módulo).
 */
import "react-datasheet-grid/dist/style.css";
import "./genus-grid.css";
import {
  DataSheetGrid,
  createTextColumn,
  type CellProps,
  type Column,
  type DataSheetGridRef,
} from "react-datasheet-grid";
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type ComponentType,
  type ReactNode,
} from "react";
import { Lock, Undo2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { diffGridRows, previewValue, type GenusGridRow } from "./grid-changes";

export interface GenusGridColumn<T> {
  key: string;
  title: string;
  kind?: "text" | "number" | "date";
  /** Ancho base en px. */
  basis?: number;
  minWidth?: number;
  /** Texto que se muestra y se copia al portapapeles (lo que ve el usuario). */
  getValue: (row: T) => string;
  /** Motivo por el que la celda NO es editable para este registro (null = editable). */
  protection?: (row: T) => string | null;
  /** Validación inmediata del valor crudo (null = válido). El servidor revalida siempre. */
  validate?: (raw: string, row: T) => string | null;
  /** Columna sensible (identidad/trazabilidad): su edición siempre pide confirmación. */
  sensitive?: boolean;
}

export interface GenusGridCellChange {
  rowId: string;
  columnKey: string;
  columnTitle: string;
  rowLabel: string;
  oldValue: string;
  newValue: string;
  /** Versión del registro que el usuario tenía al editar. */
  rowVersion: string;
}

export interface GenusGridCommitResult {
  ok: boolean;
  message?: string;
  failures?: { rowId: string; columnKey: string; message: string }[];
}

export interface GenusGridProps<T> {
  rows: T[];
  rowId: (row: T) => string;
  /** Versión de concurrencia del registro (updatedAt). */
  rowVersion: (row: T) => string;
  /** Etiqueta legible del registro para previews y mensajes (p. ej. el N° de lote). */
  rowLabel: (row: T) => string;
  columns: GenusGridColumn<T>[];
  /** Persiste las celdas. Debe resolver recién cuando el servidor CONFIRMÓ (y actualizar `rows`). */
  onCommit: (changes: GenusGridCellChange[]) => Promise<GenusGridCommitResult>;
  /** false = grilla de solo lectura (sector sin permiso de edición). */
  canEdit?: boolean;
  /** Más de N celdas en una operación → preview antes de aplicar. */
  previewThreshold?: number;
  height?: number;
  maxHeight?: number;
  rowHeight?: number;
  /** Contenido de la columna fija a la derecha (acciones por fila). */
  renderRowActions?: (row: T) => ReactNode;
  rowActionsWidth?: number;
  /** Pide recargar datos del servidor (tras un conflicto de concurrencia). */
  onReload?: () => void;
  testId?: string;
  /** Texto de ayuda en el pie. */
  hint?: ReactNode;
}

type SaveState = "idle" | "saving" | "saved" | "error";

interface PreviewState {
  changes: GenusGridCellChange[];
  invalid: { change: GenusGridCellChange; message: string }[];
  skipped: { rowLabel: string; columnTitle: string; reason: string }[];
}

interface FailedBatch {
  id: number;
  changes: GenusGridCellChange[];
  message: string;
}

interface CellCtx {
  noteSkip: (rowLabel: string, columnTitle: string, reason: string) => void;
  noteTouch: (reason: string) => void;
}

const cellKey = (rowId: string, columnKey: string) => `${rowId}\u0000${columnKey}`;

/** Celda: texto del motor + bloqueo visual/funcional si el registro/columna está protegido. */
function GenusCell({
  base,
  colKey,
  kind,
  ctx,
  ...props
}: CellProps<GenusGridRow, unknown> & {
  base: Column<string, unknown, string>;
  colKey: string;
  kind: "text" | "number" | "date";
  ctx: { current: CellCtx };
}) {
  const { rowData, setRowData, focus, stopEditing } = props;
  const reason = rowData.__prot[colKey] ?? null;
  const wrapRef = useRef<HTMLDivElement>(null);

  // Teclado apropiado en celular (numérico para cantidades, etc.).
  useLayoutEffect(() => {
    const input = wrapRef.current?.querySelector("input");
    if (input) input.inputMode = kind === "number" ? "decimal" : kind === "date" ? "numeric" : "text";
  }, [kind]);

  // Enter/escribir sobre una celda protegida: se cancela la edición y se avisa el motivo.
  useEffect(() => {
    if (reason && focus) {
      stopEditing();
      ctx.current.noteTouch(reason);
    }
  }, [reason, focus, stopEditing, ctx]);

  const Base = base.component as unknown as ComponentType<CellProps<string, unknown>>;
  return (
    <div ref={wrapRef} className="genus-cell-wrap" title={reason ?? undefined}>
      <Base
        {...props}
        rowData={String(rowData[colKey] ?? "")}
        focus={reason ? false : focus}
        columnData={base.columnData}
        setRowData={(value: string) => setRowData({ ...rowData, [colKey]: value })}
      />
      {reason ? (
        <span className="genus-cell-lock" aria-label="Celda protegida">
          <Lock className="size-3" aria-hidden="true" />
        </span>
      ) : null}
    </div>
  );
}

export function GenusGrid<T>({
  rows,
  rowId,
  rowVersion,
  rowLabel,
  columns,
  onCommit,
  canEdit = true,
  previewThreshold = 5,
  height,
  maxHeight = 560,
  rowHeight = 36,
  renderRowActions,
  rowActionsWidth = 96,
  onReload,
  testId = "genus-grid",
  hint,
}: GenusGridProps<T>) {
  const gridRef = useRef<DataSheetGridRef>(null);
  const [overlay, setOverlay] = useState<Record<string, { value: string; status: "saving" | "error" }>>({});
  const [saveState, setSaveState] = useState<SaveState>("idle");
  const [savedCount, setSavedCount] = useState(0);
  const [notice, setNotice] = useState<string | null>(null);
  const [failed, setFailed] = useState<FailedBatch[]>([]);
  const [preview, setPreview] = useState<PreviewState | null>(null);
  const [undoDepth, setUndoDepth] = useState(0);
  const [selectionLabel, setSelectionLabel] = useState("");

  const undoStack = useRef<GenusGridCellChange[][]>([]);
  const queue = useRef<Promise<unknown>>(Promise.resolve());
  const batchSeq = useRef(0);
  const savedTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const skips = useRef<{ rowLabel: string; columnTitle: string; reason: string }[]>([]);
  const skipTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const rowById = useMemo(() => new Map(rows.map((row) => [rowId(row), row] as const)), [rows, rowId]);
  const rowByIdRef = useRef(rowById);

  const columnByKey = useMemo(() => new Map(columns.map((c) => [c.key, c] as const)), [columns]);
  const columnKeys = useMemo(() => columns.map((c) => c.key), [columns]);

  // ---- filas del motor (valores en texto + overlay optimista) ----
  const gridRows = useMemo<GenusGridRow[]>(
    () =>
      rows.map((row) => {
        const id = rowId(row);
        const out: GenusGridRow = { __id: id, __version: rowVersion(row), __prot: {}, __st: {} };
        for (const col of columns) {
          const ov = overlay[cellKey(id, col.key)];
          out[col.key] = ov ? ov.value : col.getValue(row);
          out.__prot[col.key] = canEdit ? (col.protection?.(row) ?? null) : "Tu sector no puede editar esta tabla.";
          if (ov) out.__st[col.key] = ov.status;
        }
        return out;
      }),
    [rows, columns, overlay, rowId, rowVersion, canEdit]
  );
  const gridRowsRef = useRef(gridRows);

  // ---- avisos de celdas protegidas tocadas (pegar / suprimir / editar) ----
  const ctx = useRef<CellCtx>({ noteSkip: () => {}, noteTouch: () => {} });
  const flushSkips = useCallback(() => {
    if (skipTimer.current) clearTimeout(skipTimer.current);
    skipTimer.current = null;
    const pending = skips.current;
    skips.current = [];
    return pending;
  }, []);
  // Refs sincronizados tras cada render (los handlers del motor leen siempre lo último).
  useLayoutEffect(() => {
    rowByIdRef.current = rowById;
    gridRowsRef.current = gridRows;
  });
  useLayoutEffect(() => {
  ctx.current = {
    noteSkip: (rowLabelText, columnTitle, reason) => {
      skips.current.push({ rowLabel: rowLabelText, columnTitle, reason });
      if (!skipTimer.current) {
        // Si el motor no dispara onChange (todo el pegado cayó en celdas protegidas), avisamos igual.
        skipTimer.current = setTimeout(() => {
          const pending = flushSkips();
          if (pending.length) {
            setPreview({ changes: [], invalid: [], skipped: pending });
          }
        }, 120);
      }
    },
    noteTouch: (reason) => setNotice(`Celda protegida: ${reason}`),
  };
  }, [flushSkips]);

  // ---- columnas del motor (estáticas: dependen solo de las definiciones) ----
  const gridColumns = useMemo<Partial<Column<GenusGridRow, unknown, string>>[]>(() => {
    return columns.map((col) => {
      const kind = col.kind ?? "text";
      const base = createTextColumn({
        continuousUpdates: false,
        deletedValue: "",
        alignRight: kind === "number",
        parseUserInput: (value) => value,
        parsePastedValue: (value) => value.replace(/[\r\n]+/g, " ").trim(),
        formatBlurredInput: (value) => String(value ?? ""),
        formatInputOnFocus: (value) => String(value ?? ""),
        formatForCopy: (value) => String(value ?? ""),
      }) as Column<string, unknown, string>;
      const touch = (rowData: GenusGridRow, reason: string) => {
        const source = rowByIdRef.current.get(rowData.__id);
        ctx.current.noteSkip(source ? rowLabel(source) : rowData.__id, col.title, reason);
      };
      return {
        id: col.key,
        title: col.title,
        basis: col.basis ?? 140,
        minWidth: col.minWidth ?? 80,
        grow: 1,
        // shrink 0: en pantallas angostas la grilla hace scroll horizontal interno (no rompe el layout).
        shrink: 0,
        keepFocus: false,
        disableKeys: false,
        disabled: false,
        columnData: undefined,
        component: ((props: CellProps<GenusGridRow, unknown>) => (
          <GenusCell {...props} base={base} colKey={col.key} kind={kind} ctx={ctx} />
        )) as Column<GenusGridRow, unknown, string>["component"],
        copyValue: ({ rowData }) => String(rowData[col.key] ?? ""),
        deleteValue: ({ rowData }) => {
          const reason = rowData.__prot[col.key];
          if (reason) {
            touch(rowData, reason);
            return rowData;
          }
          return { ...rowData, [col.key]: "" };
        },
        pasteValue: ({ rowData, value }) => {
          const reason = rowData.__prot[col.key];
          if (reason) {
            touch(rowData, reason);
            return rowData;
          }
          return { ...rowData, [col.key]: String(value ?? "").replace(/[\r\n]+/g, " ").trim() };
        },
        isCellEmpty: ({ rowData }) => !String(rowData[col.key] ?? ""),
        cellClassName: ({ rowData, columnId }) => {
          const key = columnId ?? col.key;
          const classes: string[] = [];
          if (rowData.__prot[key]) classes.push("genus-cell-protected");
          if (rowData.__st[key] === "saving") classes.push("genus-cell-saving");
          if (rowData.__st[key] === "error") classes.push("genus-cell-error");
          if (kind === "number") classes.push("genus-cell-num");
          return classes.join(" ") || undefined;
        },
      };
    });
  }, [columns, rowLabel]);

  const stickyRight = useMemo(
    () =>
      renderRowActions
        ? {
            basis: rowActionsWidth,
            minWidth: rowActionsWidth,
            grow: 0,
            shrink: 0,
            title: "",
            component: (({ rowData }: CellProps<GenusGridRow, unknown>) => {
              const source = rowByIdRef.current.get(rowData.__id);
              return <div className="flex items-center px-2">{source ? renderRowActions(source) : null}</div>;
            }) as Column<GenusGridRow, unknown, string>["component"],
          }
        : undefined,
    [renderRowActions, rowActionsWidth]
  );

  // ---- guardado ----
  const markSaved = useCallback((count: number) => {
    setSaveState("saved");
    setSavedCount(count);
    if (savedTimer.current) clearTimeout(savedTimer.current);
    savedTimer.current = setTimeout(() => setSaveState((s) => (s === "saved" ? "idle" : s)), 4000);
  }, []);

  useEffect(
    () => () => {
      if (savedTimer.current) clearTimeout(savedTimer.current);
      if (skipTimer.current) clearTimeout(skipTimer.current);
    },
    []
  );

  const runCommit = useCallback(
    (changes: GenusGridCellChange[], opts: { useLatestVersion: boolean; recordUndo: boolean; retryOf?: number }) => {
      setNotice(null);
      setSaveState("saving");
      setOverlay((prev) => {
        const next = { ...prev };
        for (const c of changes) next[cellKey(c.rowId, c.columnKey)] = { value: c.newValue, status: "saving" };
        return next;
      });
      const job = queue.current.then(async () => {
        const toSend = changes.map((c) => {
          const latest = opts.useLatestVersion ? rowByIdRef.current.get(c.rowId) : undefined;
          return latest ? { ...c, rowVersion: rowVersion(latest) } : c;
        });
        let result: GenusGridCommitResult;
        try {
          result = await onCommit(toSend);
        } catch (err) {
          result = { ok: false, message: err instanceof Error ? err.message : "Error de red al guardar." };
        }
        // Fallo PARCIAL (filas de Google): solo las celdas rechazadas quedan en error; las confirmadas se limpian.
        const failedKeys = new Set((result.failures ?? []).map((f) => cellKey(f.rowId, f.columnKey)));
        const partial = !result.ok && failedKeys.size > 0 && failedKeys.size < changes.length;
        const failedChanges = result.ok
          ? []
          : partial
            ? changes.filter((c) => failedKeys.has(cellKey(c.rowId, c.columnKey)))
            : changes;
        const failedSet = new Set(failedChanges.map((c) => cellKey(c.rowId, c.columnKey)));
        setOverlay((prev) => {
          const next = { ...prev };
          for (const c of changes) {
            const k = cellKey(c.rowId, c.columnKey);
            if (failedSet.has(k)) {
              // El valor mostrado vuelve al anterior; la celda queda marcada en rojo hasta reintentar/descartar.
              next[k] = { value: c.oldValue, status: "error" };
            } else delete next[k];
          }
          return next;
        });
        if (result.ok) {
          if (opts.retryOf != null) setFailed((prev) => prev.filter((b) => b.id !== opts.retryOf));
          if (opts.recordUndo) {
            undoStack.current.push(
              toSend.map((c) => ({ ...c, oldValue: c.newValue, newValue: c.oldValue }))
            );
            undoStack.current = undoStack.current.slice(-50);
            setUndoDepth(undoStack.current.length);
          }
          markSaved(changes.length);
        } else {
          const message = result.failures?.[0]?.message ?? result.message ?? "No se pudo guardar.";
          setSaveState("error");
          setFailed((prev) => {
            const id = opts.retryOf ?? ++batchSeq.current;
            const entry = { id, changes: failedChanges, message };
            return prev.some((b) => b.id === id) ? prev.map((b) => (b.id === id ? entry : b)) : [...prev, entry];
          });
        }
      });
      queue.current = job.catch(() => undefined);
      return job;
    },
    [onCommit, rowVersion, markSaved]
  );

  const discardFailed = useCallback((batch: FailedBatch) => {
    setOverlay((prev) => {
      const next = { ...prev };
      for (const c of batch.changes) delete next[cellKey(c.rowId, c.columnKey)];
      return next;
    });
    setFailed((prev) => {
      const rest = prev.filter((b) => b.id !== batch.id);
      if (rest.length === 0) setSaveState("idle");
      return rest;
    });
  }, []);

  const retryFailed = useCallback(
    (batch: FailedBatch) => void runCommit(batch.changes, { useLatestVersion: false, recordUndo: true, retryOf: batch.id }),
    [runCommit]
  );

  const undoLast = useCallback(() => {
    const batch = undoStack.current.pop();
    setUndoDepth(undoStack.current.length);
    if (batch) void runCommit(batch, { useLatestVersion: true, recordUndo: false });
  }, [runCommit]);

  // ---- cambios que vienen del motor (edición, pegado, suprimir) ----
  const handleChange = useCallback(
    (next: GenusGridRow[]) => {
      const diffs = diffGridRows(gridRowsRef.current, next, columnKeys);
      const skipped = flushSkips();
      if (diffs.length === 0 && skipped.length === 0) return;

      const changes: GenusGridCellChange[] = [];
      const invalid: PreviewState["invalid"] = [];
      for (const d of diffs) {
        const source = rowByIdRef.current.get(d.rowId);
        const col = columnByKey.get(d.columnKey);
        if (!source || !col) continue;
        const change: GenusGridCellChange = {
          rowId: d.rowId,
          columnKey: d.columnKey,
          columnTitle: col.title,
          rowLabel: rowLabel(source),
          oldValue: d.oldValue,
          newValue: d.newValue,
          rowVersion: rowVersion(source),
        };
        const problem = col.validate?.(d.newValue, source) ?? null;
        if (problem) invalid.push({ change, message: problem });
        else changes.push(change);
      }

      const total = changes.length + invalid.length;
      if (total === 0 && skipped.length === 0) return;

      const touchesSensitive = changes.some((c) => columnByKey.get(c.columnKey)?.sensitive);
      const bulkDelete = changes.filter((c) => c.newValue === "" && c.oldValue !== "").length > 1;
      const needsPreview =
        skipped.length > 0 || invalid.length > 1 || (invalid.length > 0 && changes.length > 0) ||
        changes.length > previewThreshold || bulkDelete || touchesSensitive;

      if (!needsPreview) {
        if (invalid.length === 1) {
          setNotice(`No se guardó: ${invalid[0]!.change.columnTitle} · ${invalid[0]!.message}`);
          return;
        }
        void runCommit(changes, { useLatestVersion: true, recordUndo: true });
        return;
      }
      setPreview({ changes, invalid, skipped });
    },
    [columnKeys, columnByKey, flushSkips, previewThreshold, rowLabel, rowVersion, runCommit]
  );

  const applyPreview = () => {
    if (!preview) return;
    const toApply = preview.changes;
    setPreview(null);
    if (toApply.length) void runCommit(toApply, { useLatestVersion: true, recordUndo: true });
  };

  // ---- Ctrl+Z (fuera de un input) ----
  const onKeyDownCapture = (event: React.KeyboardEvent<HTMLDivElement>) => {
    if ((event.ctrlKey || event.metaKey) && !event.shiftKey && event.key.toLowerCase() === "z") {
      if ((event.target as HTMLElement).tagName === "INPUT") return;
      event.preventDefault();
      event.stopPropagation();
      undoLast();
    }
  };

  const computedHeight = height ?? Math.min(maxHeight, (rows.length + 1) * rowHeight + 24);

  const describeSelection = (selection: { min: { col: number; row: number }; max: { col: number; row: number } } | null) => {
    if (!selection) return setSelectionLabel("");
    const r = selection.max.row - selection.min.row + 1;
    const c = selection.max.col - selection.min.col + 1;
    setSelectionLabel(r * c > 1 ? `${r} fila${r === 1 ? "" : "s"} × ${c} columna${c === 1 ? "" : "s"} seleccionadas` : "");
  };

  return (
    <div
      className="space-y-2"
      data-testid={testId}
      onKeyDownCapture={onKeyDownCapture}
    >
      <div className="flex min-h-7 flex-wrap items-center gap-x-3 gap-y-1 text-xs" aria-live="polite">
        <span data-testid={`${testId}-status`} data-state={saveState} className="font-medium">
          {saveState === "saving" && <span className="text-[var(--os-text-muted)]">Guardando...</span>}
          {saveState === "saved" && (
            <span className="text-[var(--os-teal)]">✓ Guardado{savedCount > 1 ? ` (${savedCount} celdas)` : ""}</span>
          )}
          {saveState === "error" && <span className="text-[var(--genus-error)]">🔴 Error al guardar</span>}
        </span>
        {notice && (
          <span className="text-[var(--genus-error)]" role="alert" data-testid={`${testId}-notice`}>
            {notice}
          </span>
        )}
        <span className="text-[var(--os-text-muted)]">{selectionLabel}</span>
        <Button
          type="button"
          variant="secondary"
          size="sm"
          className="ml-auto h-7 px-2 text-xs"
          onClick={undoLast}
          disabled={undoDepth === 0}
          data-testid={`${testId}-undo`}
        >
          <Undo2 className="size-3.5" aria-hidden="true" />
          Deshacer
        </Button>
      </div>

      {failed.length > 0 && (
        <div
          className="space-y-1 rounded-[var(--os-radius-sm)] border border-[var(--genus-error)]/40 bg-[var(--genus-error-soft)] p-2 text-xs"
          role="alert"
          data-testid={`${testId}-failed`}
        >
          {failed.map((batch) => (
            <div key={batch.id} className="flex flex-wrap items-center gap-2">
              <span className="font-medium text-[var(--genus-error)]">
                🔴 {batch.changes.length === 1
                  ? `${batch.changes[0]!.rowLabel} · ${batch.changes[0]!.columnTitle}: ${previewValue(batch.changes[0]!.oldValue)} → ${previewValue(batch.changes[0]!.newValue)}`
                  : `${batch.changes.length} cambios`}{" "}
                sin guardar — {batch.message}
              </span>
              <Button type="button" size="sm" variant="secondary" className="h-6 px-2 text-xs" onClick={() => retryFailed(batch)}>
                Reintentar
              </Button>
              <Button type="button" size="sm" variant="secondary" className="h-6 px-2 text-xs" onClick={() => discardFailed(batch)}>
                Descartar
              </Button>
              {onReload && /Recarg|modific/i.test(batch.message) && (
                <Button type="button" size="sm" variant="secondary" className="h-6 px-2 text-xs" onClick={onReload}>
                  Recargar datos
                </Button>
              )}
            </div>
          ))}
        </div>
      )}

      <div className="genus-grid overflow-hidden rounded-[var(--os-radius-sm)] border border-[var(--os-border)]">
        <DataSheetGrid<GenusGridRow>
          ref={gridRef}
          value={gridRows}
          onChange={(next) => handleChange(next)}
          columns={gridColumns}
          rowKey="__id"
          lockRows
          addRowsComponent={false}
          disableContextMenu
          disableExpandSelection
          height={computedHeight}
          rowHeight={rowHeight}
          headerRowHeight={rowHeight}
          stickyRightColumn={stickyRight}
          gutterColumn={{ basis: 44, minWidth: 44, title: "#" } as never}
          onSelectionChange={({ selection }) => describeSelection(selection)}
        />
      </div>

      {hint && <p className="text-[11px] text-[var(--os-text-muted)]">{hint}</p>}

      <Dialog open={preview !== null} onOpenChange={(open) => !open && setPreview(null)}>
        <DialogContent className="max-h-[85vh] max-w-2xl overflow-y-auto" data-testid={`${testId}-preview`}>
          <DialogHeader>
            <DialogTitle>
              {preview && preview.changes.length === 0 && preview.invalid.length === 0
                ? "Celdas protegidas"
                : "Revisar cambios antes de guardar"}
            </DialogTitle>
            <DialogDescription>
              {preview
                ? `${preview.changes.length} válido${preview.changes.length === 1 ? "" : "s"} · ${preview.invalid.length} con error · ${preview.skipped.length} en celdas protegidas`
                : ""}
            </DialogDescription>
          </DialogHeader>
          {preview && (
            <div className="space-y-3 text-sm">
              {preview.skipped.length > 0 && (
                <section>
                  <h4 className="font-semibold text-[var(--genus-error)]">
                    {preview.skipped.length} celda(s) protegidas — NO se modifican
                  </h4>
                  <ul className="mt-1 max-h-32 overflow-y-auto text-xs">
                    {preview.skipped.slice(0, 30).map((s, i) => (
                      <li key={i}>
                        {s.rowLabel} · {s.columnTitle}: {s.reason}
                      </li>
                    ))}
                  </ul>
                </section>
              )}
              {preview.invalid.length > 0 && (
                <section>
                  <h4 className="font-semibold text-[var(--genus-error)]">{preview.invalid.length} valor(es) inválidos — NO se guardan</h4>
                  <ul className="mt-1 max-h-32 overflow-y-auto text-xs">
                    {preview.invalid.slice(0, 30).map(({ change, message }, i) => (
                      <li key={i}>
                        {change.rowLabel} · {change.columnTitle} “{change.newValue}”: {message}
                      </li>
                    ))}
                  </ul>
                </section>
              )}
              {preview.changes.length > 0 && (
                <section>
                  <h4 className="font-semibold">Se guardarán {preview.changes.length} celda(s)</h4>
                  <div className="mt-1 max-h-56 overflow-y-auto rounded border border-[var(--os-border)]">
                    <table className="w-full text-xs">
                      <thead className="sticky top-0 bg-[var(--os-bg)] text-left">
                        <tr>
                          <th className="px-2 py-1">Registro</th>
                          <th className="px-2 py-1">Columna</th>
                          <th className="px-2 py-1">Antes</th>
                          <th className="px-2 py-1">Después</th>
                        </tr>
                      </thead>
                      <tbody>
                        {preview.changes.slice(0, 100).map((c, i) => (
                          <tr key={i} className="border-t border-[var(--os-border)]">
                            <td className="px-2 py-1 font-mono">{c.rowLabel}</td>
                            <td className="px-2 py-1">{c.columnTitle}</td>
                            <td className="px-2 py-1 text-[var(--os-text-muted)]">{previewValue(c.oldValue)}</td>
                            <td className="px-2 py-1 font-medium">{previewValue(c.newValue)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                  {preview.changes.length > 100 && (
                    <p className="mt-1 text-xs text-[var(--os-text-muted)]">… y {preview.changes.length - 100} más.</p>
                  )}
                </section>
              )}
            </div>
          )}
          <DialogFooter>
            <Button type="button" variant="secondary" onClick={() => setPreview(null)}>
              {preview && preview.changes.length === 0 ? "Entendido" : "Cancelar (no guardar nada)"}
            </Button>
            {preview && preview.changes.length > 0 && (
              <Button type="button" variant="primary" onClick={applyPreview} data-testid={`${testId}-preview-apply`}>
                {preview.invalid.length + preview.skipped.length > 0
                  ? `Guardar solo las ${preview.changes.length} válidas`
                  : `Guardar ${preview.changes.length} cambio${preview.changes.length === 1 ? "" : "s"}`}
              </Button>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
