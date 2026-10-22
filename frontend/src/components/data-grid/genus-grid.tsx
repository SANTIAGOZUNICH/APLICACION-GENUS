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
import { ArrowDown, ArrowUp, ClipboardPaste, Copy, Eraser, Lock, Redo2, Replace, Rows3, Trash2, Undo2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { friendlySaveError } from "@/lib/ui/friendly-error";
import { diffGridRows, previewValue, type CellDiff, type GenusGridRow } from "./grid-changes";
import { defaultFillMode, fillValues, formatSheetNumber, parseSheetNumber, type FillMode } from "./fill-series";
import { SheetHScrollbar, SheetVScrollbar, SHEET_BAR_SIZE } from "./sheet-scrollbars";
import { ScrollGuard } from "./scroll-guard";
import { useSheetGestures, type FillPlan, type SheetRange } from "./sheet-gestures";
import { DRAFT_PREFIX, applyPastedToDrafts, isDraftRowId, mapPastedToDrafts, missingRequired, newDraft, parseClipboardMatrix, parseDrafts, serializeDrafts, topUpDrafts, type DraftRow } from "./draft-rows";

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
  /** Ancho elegido por el usuario: la columna mide exactamente `basis` (no se estira para llenar la hoja). */
  fixedWidth?: boolean;
  /** Clase extra por celda (p. ej. «editado en GENUS» / conflicto). Opcional y aditivo. */
  cellClassName?: (row: T) => string | undefined;
  /** Nota de trazabilidad de la celda (null = sin nota): marca visible y texto al pasar el mouse. No bloquea. */
  cellNote?: (row: T) => string | null;
  /** Modo planilla: motivo por el que el relleno arrastrando NO escribe en esta columna (calculada, mueve stock…). */
  noFill?: string;
  /**
   * Con `noFill`: el relleno arrastrando SÍ escribe en esta columna, pero pasa por la confirmación con motivo (mueve
   * stock). Borrar (Delete) sigue bloqueado. Sin esto una serie 1, 2 → 3, 4… sobre kg se descartaba sin explicación.
   */
  fillWithReason?: boolean;
}

/** Motivo que queda registrado cuando el relleno arrastrando corrige kg (no se le pide al usuario). */
const FILL_AUTO_REASON = "Autocompletar arrastrando en la planilla";

export interface GenusGridCellChange {
  rowId: string;
  columnKey: string;
  columnTitle: string;
  rowLabel: string;
  oldValue: string;
  newValue: string;
  /** Versión del registro que el usuario tenía al editar. */
  rowVersion: string;
  /** Motivo declarado por el usuario (ediciones que lo exigen, p. ej. históricas). */
  reason?: string;
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
  /** Motivo que se muestra en las celdas cuando `canEdit` es false (por defecto: falta de permiso del sector). */
  readOnlyReason?: string;
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
  /**
   * Si devuelve un texto, esas ediciones piden un MOTIVO antes de guardarse (trazabilidad de
   * ediciones históricas / que alimentan indicadores). El motivo viaja en `change.reason`.
   */
  reasonRequired?: (changes: GenusGridCellChange[]) => string | null;
  /** El motivo de UNA celda se pide en una barra dentro de la planilla (sin ventana modal). */
  reasonInline?: boolean;
  minReasonLength?: number;
  testId?: string;
  /** Clase CSS opcional por fila (p. ej. borde de prioridad). No afecta edición ni selección. */
  rowClassName?: (row: T) => string | undefined;
  /** Texto de ayuda en el pie. */
  hint?: ReactNode;
  /**
   * MODO PLANILLA (Materias Primas): se comporta como Excel — sin vistas previas ni confirmaciones para ediciones
   * normales (pegar rangos, borrar varias celdas, rellenar); el motivo se pide SOLO para lo que mueve stock; barras de
   * desplazamiento fijas y gruesas; controlador de relleno (mouse y táctil); Deshacer/Rehacer.
   */
  sheet?: boolean;
  /** Modo planilla: eliminación de filas completas sin motivo ni confirmación (con Deshacer). */
  rowDelete?: GenusGridRowDelete;
  /** Modo planilla: insertar filas en blanco en cualquier lugar y mover filas (orden manual persistente). */
  rowOps?: GenusGridRowOps;
  /** Modo planilla: filas en blanco al final para crear registros escribiendo directamente. */
  draftRows?: GenusGridDraftRows;
  /**
   * Clave de almacenamiento local de los cambios que NO se pudieron guardar (sin conexión, error): se conservan al
   * recargar, se reintentan solos al volver la conexión y se avisa antes de cerrar la pestaña con cambios sin guardar.
   */
  queueKey?: string;
}

/**
 * Filas en blanco al final (como Excel): se escribe directo en ellas y el registro se CREA recién cuando la fila tiene
 * todos los datos obligatorios (nunca se guarda una fila incompleta). Mientras tanto vive en el navegador.
 */
export interface GenusGridDraftRows {
  /** Columnas que se pueden escribir en una fila nueva (el resto se calcula al crear y queda bloqueado). */
  createKeys: string[];
  /** Columnas obligatorias para crear el registro. */
  requiredKeys: string[];
  /** Clave de almacenamiento local (incluir el usuario y la planilla) para no perder lo escrito si se corta la conexión. */
  storageKey: string;
  /** Cantidad de filas vacías que se mantienen siempre al final (por defecto 8). */
  minBlank?: number;
  /** Validación de la fila completa antes de crear (null = válida). */
  validate?: (values: Record<string, string>) => string | null;
  /** Crea el registro. `draftId` es el id definitivo: reintentar con el mismo id NUNCA duplica. */
  onCreate: (draftId: string, values: Record<string, string>) => Promise<{ ok: boolean; message?: string }>;
}

const MIN_SHEET_HEIGHT = 240;
const SHEET_BOTTOM_RESERVE = 48;

export interface GenusGridRowDelete {
  /** Motivo por el que NO se puede eliminar esa fila (null = se puede). */
  check: (rowId: string) => string | null;
  /** Elimina las filas (ya filtradas por `check`). Resuelve con el resumen y, si se puede, cómo deshacerlo. */
  onDelete: (rowIds: string[]) => Promise<{ ok: boolean; message: string; undo?: () => Promise<void> }>;
}

/**
 * Filas como en Excel (modo planilla): insertar una fila en blanco en cualquier lugar y mover filas, con orden manual
 * persistente en el servidor. Los handlers deben resolver recién cuando la lista ya se recargó.
 */
export interface GenusGridRowOps {
  /** false = el orden visible no es el de la hoja (hay otro orden elegido): las acciones de orden se desactivan. */
  enabled?: boolean;
  /** Inserta una fila en blanco antes de `beforeId` (null = al final). */
  onInsert: (beforeId: string | null) => Promise<{ ok: boolean; message?: string }>;
  /** Mueve la fila `id` para que quede antes de `beforeId` (null = al final). */
  onMove: (id: string, beforeId: string | null) => Promise<{ ok: boolean; message?: string }>;
}

type SaveState = "idle" | "saving" | "saved" | "error";

interface PreviewState {
  /** Pide motivo (texto de la pregunta) antes de aplicar. */
  reasonPrompt?: string | null;
  changes: GenusGridCellChange[];
  invalid: { change: GenusGridCellChange; message: string }[];
  skipped: { rowLabel: string; columnTitle: string; reason: string }[];
  /** Aviso (existencias reales) que se muestra en la confirmación conjunta. */
  stockNote?: string;
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

/** UUID v4: también es el id definitivo del registro que se crea desde una fila en blanco. */
function makeDraftId(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") return crypto.randomUUID();
  return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    return (c === "x" ? r : (r & 0x3) | 0x8).toString(16);
  });
}

const cellKey = (rowId: string, columnKey: string) => `${rowId}\u0000${columnKey}`;
/** Celdas por solicitud al guardar (el servidor acepta hasta 1000). */
const COMMIT_CHUNK = 400;

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
  const note = reason ? null : (rowData.__note?.[colKey] ?? null);
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
    <div ref={wrapRef} className="genus-cell-wrap" title={reason ?? note ?? undefined}>
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
      {note ? <span className="genus-cell-note" aria-label={note} data-genus-note="1" /> : null}
    </div>
  );
}

/** Resumen de las filas nuevas en preparación: qué falta, errores con reintento y «agregar filas». */
function DraftInfo({
  drafts,
  requiredKeys,
  titleOf,
  testId,
  onAddRows,
  onRetry,
}: {
  drafts: DraftRow[];
  requiredKeys: string[];
  titleOf: (key: string) => string;
  testId: string;
  onAddRows: () => void;
  onRetry: (id: string) => void;
}) {
  const used = drafts.filter((d) => Object.values(d.values).some((v) => v.trim() !== ""));
  const incomplete = used.filter((d) => d.status === "editing" && missingRequired(d, requiredKeys).length > 0);
  const failed = used.filter((d) => d.status === "error");
  const missingTitles = [...new Set(incomplete.flatMap((d) => missingRequired(d, requiredKeys)))].map(titleOf);
  return (
    <div className="flex flex-wrap items-center gap-2 text-xs text-[var(--os-text-muted)]" data-testid={`${testId}-drafts-info`}>
      <span>Filas en blanco al final: escribí directo y la fila se crea sola cuando tiene {requiredKeys.map(titleOf).join(", ")}.</span>
      {incomplete.length > 0 ? (
        <span className="rounded bg-amber-500/15 px-2 py-0.5 text-amber-800 dark:text-amber-300" data-testid={`${testId}-drafts-incomplete`}>
          {incomplete.length} fila{incomplete.length === 1 ? "" : "s"} nueva{incomplete.length === 1 ? "" : "s"} sin completar (falta {missingTitles.join(", ")}): no se guarda{incomplete.length === 1 ? "" : "n"} hasta completar{incomplete.length === 1 ? "la" : "las"}.
        </span>
      ) : null}
      {failed.map((d) => (
        <span key={d.id} className="inline-flex items-center gap-1 rounded bg-red-500/15 px-2 py-0.5 text-red-800 dark:text-red-300" data-testid={`${testId}-drafts-error`}>
          No se creó: {d.error ?? "error"}
          <button type="button" className="min-h-8 rounded border border-current px-2 font-medium" onClick={() => onRetry(d.id)}>
            Reintentar
          </button>
        </span>
      ))}
      <button type="button" className="min-h-11 rounded border border-[var(--os-border)] px-3 font-medium text-[var(--os-text)]" onClick={onAddRows} data-testid={`${testId}-drafts-add`}>
        + 10 filas
      </button>
    </div>
  );
}

/**
 * Primera columna fija al desplazar a los costados (como «inmovilizar paneles» de Excel). El motor virtualiza las
 * columnas (la primera se desmonta al salir de la vista), así que la columna identificadora se refleja en un panel
 * fijo, de solo lectura; tocarla selecciona la fila completa.
 */
function FrozenFirstColumn({
  scroller,
  rows,
  columnKey,
  title,
  rowHeight,
  onSelectRow,
  testId,
}: {
  scroller: HTMLElement | null;
  rows: GenusGridRow[];
  columnKey: string | undefined;
  title: string;
  rowHeight: number;
  onSelectRow: (row: number) => void;
  testId: string;
}) {
  const [view, setView] = useState({ left: 0, top: 0, height: 0, width: 140 });
  useEffect(() => {
    if (!scroller) return;
    const read = () => {
      const h = scroller.querySelector(".dsg-row-header .genus-col-0");
      setView((p) => {
        const width = h ? Math.round(h.getBoundingClientRect().width) : p.width;
        return p.left === scroller.scrollLeft && p.top === scroller.scrollTop && p.height === scroller.clientHeight && p.width === width
          ? p
          : { left: scroller.scrollLeft, top: scroller.scrollTop, height: scroller.clientHeight, width };
      });
    };
    read();
    scroller.addEventListener("scroll", read, { passive: true });
    const ro = new ResizeObserver(read);
    ro.observe(scroller);
    return () => {
      scroller.removeEventListener("scroll", read);
      ro.disconnect();
    };
  }, [scroller]);
  if (!scroller || !columnKey || view.left < 8) return null;
  const first = Math.max(0, Math.floor(view.top / rowHeight) - 1);
  const last = Math.min(rows.length - 1, Math.ceil((view.top + view.height) / rowHeight));
  const items = Array.from({ length: Math.max(0, last - first + 1) }, (_, i) => first + i).map((r) => (
    <div
      key={rows[r]!.__id}
      className="genus-frozen-cell"
      style={{ top: rowHeight * (r + 1) - view.top, height: rowHeight }}
      onClick={() => onSelectRow(r)}
      title={String(rows[r]![columnKey] ?? "")}
    >
      <span className="truncate">{String(rows[r]![columnKey] ?? "")}</span>
    </div>
  ));
  return (
    <div className="genus-frozen-col" style={{ left: 44, width: view.width, height: view.height }} data-testid={`${testId}-frozen-col`}>
      <div className="genus-frozen-head" style={{ height: rowHeight }}>
        <span className="truncate">{title}</span>
      </div>
      {items}
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
  readOnlyReason,
  previewThreshold = 5,
  height,
  maxHeight = 560,
  rowHeight = 36,
  renderRowActions,
  rowActionsWidth = 96,
  onReload,
  reasonRequired,
  reasonInline = false,
  minReasonLength = 8,
  testId = "genus-grid",
  hint,
  rowClassName,
  sheet = false,
  rowDelete,
  rowOps,
  draftRows,
  queueKey,
}: GenusGridProps<T>) {
  const [reasonText, setReasonText] = useState("");
  const gridRef = useRef<DataSheetGridRef>(null);
  /** La hoja solo se mueve cuando la mueve el usuario: durante guardados/recargas se revierte cualquier salto ajeno. */
  const guardRef = useRef<ScrollGuard | null>(null);
  // Cambios pendientes de una sesión anterior (se cortó la conexión o se recargó): vuelven a la barra roja para reintentar.
  const restored = useMemo<FailedBatch[]>(() => {
    if (!queueKey || typeof window === "undefined") return [];
    try {
      const parsed = JSON.parse(window.localStorage.getItem(queueKey) ?? "[]") as FailedBatch[];
      return Array.isArray(parsed) ? parsed.filter((b) => b && Array.isArray(b.changes) && b.changes.length > 0) : [];
    } catch {
      return [];
    }
    // solo al montar
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const [overlay, setOverlay] = useState<Record<string, { value: string; status: "saving" | "error" }>>(() => {
    const init: Record<string, { value: string; status: "saving" | "error" }> = {};
    for (const b of restored) for (const c of b.changes) init[cellKey(c.rowId, c.columnKey)] = { value: c.oldValue, status: "error" };
    return init;
  });
  const [saveState, setSaveState] = useState<SaveState>("idle");
  const [savedCount, setSavedCount] = useState(0);
  const [notice, setNotice] = useState<string | null>(null);
  const [failed, setFailed] = useState<FailedBatch[]>(restored);
  const [preview, setPreview] = useState<PreviewState | null>(null);
  /** Motivo pedido EN LA PLANILLA (una celda que mueve saldo): barra en línea, sin ventana modal. */
  const [inlineReason, setInlineReason] = useState<{ changes: GenusGridCellChange[]; prompt: string } | null>(null);
  const [inlineText, setInlineText] = useState("");
  const [undoDepth, setUndoDepth] = useState(0);
  const [redoDepth, setRedoDepth] = useState(0);
  const redoStack = useRef<GenusGridCellChange[][]>([]);
  const wrapRef = useRef<HTMLDivElement>(null);
  const selectionRef = useRef<SheetRange | null>(null);
  const activeRef = useRef<{ col: number; row: number } | null>(null);
  /** Última selección/celda no vacía: la barra táctil actúa sobre ella aunque tocar un botón desactive la celda. */
  const lastRangeRef = useRef<SheetRange | null>(null);
  const [scroller, setScroller] = useState<HTMLElement | null>(null);
  // Menú «Rellenar» (barra de celdas): orden numérico o igual, con vista previa si pisa datos existentes.
  const [fillMenu, setFillMenu] = useState<{ seriesReason: string | null; rangeReason: string | null; preview: { mode: "series" | "copy"; diffs: CellDiff[]; skipped: PreviewState["skipped"]; notes: string[]; overwrites: number; samples: string[] } | null } | null>(null);
  const [fillChip, setFillChip] = useState<{ plan: FillPlan; mode: FillMode; sourceIds: string[]; note: string } | null>(null);
  const [rowDeleteResult, setRowDeleteResult] = useState<{ message: string; undo?: () => Promise<void> } | null>(null);
  const [selectedRowCount, setSelectedRowCount] = useState(0);
  const [selectionLabel, setSelectionLabel] = useState("");
  const minBlank = draftRows?.minBlank ?? 8;
  const [drafts, setDrafts] = useState<DraftRow[]>(() => {
    if (!draftRows) return [];
    let stored: DraftRow[] = [];
    try {
      if (typeof window !== "undefined") stored = parseDrafts(window.localStorage.getItem(draftRows.storageKey));
    } catch {
      /* sin almacenamiento local: arranca vacío */
    }
    return topUpDrafts(stored, minBlank, makeDraftId);
  });
  const [findOpen, setFindOpen] = useState(false);
  const [findText, setFindText] = useState("");
  const [replaceText, setReplaceText] = useState("");
  const [findCol, setFindCol] = useState("");
  const [findCase, setFindCase] = useState(false);
  const [replaceConfirm, setReplaceConfirm] = useState(false);
  const draftsRef = useRef(drafts);
  const draftTimers = useRef(new Map<string, ReturnType<typeof setTimeout>>());
  const applyDraftDiffsRef = useRef<(diffs: CellDiff[]) => void>(() => {});

  const undoStack = useRef<GenusGridCellChange[][]>([]);
  const queue = useRef<Promise<unknown>>(Promise.resolve());
  const batchSeq = useRef(restored.reduce((m, b) => Math.max(m, b.id), 0));
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
        const out: GenusGridRow = { __id: id, __version: rowVersion(row), __prot: {}, __st: {}, __note: {} };
        for (const col of columns) {
          if (col.cellNote) out.__note![col.key] = col.cellNote(row);
          const ov = overlay[cellKey(id, col.key)];
          out[col.key] = ov ? ov.value : col.getValue(row);
          out.__prot[col.key] = canEdit ? (col.protection?.(row) ?? null) : (readOnlyReason ?? "Tu sector no puede editar esta tabla.");
          if (ov) out.__st[col.key] = ov.status;
        }
        return out;
      }).concat(
        draftRows
          ? drafts.map((d) => {
              const out: GenusGridRow = { __id: `${DRAFT_PREFIX}${d.id}`, __version: "", __prot: {}, __st: {}, __note: {} };
              for (const col of columns) {
                out[col.key] = d.values[col.key] ?? "";
                out.__prot[col.key] = !canEdit
                  ? (readOnlyReason ?? "Tu sector no puede editar esta tabla.")
                  : draftRows.createKeys.includes(col.key)
                    ? null
                    : "Se completa solo al crear el registro.";
                if (d.status !== "editing") out.__st[col.key] = d.status === "saving" ? "saving" : "error";
              }
              return out;
            })
          : []
      ),
    [rows, columns, overlay, rowId, rowVersion, canEdit, readOnlyReason, draftRows, drafts]
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
    draftsRef.current = drafts;
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
    return columns.map((col, colIndex) => {
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
        headerClassName: `genus-col-${colIndex}`,
        basis: col.basis ?? 140,
        minWidth: col.fixedWidth ? (col.basis ?? 140) : (col.minWidth ?? 80),
        grow: col.fixedWidth ? 0 : 1,
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
          const classes: string[] = [`genus-col-${colIndex}`];
          if (rowData.__prot[key]) classes.push("genus-cell-protected");
          if (rowData.__st[key] === "saving") classes.push("genus-cell-saving");
          if (rowData.__st[key] === "error") classes.push("genus-cell-error");
          if (kind === "number") classes.push("genus-cell-num");
          if (col.cellClassName) {
            const source = rowByIdRef.current.get(rowData.__id);
            const extra = source ? col.cellClassName(source) : undefined;
            if (extra) classes.push(extra);
          }
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
    (
      changes: GenusGridCellChange[],
      opts: { useLatestVersion: boolean; recordUndo: boolean; retryOf?: number; recordRedo?: boolean; keepRedo?: boolean }
    ) => {
      setNotice(null);
      setSaveState("saving");
      guardRef.current?.lock(3000);
      if (!opts.keepRedo) {
        redoStack.current = [];
        setRedoDepth(0);
      }
      setOverlay((prev) => {
        const next = { ...prev };
        for (const c of changes) next[cellKey(c.rowId, c.columnKey)] = { value: c.newValue, status: "saving" };
        return next;
      });
      const job = queue.current.then(async () => {
        // Deja que el re-render del guardado anterior termine: así las versiones leídas son las confirmadas por la base.
        if (opts.useLatestVersion) await new Promise((resolve) => window.setTimeout(resolve, 80));
        const toSend = changes.map((c) => {
          const latest = opts.useLatestVersion ? rowByIdRef.current.get(c.rowId) : undefined;
          return latest ? { ...c, rowVersion: rowVersion(latest) } : c;
        });
        // Guardado por LOTES: todas las celdas de una fila viajan juntas (comparten versión); un lote no supera CHUNK celdas.
        const chunks: GenusGridCellChange[][] = [];
        {
          const byRow = new Map<string, GenusGridCellChange[]>();
          for (const c of toSend) byRow.set(c.rowId, [...(byRow.get(c.rowId) ?? []), c]);
          let cur: GenusGridCellChange[] = [];
          for (const group of byRow.values()) {
            if (cur.length > 0 && cur.length + group.length > COMMIT_CHUNK) {
              chunks.push(cur);
              cur = [];
            }
            cur.push(...group);
          }
          if (cur.length) chunks.push(cur);
        }
        let result: GenusGridCommitResult = { ok: true };
        const failures: NonNullable<GenusGridCommitResult["failures"]> = [];
        const okChunks = new Set<GenusGridCellChange[]>();
        for (const chunk of chunks) {
          let r: GenusGridCommitResult;
          try {
            r = await onCommit(chunk);
          } catch (err) {
            // Sin conexión / error técnico: mensaje simple. El valor escrito queda en la barra roja con «Reintentar».
            r = { ok: false, message: friendlySaveError(err) };
          }
          if (r.ok) okChunks.add(chunk);
          else {
            if (result.ok) result = { ok: false, message: r.message };
            if (r.failures?.length) failures.push(...r.failures);
            else failures.push(...chunk.map((c) => ({ rowId: c.rowId, columnKey: c.columnKey, message: r.message ?? "" })));
          }
        }
        if (!result.ok) result = { ...result, failures };
        // Fallo PARCIAL (filas de Google / lotes): solo las celdas rechazadas quedan en error; las confirmadas se limpian.
        const failedKeys = new Set((result.failures ?? []).map((f) => cellKey(f.rowId, f.columnKey)));
        const failedChanges = result.ok ? [] : changes.filter((c) => failedKeys.has(cellKey(c.rowId, c.columnKey)));
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
        const savedChanges = result.ok ? toSend : toSend.filter((c) => !failedSet.has(cellKey(c.rowId, c.columnKey)));
        if (savedChanges.length > 0) {
          if (opts.retryOf != null && result.ok) setFailed((prev) => prev.filter((b) => b.id !== opts.retryOf));
          const reversed = savedChanges.map((c) => ({ ...c, oldValue: c.newValue, newValue: c.oldValue }));
          if (opts.recordUndo) {
            undoStack.current.push(reversed);
            undoStack.current = undoStack.current.slice(-50);
            setUndoDepth(undoStack.current.length);
          }
          if (opts.recordRedo) {
            redoStack.current.push(reversed);
            setRedoDepth(redoStack.current.length);
          }
          markSaved(savedChanges.length);
        }
        if (!result.ok) {
          const message = friendlySaveError({ message: result.failures?.[0]?.message ?? result.message ?? "" }, "No se pudo guardar.");
          setSaveState("error");
          setFailed((prev) => {
            const id = opts.retryOf ?? ++batchSeq.current;
            const entry = { id, changes: failedChanges, message };
            return prev.some((b) => b.id === id) ? prev.map((b) => (b.id === id ? entry : b)) : [...prev, entry];
          });
        }
      });
      queue.current = job.catch(() => undefined);
      void job.finally(() => guardRef.current?.lock(3000));
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

  // Cola persistente: los cambios fallidos sobreviven a una recarga y se reintentan solos al volver la conexión.
  const failedRef = useRef(failed);
  useLayoutEffect(() => {
    failedRef.current = failed;
  });
  useEffect(() => {
    if (!queueKey) return;
    try {
      if (failed.length === 0) window.localStorage.removeItem(queueKey);
      else window.localStorage.setItem(queueKey, JSON.stringify(failed));
    } catch {
      /* sin almacenamiento local */
    }
  }, [failed, queueKey]);
  useEffect(() => {
    if (!queueKey) return;
    const onOnline = () => failedRef.current.forEach((b) => void runCommit(b.changes, { useLatestVersion: false, recordUndo: true, retryOf: b.id }));
    const onBeforeUnload = (e: BeforeUnloadEvent) => {
      if (failedRef.current.length > 0) {
        e.preventDefault();
        e.returnValue = "";
      }
    };
    window.addEventListener("online", onOnline);
    window.addEventListener("beforeunload", onBeforeUnload);
    return () => {
      window.removeEventListener("online", onOnline);
      window.removeEventListener("beforeunload", onBeforeUnload);
    };
  }, [queueKey, runCommit]);

  const undoLast = useCallback(() => {
    const batch = undoStack.current.pop();
    setUndoDepth(undoStack.current.length);
    if (batch) void runCommit(batch, { useLatestVersion: true, recordUndo: false, recordRedo: true, keepRedo: true });
  }, [runCommit]);

  const redoLast = useCallback(() => {
    const batch = redoStack.current.pop();
    setRedoDepth(redoStack.current.length);
    if (batch) void runCommit(batch, { useLatestVersion: true, recordUndo: true, keepRedo: true });
  }, [runCommit]);

  // ---- filas en blanco: se crean recién cuando están completas; mientras tanto viven en el navegador ----
  const submitDraft = useCallback(
    async (id: string) => {
      if (!draftRows) return;
      const d = draftsRef.current.find((x) => x.id === id);
      if (!d || d.status === "saving") return;
      if (missingRequired(d, draftRows.requiredKeys).length > 0) return;
      const invalid = draftRows.validate?.(d.values) ?? null;
      const patch = (p: Partial<DraftRow>) => setDrafts((prev) => prev.map((x) => (x.id === id ? { ...x, ...p } : x)));
      if (invalid) {
        patch({ status: "error", error: invalid });
        setNotice(`Fila nueva no creada — ${invalid}`);
        return;
      }
      patch({ status: "saving", error: undefined });
      setSaveState("saving");
      let res: { ok: boolean; message?: string };
      try {
        res = await draftRows.onCreate(d.id, d.values);
      } catch (e) {
        res = { ok: false, message: friendlySaveError(e, "No se pudo crear la fila.") };
      }
      if (res.ok) {
        setDrafts((prev) => topUpDrafts(prev.filter((x) => x.id !== id), minBlank, makeDraftId));
        setSaveState("saved");
        setSavedCount((n) => n + 1);
        setNotice(res.message ?? null);
        onReload?.();
      } else {
        patch({ status: "error", error: res.message ?? "No se pudo crear la fila." });
        setSaveState("error");
        setNotice(`Fila nueva no creada — ${res.message ?? "error"}. Lo escrito se conserva: corregí la fila o tocá una celda para reintentar.`);
      }
    },
    [draftRows, minBlank, onReload]
  );
  const scheduleDraftSubmit = useCallback(
    (id: string) => {
      const old = draftTimers.current.get(id);
      if (old) clearTimeout(old);
      // Pequeña espera: el usuario suele seguir escribiendo las celdas de la misma fila (ubicación, observaciones…).
      draftTimers.current.set(id, setTimeout(() => void submitDraft(id), 1200));
    },
    [submitDraft]
  );
  useLayoutEffect(() => {
    applyDraftDiffsRef.current = (diffs) => {
      const touched = new Set<string>();
      setDrafts((prev) =>
        topUpDrafts(
          prev.map((d) => {
            const mine = diffs.filter((x) => x.rowId === `${DRAFT_PREFIX}${d.id}`);
            if (mine.length === 0) return d;
            touched.add(d.id);
            const values = { ...d.values };
            for (const x of mine) values[x.columnKey] = x.newValue;
            return { ...d, values, status: d.status === "saving" ? d.status : "editing", error: undefined };
          }),
          minBlank,
          makeDraftId
        )
      );
      // setDrafts es asíncrono: los ids tocados se calculan a partir de los diffs.
      for (const x of diffs) touched.add(x.rowId.slice(DRAFT_PREFIX.length));
      touched.forEach((id) => scheduleDraftSubmit(id));
    };
  }, [minBlank, scheduleDraftSubmit]);
  // Conserva en el navegador lo escrito en filas todavía no creadas (corte de conexión, recarga).
  useEffect(() => {
    if (!draftRows) return;
    try {
      const raw = serializeDrafts(drafts);
      if (raw === "[]") window.localStorage.removeItem(draftRows.storageKey);
      else window.localStorage.setItem(draftRows.storageKey, raw);
    } catch {
      /* sin almacenamiento local */
    }
  }, [drafts, draftRows]);
  // Al volver la conexión se reintentan las filas completas que habían fallado.
  useEffect(() => {
    if (!draftRows) return;
    const onOnline = () => draftsRef.current.filter((d) => d.status === "error").forEach((d) => void submitDraft(d.id));
    window.addEventListener("online", onOnline);
    return () => window.removeEventListener("online", onOnline);
  }, [draftRows, submitDraft]);
  useEffect(() => {
    const timers = draftTimers.current;
    return () => timers.forEach((t) => clearTimeout(t));
  }, []);

  // ---- cambios (edición, pegado, suprimir, relleno): validación + decisión de cómo guardarlos ----
  const processDiffs = useCallback(
    (allDiffs: CellDiff[], skipped: PreviewState["skipped"], extraNotes: string[] = [], autoReason?: string) => {
      // Las filas en blanco del final son locales: se actualizan aparte y se crean recién al estar completas.
      const draftDiffs = allDiffs.filter((d) => isDraftRowId(d.rowId));
      const diffs = draftDiffs.length ? allDiffs.filter((d) => !isDraftRowId(d.rowId)) : allDiffs;
      if (draftDiffs.length) applyDraftDiffsRef.current(draftDiffs);
      if (diffs.length === 0 && skipped.length === 0 && extraNotes.length === 0) return;

      const changes: GenusGridCellChange[] = [];
      const invalid: PreviewState["invalid"] = [];
      let notCleared = 0;
      for (const d of diffs) {
        const source = rowByIdRef.current.get(d.rowId);
        const col = columnByKey.get(d.columnKey);
        if (!source || !col) continue;
        // Modo planilla: «vaciar» (Delete sobre un rango) no toca columnas calculadas ni que mueven stock.
        if (sheet && d.newValue === "" && col.noFill) {
          notCleared += 1;
          continue;
        }
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
      if (total === 0 && skipped.length === 0 && extraNotes.length === 0 && notCleared === 0) return;

      // ---- MODO PLANILLA: como Excel — se guarda directo; solo lo que mueve stock pide motivo ----
      if (sheet) {
        // Autocompletar arrastrando: lo que mueve existencias reales (Kg lote) se confirma TODO JUNTO, sin pedir un motivo
        // por celda: el motivo queda automático en la auditoría del ajuste (usuario, fecha, valor anterior y nuevo).
        const fillStock = autoReason ? changes.filter((c) => columnByKey.get(c.columnKey)?.fillWithReason) : [];
        const rest = autoReason ? changes.filter((c) => !columnByKey.get(c.columnKey)?.fillWithReason) : changes;
        const moving = rest.filter((c) => Boolean(reasonRequired?.([c])));
        const plain = rest.filter((c) => !reasonRequired?.([c]));
        if (plain.length > 0) void runCommit(plain, { useLatestVersion: true, recordUndo: true });
        if (fillStock.length > 0 && autoReason) {
          setReasonText("");
          setPreview({
            changes: fillStock.map((c) => ({ ...c, reason: autoReason })),
            invalid: [],
            skipped: [],
            reasonPrompt: null,
            stockNote: `Este autocompletado modifica EXISTENCIAS REALES de ${fillStock.length} lote${fillStock.length === 1 ? "" : "s"}. Queda registrado en el libro mayor y en la auditoría (usuario, fecha, valor anterior y nuevo). Se puede deshacer con Ctrl+Z / Deshacer.`,
          });
        }
        const notes = [...extraNotes];
        if (notCleared > 0) notes.push(`${notCleared} celda${notCleared === 1 ? "" : "s"} no se vacía${notCleared === 1 ? "" : "n"} (columna calculada o que mueve stock)`);
        if (invalid.length > 0) {
          const first = invalid
            .slice(0, 2)
            .map(({ change, message }) => `${change.columnTitle} “${change.newValue}”: ${message}`)
            .join(" · ");
          notes.push(`No se guardó${invalid.length > 1 ? ` ${invalid.length} valores` : ""} — ${first}${invalid.length > 2 ? ` · y ${invalid.length - 2} más` : ""}`);
        }
        if (skipped.length > 0) {
          notes.push(`${skipped.length} celda${skipped.length === 1 ? "" : "s"} protegida${skipped.length === 1 ? "" : "s"} sin modificar (${skipped[0]!.reason})`);
        }
        if (moving.length > 0) {
          const prompt = reasonRequired?.(moving) ?? null;
          if (reasonInline && moving.length === 1 && prompt) {
            setInlineText("");
            setInlineReason({ changes: moving, prompt });
          } else {
            setReasonText("");
            setPreview({ changes: moving, invalid: [], skipped: [], reasonPrompt: prompt });
          }
        }
        if (notes.length > 0) setNotice(notes.join(" · "));
        return;
      }

      const touchesSensitive = changes.some((c) => columnByKey.get(c.columnKey)?.sensitive);
      const bulkDelete = changes.filter((c) => c.newValue === "" && c.oldValue !== "").length > 1;
      const reasonPrompt = changes.length > 0 ? (reasonRequired?.(changes) ?? null) : null;
      const needsPreview =
        Boolean(reasonPrompt) ||
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
      // Una sola celda que solo necesita motivo: se pide en la misma planilla (Enter guarda, Escape cancela).
      if (reasonInline && reasonPrompt && changes.length === 1 && invalid.length === 0 && skipped.length === 0 && !bulkDelete && !touchesSensitive) {
        setInlineText("");
        setInlineReason({ changes, prompt: reasonPrompt });
        return;
      }
      setReasonText("");
      setPreview({ changes, invalid, skipped, reasonPrompt });
    },
    [columnByKey, rowLabel, rowVersion, runCommit, reasonRequired, reasonInline, previewThreshold, sheet]
  );

  const handleChange = useCallback(
    (next: GenusGridRow[]) => {
      const diffs = diffGridRows(gridRowsRef.current, next, columnKeys);
      const skipped = flushSkips();
      setFillChip(null);
      processDiffs(diffs, skipped);
    },
    [columnKeys, flushSkips, processDiffs]
  );

  // ---- relleno arrastrando (controlador de la esquina de la selección) ----
  const applyFill = useCallback(
    (plan: FillPlan, forceMode?: FillMode) => {
      const rowsNow = gridRowsRef.current;
      const { source } = plan;
      const srcColKeys = columnKeys.slice(source.min.col, source.max.col + 1);
      const rowsSrc = rowsNow.slice(source.min.row, source.max.row + 1);
      if (rowsSrc.length === 0 || srcColKeys.length === 0) return;
      const sourceIds = rowsSrc.map((r) => r.__id);
      const candidates: Array<{ row: number; key: string; value: string }> = [];
      let usedMode: FillMode = "copy";
      const kindOf = (key: string) => columnByKey.get(key)?.kind ?? "text";
      if (plan.axis === "v") {
        const count = plan.target.max.row - plan.target.min.row + 1;
        for (const key of srcColKeys) {
          const srcVals = rowsSrc.map((r) => String(r[key] ?? ""));
          const base = defaultFillMode(srcVals, kindOf(key));
          const mode: FillMode = forceMode ?? (plan.invert ? (base === "series" ? "copy" : "series") : base);
          if (mode === "series") usedMode = "series";
          const vals = fillValues(srcVals, count, plan.direction, mode, kindOf(key));
          vals.forEach((value, k) => {
            const row = plan.direction === 1 ? source.max.row + 1 + k : source.min.row - 1 - k;
            candidates.push({ row, key, value });
          });
        }
      } else {
        const count = plan.target.max.col - plan.target.min.col + 1;
        const kinds = new Set(srcColKeys.map(kindOf));
        const kind = kinds.size === 1 ? [...kinds][0]! : "text";
        rowsSrc.forEach((r, i) => {
          const srcVals = srcColKeys.map((key) => String(r[key] ?? ""));
          const base = defaultFillMode(srcVals, kind);
          const mode: FillMode = forceMode ?? (plan.invert ? (base === "series" ? "copy" : "series") : base);
          if (mode === "series") usedMode = "series";
          const vals = fillValues(srcVals, count, plan.direction, mode, kind);
          vals.forEach((value, k) => {
            const colIdx = plan.direction === 1 ? source.max.col + 1 + k : source.min.col - 1 - k;
            const key = columnKeys[colIdx];
            if (key) candidates.push({ row: source.min.row + i, key, value });
          });
        });
      }
      const diffs: CellDiff[] = [];
      const skipped: PreviewState["skipped"] = [];
      let omitted = 0;
      for (const cand of candidates) {
        const row = rowsNow[cand.row];
        const col = columnByKey.get(cand.key);
        if (!row || !col) continue;
        const current = String(row[cand.key] ?? "");
        if (current.trim() === cand.value.trim()) continue;
        const prot = row.__prot[cand.key];
        if (prot) {
          skipped.push({ rowLabel: row.__id, columnTitle: col.title, reason: prot });
          continue;
        }
        if (col.noFill && !col.fillWithReason) {
          omitted += 1;
          continue;
        }
        const probe: GenusGridCellChange = { rowId: row.__id, columnKey: cand.key, columnTitle: col.title, rowLabel: row.__id, oldValue: current, newValue: cand.value, rowVersion: row.__version };
        if (reasonRequired?.([probe]) && !col.fillWithReason) {
          omitted += 1; // mueve stock: no se rellena arrastrando (se edita la celda con su motivo)
          continue;
        }
        diffs.push({ rowId: row.__id, columnKey: cand.key, oldValue: current, newValue: cand.value });
      }
      const rowsTouched = new Set(candidates.map((c) => c.row)).size;
      const notes: string[] = [];
      if (omitted > 0) notes.push(`${omitted} celda${omitted === 1 ? "" : "s"} omitida${omitted === 1 ? "" : "s"}: columna calculada o que mueve stock (se edita con su motivo)`);
      processDiffs(diffs, skipped, notes, FILL_AUTO_REASON);
      setFillChip({
        plan,
        mode: usedMode,
        sourceIds,
        note: `${diffs.length} celda${diffs.length === 1 ? "" : "s"} en ${rowsTouched} fila${rowsTouched === 1 ? "" : "s"} visible${rowsTouched === 1 ? "" : "s"}`,
      });
    },
    [columnKeys, columnByKey, processDiffs, reasonRequired]
  );

  // ---- eliminar filas (modo planilla): sin motivo ni confirmación, con Deshacer ----
  const deleteSelectedRows = useCallback(async () => {
    if (!rowDelete) return;
    const sel = selectionRef.current ?? lastRangeRef.current;
    if (!sel) return;
    const rowsNow = gridRowsRef.current;
    const ids = rowsNow.slice(sel.min.row, sel.max.row + 1).map((r) => r.__id).filter((id) => !isDraftRowId(id));
    const ok: string[] = [];
    const blocked: string[] = [];
    for (const id of ids) {
      const why = rowDelete.check(id);
      if (why) blocked.push(`${rowLabel(rowByIdRef.current.get(id)!)}: ${why}`);
      else ok.push(id);
    }
    if (ok.length === 0) {
      setNotice(`No se eliminó nada — ${blocked.slice(0, 2).join(" · ")}`);
      return;
    }
    setNotice(null);
    setSaveState("saving");
    try {
      const res = await rowDelete.onDelete(ok);
      setSaveState(res.ok ? "saved" : "error");
      if (res.ok) markSaved(ok.length);
      setRowDeleteResult({ message: res.message + (blocked.length ? ` · ${blocked.length} no se pudieron eliminar (${blocked[0]})` : ""), undo: res.undo });
    } catch (err) {
      setSaveState("error");
      setNotice(friendlySaveError(err, "No se pudo eliminar."));
    }
  }, [rowDelete, rowLabel, markSaved]);

  const MIN_INLINE_REASON = 8;
  const applyInlineReason = (text: string) => {
    if (!inlineReason) return;
    const reason = text.trim();
    if (reason.length < MIN_INLINE_REASON) {
      setNotice(`Escribí el motivo (mín. ${MIN_INLINE_REASON} caracteres) o elegí uno de la lista.`);
      return;
    }
    const toApply = inlineReason.changes.map((c) => ({ ...c, reason }));
    setInlineReason(null);
    setNotice(null);
    void runCommit(toApply, { useLatestVersion: true, recordUndo: true });
  };
  const cancelInlineReason = () => {
    setInlineReason(null);
    setNotice("Cambio cancelado: no se guardó nada.");
  };

  const applyPreview = () => {
    if (!preview) return;
    const toApply = preview.reasonPrompt ? preview.changes.map((c) => ({ ...c, reason: reasonText.trim() })) : preview.changes;
    setPreview(null);
    if (toApply.length) void runCommit(toApply, { useLatestVersion: true, recordUndo: true });
  };

  // ---- Tab / Shift+Tab: saltan a la siguiente celda EDITABLE (como en una planilla con celdas bloqueadas) ----
  const tabDir = useRef<0 | 1 | -1>(0);
  const onActiveCellChange = useCallback(
    ({ cell }: { cell: { col: number; row: number } | null }) => {
      const dir = tabDir.current;
      tabDir.current = 0;
      if (!dir || !cell) return;
      const rowsNow = gridRowsRef.current;
      const isProtected = (r: number, c: number) => {
        const key = columnKeys[c];
        const row = rowsNow[r];
        return !row || !key || Boolean(row.__prot[key]);
      };
      if (!isProtected(cell.row, cell.col)) return;
      let r = cell.row;
      let c = cell.col;
      for (let i = 0; i < rowsNow.length * columnKeys.length; i++) {
        c += dir;
        if (c >= columnKeys.length) {
          c = 0;
          r += 1;
        } else if (c < 0) {
          c = columnKeys.length - 1;
          r -= 1;
        }
        if (r < 0 || r >= rowsNow.length) return;
        if (!isProtected(r, c)) {
          gridRef.current?.setActiveCell({ col: c, row: r });
          return;
        }
      }
    },
    [columnKeys]
  );

  // ---- Modo planilla: Ctrl+Z / Ctrl+Y valen con una celda activa aunque el foco esté en la página (el motor no enfoca nada) ----
  useEffect(() => {
    if (!sheet) return;
    const onKey = (event: KeyboardEvent) => {
      if (!activeRef.current || !(event.ctrlKey || event.metaKey)) return;
      const target = event.target as HTMLElement | null;
      if (target?.closest("input, textarea, select, [contenteditable='true']")) return;
      const key = event.key.toLowerCase();
      if (key === "z" && !event.shiftKey) {
        event.preventDefault();
        undoLast();
      } else if (key === "y" || (key === "z" && event.shiftKey)) {
        event.preventDefault();
        redoLast();
      }
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [sheet, undoLast, redoLast]);

  // ---- filas como en Excel: insertar en blanco y mover (el orden queda guardado en el servidor) ----
  const rowOpBusy = useRef(false);
  const runRowOp = useCallback(
    async (kind: "above" | "below" | "up" | "down") => {
      if (!rowOps || rowOpBusy.current) return;
      // Al tocar un botón de la barra el motor suelta la selección: se usa la última (como hace el resto de la barra).
      const sel = selectionRef.current ?? lastRangeRef.current;
      if (!sel) return;
      const list = gridRowsRef.current;
      const real = (i: number) => (i >= 0 && i < list.length && !isDraftRowId(list[i].__id) ? list[i].__id : null);
      let first = sel.min.row;
      let last = sel.max.row;
      while (first <= last && !real(first)) first += 1;
      while (last >= first && !real(last)) last -= 1;
      if (first > last) {
        setNotice("Elegí una fila ya cargada.");
        return;
      }
      rowOpBusy.current = true;
      setNotice(null);
      setSaveState("saving");
      guardRef.current?.lock(3000);
      const col = activeRef.current?.col ?? sel.min.col;
      try {
        let res: { ok: boolean; message?: string };
        let target = first;
        let targetEnd = last;
        if (kind === "above" || kind === "below") {
          const beforeIdx = kind === "above" ? first : last + 1;
          res = await rowOps.onInsert(real(beforeIdx));
          target = beforeIdx;
          targetEnd = beforeIdx;
        } else if (kind === "up") {
          const neighbor = real(first - 1);
          if (!neighbor) { setSaveState("idle"); return; }
          res = await rowOps.onMove(neighbor, real(last + 1));
          target = first - 1;
          targetEnd = last - 1;
        } else {
          const neighbor = real(last + 1);
          if (!neighbor) { setSaveState("idle"); return; }
          res = await rowOps.onMove(neighbor, real(first));
          target = first + 1;
          targetEnd = last + 1;
        }
        setSaveState(res.ok ? "saved" : "error");
        if (!res.ok) setNotice(res.message ?? "No se pudo mover la fila.");
        else {
          markSaved(1);
          guardRef.current?.lock(3000);
          // La selección sigue a las filas movidas / a la fila nueva (la lista ya se recargó).
          window.requestAnimationFrame(() => gridRef.current?.setSelection({ min: { col, row: target }, max: { col, row: targetEnd } }));
        }
      } catch (err) {
        setSaveState("error");
        setNotice(friendlySaveError(err, "No se pudo completar la operación de filas."));
      } finally {
        rowOpBusy.current = false;
      }
    },
    [rowOps, markSaved]
  );
  const runRowOpRef = useRef(runRowOp);
  useEffect(() => {
    runRowOpRef.current = runRowOp;
  }, [runRowOp]);
  useEffect(() => {
    if (!sheet || !rowOps) return;
    const onKey = (e: KeyboardEvent) => {
      if (!e.altKey || e.ctrlKey || e.metaKey || (e.key !== "ArrowUp" && e.key !== "ArrowDown")) return;
      const active = document.activeElement;
      const root = active?.closest(`[data-testid="${testId}"]`) ?? null;
      if (!root && active !== document.body) return;
      if (rowOps.enabled === false) return;
      e.preventDefault();
      e.stopPropagation();
      void runRowOpRef.current(e.key === "ArrowUp" ? "up" : "down");
    };
    document.addEventListener("keydown", onKey, true);
    return () => document.removeEventListener("keydown", onKey, true);
  }, [sheet, rowOps, testId]);

  // ---- Ctrl+Z (fuera de un input) ----
  const onKeyDownCapture = (event: React.KeyboardEvent<HTMLDivElement>) => {
    if (event.key === "Tab") tabDir.current = event.shiftKey ? -1 : 1;
    if (sheet) return; // en modo planilla lo maneja el listener global (ver arriba)
    const key = event.key.toLowerCase();
    if ((event.ctrlKey || event.metaKey) && !event.shiftKey && key === "z") {
      if ((event.target as HTMLElement).tagName === "INPUT") return;
      event.preventDefault();
      event.stopPropagation();
      undoLast();
    }
  };

  // ---- buscar y reemplazar (solo celdas editables de registros reales; las calculadas/protegidas no se tocan) ----
  const findMatches = useMemo(() => {
    const needle = findText;
    if (!findOpen || !needle) return { diffs: [] as CellDiff[], rows: 0, first: null as { row: number; col: number } | null };
    const flags = findCase ? "g" : "gi";
    const re = new RegExp(needle.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), flags);
    const diffs: CellDiff[] = [];
    const rowSet = new Set<string>();
    let first: { row: number; col: number } | null = null;
    gridRows.forEach((row, rowIdx) => {
      if (isDraftRowId(row.__id)) return;
      columns.forEach((col, colIdx) => {
        if (findCol && col.key !== findCol) return;
        if (col.noFill || row.__prot[col.key]) return;
        const current = String(row[col.key] ?? "");
        re.lastIndex = 0;
        if (!re.test(current)) return;
        re.lastIndex = 0;
        const next = current.replace(re, () => replaceText);
        if (next.trim() === current.trim()) return;
        diffs.push({ rowId: row.__id, columnKey: col.key, oldValue: current, newValue: next.trim() });
        rowSet.add(row.__id);
        if (!first) first = { row: rowIdx, col: colIdx };
      });
    });
    return { diffs, rows: rowSet.size, first };
  }, [findOpen, findText, replaceText, findCol, findCase, gridRows, columns]);
  const doReplaceAll = () => {
    if (findMatches.diffs.length === 0) return;
    processDiffs(findMatches.diffs, [], [`Reemplazo: ${findMatches.diffs.length} celda${findMatches.diffs.length === 1 ? "" : "s"} en ${findMatches.rows} fila${findMatches.rows === 1 ? "" : "s"} (se puede deshacer)`]);
    setReplaceConfirm(false);
    setFindOpen(false);
  };

  // ---- pegar varias filas (Excel/Sheets) sobre las filas en blanco: se mapea a las columnas editables y se crean al completarse ----
  const pasteTextIntoDrafts = useCallback(
    (text: string): boolean => {
      if (!draftRows || !canEdit) return false;
      const active = activeRef.current ?? selectionRef.current?.min ?? null;
      if (!active) return false;
      const rowsNow = gridRowsRef.current;
      if (!isDraftRowId(rowsNow[active.row]?.__id ?? "")) return false;
      const matrix = parseClipboardMatrix(text);
      if (matrix.length === 0 || (matrix.length === 1 && matrix[0]!.length === 1 && matrix[0]![0] === "")) return false;
      const realCount = rowsNow.length - draftsRef.current.length;
      const startIndex = active.row - realCount;
      const records = mapPastedToDrafts(
        matrix,
        columns.map((c) => ({ key: c.key, title: c.title, editable: draftRows.createKeys.includes(c.key) })),
        active.col
      );
      if (records.every((r) => Object.keys(r).length === 0)) return false;
      const { drafts: next, touchedIds } = applyPastedToDrafts(draftsRef.current, startIndex, records, makeDraftId);
      setDrafts(topUpDrafts(next, minBlank, makeDraftId));
      touchedIds.forEach((id) => scheduleDraftSubmit(id));
      setNotice(`Pegado en filas nuevas: ${touchedIds.length} fila${touchedIds.length === 1 ? "" : "s"}. Se crean solas cuando tienen todos los datos obligatorios.`);
      return true;
    },
    [draftRows, canEdit, columns, minBlank, scheduleDraftSubmit]
  );
  useEffect(() => {
    if (!draftRows || !canEdit) return;
    const onPaste = (e: ClipboardEvent) => {
      const target = e.target as HTMLElement | null;
      // Si se está escribiendo en un campo de texto fuera de la planilla (buscador, diálogos), no se interviene.
      if (target && target !== document.body && (target as Node) !== (document as unknown as Node) && !wrapRef.current?.contains(target) && /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName)) return;
      const text = e.clipboardData?.getData("text/plain") ?? "";
      if (pasteTextIntoDrafts(text)) {
        e.preventDefault();
        e.stopImmediatePropagation();
      }
    };
    document.addEventListener("paste", onPaste, true);
    return () => document.removeEventListener("paste", onPaste, true);
  }, [draftRows, canEdit, pasteTextIntoDrafts]);


  // ---- barra táctil: copiar / pegar / borrar / rellenar hacia abajo sin teclado físico ----
  const currentRange = useCallback((): SheetRange | null => {
    const sel = selectionRef.current;
    if (sel) return sel;
    const a = activeRef.current;
    return a ? { min: a, max: a } : lastRangeRef.current;
  }, []);
  const touchCopy = useCallback(async () => {
    const r = currentRange();
    if (!r) return setNotice("Tocá una celda (o mantené y arrastrá para elegir un rango) y después «Copiar».");
    const lines = gridRowsRef.current.slice(r.min.row, r.max.row + 1).map((row) => columnKeys.slice(r.min.col, r.max.col + 1).map((k) => String(row[k] ?? "").replace(/[\t\r\n]+/g, " ")).join("\t"));
    try {
      await navigator.clipboard.writeText(lines.join("\n"));
      setNotice(`Copiado: ${lines.length} fila${lines.length === 1 ? "" : "s"} × ${r.max.col - r.min.col + 1} columna${r.max.col === r.min.col ? "" : "s"}.`);
    } catch {
      setNotice("El navegador no permitió copiar. Probá con el teclado (Ctrl+C) o permití el portapapeles.");
    }
  }, [columnKeys, currentRange]);
  const touchPaste = useCallback(async () => {
    const r = currentRange();
    if (!r) return setNotice("Tocá la celda donde empieza el pegado y después «Pegar».");
    let text = "";
    try {
      text = await navigator.clipboard.readText();
    } catch {
      return setNotice("El navegador no permitió leer el portapapeles. Permitilo o pegá con el teclado (Ctrl+V).");
    }
    if (pasteTextIntoDrafts(text)) return;
    const matrix = text.replace(/\r\n?/g, "\n").replace(/\n$/, "").split("\n").map((l) => l.split("\t"));
    if (matrix.length === 0 || (matrix.length === 1 && matrix[0]!.length === 1 && matrix[0]![0] === "")) return setNotice("El portapapeles está vacío.");
    const rowsNow = gridRowsRef.current;
    const diffs: CellDiff[] = [];
    const skipped: PreviewState["skipped"] = [];
    const put = (ri: number, ci: number, raw: string) => {
      const row = rowsNow[ri];
      const key = columnKeys[ci];
      const col = key ? columnByKey.get(key) : undefined;
      if (!row || !key || !col) return;
      const value = raw.replace(/[\r\n]+/g, " ").trim();
      const current = String(row[key] ?? "");
      if (current.trim() === value) return;
      const prot = row.__prot[key];
      if (prot) return void skipped.push({ rowLabel: row.__id, columnTitle: col.title, reason: prot });
      if (col.noFill && !col.fillWithReason) return;
      diffs.push({ rowId: row.__id, columnKey: key, oldValue: current, newValue: value });
    };
    if (matrix.length === 1 && matrix[0]!.length === 1 && (r.max.row > r.min.row || r.max.col > r.min.col)) {
      // Un solo valor sobre un rango: llena todo el rango (como Excel).
      for (let ri = r.min.row; ri <= r.max.row; ri += 1) for (let ci = r.min.col; ci <= r.max.col; ci += 1) put(ri, ci, matrix[0]![0]!);
    } else {
      matrix.forEach((cells, i) => cells.forEach((v, j) => put(r.min.row + i, r.min.col + j, v)));
    }
    processDiffs(diffs, skipped, [`Pegado: ${diffs.length} celda${diffs.length === 1 ? "" : "s"}`]);
  }, [columnKeys, columnByKey, currentRange, processDiffs, pasteTextIntoDrafts]);
  const touchClear = useCallback(() => {
    const r = currentRange();
    if (!r) return setNotice("Tocá una celda o un rango y después «Borrar».");
    const rowsNow = gridRowsRef.current;
    const diffs: CellDiff[] = [];
    const skipped: PreviewState["skipped"] = [];
    for (let ri = r.min.row; ri <= r.max.row; ri += 1) {
      const row = rowsNow[ri];
      if (!row) continue;
      for (let ci = r.min.col; ci <= r.max.col; ci += 1) {
        const key = columnKeys[ci];
        const col = key ? columnByKey.get(key) : undefined;
        if (!key || !col || String(row[key] ?? "").trim() === "") continue;
        const prot = row.__prot[key];
        if (prot) skipped.push({ rowLabel: row.__id, columnTitle: col.title, reason: prot });
        else if (!col.noFill) diffs.push({ rowId: row.__id, columnKey: key, oldValue: String(row[key] ?? ""), newValue: "" });
      }
    }
    processDiffs(diffs, skipped);
  }, [columnKeys, columnByKey, currentRange, processDiffs]);
  /** Celdas que escribiría «Rellenar»: la primera celda de cada columna (o fila, si el rango es de una fila) hacia las siguientes del rango. */
  const planTouchFill = useCallback(
    (mode: "series" | "copy") => {
      const r = currentRange();
      const rowsNow = gridRowsRef.current;
      const vertical = !!r && r.max.row > r.min.row;
      const horizontal = !!r && !vertical && r.max.col > r.min.col;
      if (!r || (!vertical && !horizontal)) return null;
      const diffs: CellDiff[] = [];
      const skipped: PreviewState["skipped"] = [];
      const samples: string[] = [];
      let omitted = 0;
      let overwrites = 0;
      const put = (row: GenusGridRow | undefined, key: string | undefined, value: string) => {
        const col = key ? columnByKey.get(key) : undefined;
        if (!row || !key || !col) return;
        const current = String(row[key] ?? "");
        if (current.trim() === value.trim()) return;
        const prot = row.__prot[key];
        if (prot) return void skipped.push({ rowLabel: row.__id, columnTitle: col.title, reason: prot });
        if (col.noFill && !col.fillWithReason) return void (omitted += 1);
        if (current.trim() !== "") overwrites += 1;
        if (samples.length < 4) samples.push(`${col.title}: ${current.trim() || "(vacío)"} → ${value}`);
        diffs.push({ rowId: row.__id, columnKey: key, oldValue: current, newValue: value });
      };
      const valueAt = (v0: string, i: number) => (mode === "series" ? formatSheetNumber((parseSheetNumber(v0) ?? 0) + i) : v0);
      if (vertical) {
        const first = rowsNow[r.min.row];
        for (let ci = r.min.col; ci <= r.max.col; ci += 1) {
          const key = columnKeys[ci];
          if (!first || !key) continue;
          const v0 = String(first[key] ?? "");
          for (let ri = r.min.row + 1; ri <= r.max.row; ri += 1) put(rowsNow[ri], key, valueAt(v0, ri - r.min.row));
        }
      } else {
        for (let ri = r.min.row; ri <= r.max.row; ri += 1) {
          const row = rowsNow[ri];
          const k0 = columnKeys[r.min.col];
          if (!row || !k0) continue;
          const v0 = String(row[k0] ?? "");
          for (let ci = r.min.col + 1; ci <= r.max.col; ci += 1) put(row, columnKeys[ci], valueAt(v0, ci - r.min.col));
        }
      }
      const notes = [`Relleno ${mode === "series" ? "en orden numérico" : "igual"}: ${diffs.length} celda${diffs.length === 1 ? "" : "s"}`];
      if (omitted > 0) notes.push(`${omitted} celda${omitted === 1 ? "" : "s"} omitida${omitted === 1 ? "" : "s"}: columna calculada o que mueve stock (se edita con su motivo)`);
      return { mode, diffs, skipped, notes, overwrites, samples };
    },
    [columnKeys, columnByKey, currentRange]
  );
  const openFillMenu = useCallback(() => {
    if (fillMenu) return setFillMenu(null);
    const r = currentRange();
    if (!r || (r.max.row === r.min.row && r.max.col === r.min.col)) {
      return setNotice("Elegí la celda inicial y las celdas que querés completar (mantené y arrastrá, o Shift + flechas) y después «Rellenar».");
    }
    // La serie numérica solo se ofrece si TODAS las celdas iniciales son números.
    const vertical = r.max.row > r.min.row;
    const rowsNow = gridRowsRef.current;
    const starts: Array<{ title: string; value: string }> = [];
    if (vertical) {
      const first = rowsNow[r.min.row];
      for (let ci = r.min.col; ci <= r.max.col; ci += 1) starts.push({ title: columnByKey.get(columnKeys[ci] ?? "")?.title ?? "", value: String(first?.[columnKeys[ci] ?? ""] ?? "") });
    } else {
      for (let ri = r.min.row; ri <= r.max.row; ri += 1) starts.push({ title: columnByKey.get(columnKeys[r.min.col] ?? "")?.title ?? "", value: String(rowsNow[ri]?.[columnKeys[r.min.col] ?? ""] ?? "") });
    }
    const bad = starts.find((x) => parseSheetNumber(x.value) === null);
    setFillMenu({
      seriesReason: bad ? (bad.value.trim() === "" ? `La celda inicial de «${bad.title}» está vacía: la secuencia numérica necesita un número inicial.` : `El valor inicial «${bad.value}» (${bad.title}) no es numérico: la secuencia numérica solo funciona con números.`) : null,
      rangeReason: null,
      preview: null,
    });
  }, [fillMenu, currentRange, columnByKey, columnKeys]);
  const chooseFill = useCallback(
    (mode: "series" | "copy") => {
      const plan = planTouchFill(mode);
      if (!plan) return setFillMenu(null);
      if (plan.diffs.length === 0 && plan.skipped.length === 0) {
        setFillMenu(null);
        return setNotice("No hay nada para rellenar: las celdas ya tienen esos valores.");
      }
      // Si pisa datos existentes se muestra una vista previa antes de guardar; si solo completa celdas vacías, se guarda directo.
      if (plan.overwrites > 0) return setFillMenu((m) => (m ? { ...m, preview: plan } : m));
      setFillMenu(null);
      processDiffs(plan.diffs, plan.skipped, plan.notes);
    },
    [planTouchFill, processDiffs]
  );

  const baseHeight = height ?? Math.min(maxHeight, (gridRows.length + 1) * rowHeight + 24);
  // Hoja continua: la barra horizontal fija tiene que verse SIN bajar la página (escritorio y tablet). Lo que hay
  // arriba de la grilla (barra de vista, avisos, filas en blanco) cambia, así que se mide el pie real y se achica el
  // alto de la hoja lo que sobre; nunca por debajo de MIN_SHEET_HEIGHT ni por encima del alto calculado.
  const footRef = useRef<HTMLDivElement>(null);
  const [fitDelta, setFitDelta] = useState(0);
  const pointerDownRef = useRef(false);
  useEffect(() => {
    const down = () => { pointerDownRef.current = true; };
    const up = () => { pointerDownRef.current = false; };
    window.addEventListener("pointerdown", down, true);
    window.addEventListener("pointerup", up, true);
    window.addEventListener("pointercancel", up, true);
    return () => {
      window.removeEventListener("pointerdown", down, true);
      window.removeEventListener("pointerup", up, true);
      window.removeEventListener("pointercancel", up, true);
    };
  }, []);
  const fitSheet = useCallback(() => {
    const foot = footRef.current;
    // Nunca se mueve la hoja en medio de un gesto (arrastre de relleno, selección con el dedo).
    if (!foot || pointerDownRef.current) return;
    const bottomAtTop = foot.getBoundingClientRect().bottom + window.scrollY;
    // Reserva: pie fijo de la aplicación (~34 px) + margen, para que la barra no quede tapada.
    const overflow = bottomAtTop - window.innerHeight + SHEET_BOTTOM_RESERVE;
    // Histéresis: solo se achica si la barra queda tapada (> 6 px) y solo se agranda si sobra mucho espacio (> 60 px).
    if (overflow <= 6 && overflow >= -60) return;
    setFitDelta((d) => Math.min(0, Math.max(MIN_SHEET_HEIGHT - baseHeight, d - Math.round(overflow))));
  }, [baseHeight]);
  // Al montar y al cambiar la ventana (con un segundo pase cuando termina de cargar el contenido de arriba).
  useEffect(() => {
    if (!sheet || height !== undefined) return;
    const raf = window.requestAnimationFrame(fitSheet);
    const t = window.setTimeout(fitSheet, 450);
    window.addEventListener("resize", fitSheet);
    return () => {
      window.cancelAnimationFrame(raf);
      window.clearTimeout(t);
      window.removeEventListener("resize", fitSheet);
    };
  }, [sheet, height, fitSheet]);
  // Cuando aparece o desaparece una línea sobre la hoja (aviso, chip de relleno, selección), se reajusta en el acto.
  useEffect(() => {
    if (!sheet || height !== undefined) return;
    const raf = window.requestAnimationFrame(fitSheet);
    return () => window.cancelAnimationFrame(raf);
  }, [sheet, height, fitSheet, notice, fillChip, selectedRowCount, rowDeleteResult]);
  const computedHeight = sheet && height === undefined ? Math.max(MIN_SHEET_HEIGHT, baseHeight + fitDelta) : baseHeight;

  const syncSelection = (selection: SheetRange | null) => {
    const a = activeRef.current;
    selectionRef.current = selection ? { min: selection.min, max: selection.max } : a ? { min: a, max: a } : null;
    const cur = selectionRef.current;
    if (cur) lastRangeRef.current = { min: { ...cur.min }, max: { ...cur.max } };
    setSelectedRowCount(cur ? cur.max.row - cur.min.row + 1 : 0);
  };
  const describeSelection = (selection: { min: { col: number; row: number }; max: { col: number; row: number } } | null) => {
    syncSelection(selection);
    if (!selection) return setSelectionLabel("");
    const r = selection.max.row - selection.min.row + 1;
    const c = selection.max.col - selection.min.col + 1;
    setSelectionLabel(r * c > 1 ? `${r} fila${r === 1 ? "" : "s"} × ${c} columna${c === 1 ? "" : "s"} seleccionadas` : "");
  };

  // El marco de scroll del motor (para las barras propias y los gestos): se relee si el motor se remonta.
  // eslint-disable-next-line react-hooks/set-state-in-effect
  useLayoutEffect(() => {
    if (!sheet) return;
    const el = wrapRef.current?.querySelector<HTMLElement>(".dsg-container") ?? null;
    setScroller((prev) => (prev === el ? prev : el));
  });
  const { overlay: sheetOverlay } = useSheetGestures({
    wrapRef,
    gridRef,
    rowHeight,
    rowCount: gridRows.length,
    colCount: columns.length,
    selectionRef,
    canFill: sheet && canEdit,
    onFill: (plan) => applyFill(plan),
    testId,
  });
  // Limpia el aviso «Eliminadas N filas — Deshacer» al rato.
  useEffect(() => {
    if (!rowDeleteResult) return;
    const t = window.setTimeout(() => setRowDeleteResult(null), 15_000);
    return () => window.clearTimeout(t);
  }, [rowDeleteResult]);
  const fillChipValid = fillChip && fillChip.sourceIds.every((id, i) => gridRows[fillChip.plan.source.min.row + i]?.__id === id);

  useEffect(() => {
    if (!scroller) return;
    const g = new ScrollGuard(scroller, window);
    guardRef.current = g;
    return () => {
      g.destroy();
      if (guardRef.current === g) guardRef.current = null;
    };
  }, [scroller]);
  // Llegaron datos nuevos (recarga tras guardar, filas nuevas, borradores): ventana de protección del scroll.
  useEffect(() => {
    guardRef.current?.lock(2500);
  }, [rows, drafts, columns]);

  const dsg = (
    <DataSheetGrid<GenusGridRow>
      // Si cambian las columnas (otra pestaña/semana) el motor se remonta: sus encabezados no se actualizan en caliente.
      key={columns.map((c) => `${c.key}:${c.title}:${c.fixedWidth ? c.basis : ""}`).join("|")}
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
      rowClassName={
        rowClassName || draftRows
          ? ({ rowData }) => {
              if (isDraftRowId(rowData.__id)) return "genus-draft-row";
              const source = rowByIdRef.current.get(rowData.__id);
              return source && rowClassName ? rowClassName(source) : undefined;
            }
          : undefined
      }
      onSelectionChange={({ selection }) => describeSelection(selection)}
      onActiveCellChange={(arg) => {
        activeRef.current = arg.cell ? { col: arg.cell.col, row: arg.cell.row } : null;
        if (arg.cell) lastRangeRef.current = { min: { col: arg.cell.col, row: arg.cell.row }, max: { col: arg.cell.col, row: arg.cell.row } };
        if (!arg.cell) syncSelection(null);
        else if (!selectionRef.current || (selectionRef.current.min.row === selectionRef.current.max.row && selectionRef.current.min.col === selectionRef.current.max.col)) syncSelection(null);
        onActiveCellChange(arg);
      }}
    />
  );

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
        <div className="ml-auto flex flex-wrap items-center gap-1">
          {sheet && rowOps && canEdit ? (
            <>
              {([
                ["above", "Insertar arriba", "Inserta una fila en blanco arriba de la selección", null],
                ["below", "Insertar abajo", "Inserta una fila en blanco debajo de la selección", null],
                ["up", "Subir", "Sube la selección una fila (Alt+↑). El orden queda guardado", ArrowUp],
                ["down", "Bajar", "Baja la selección una fila (Alt+↓). El orden queda guardado", ArrowDown],
              ] as const).map(([kind, label, title, Icon]) => (
                <Button
                  key={kind}
                  type="button"
                  variant="secondary"
                  size="sm"
                  className="h-7 px-2 text-xs"
                  onClick={() => void runRowOp(kind)}
                  disabled={rowOps.enabled === false && (kind === "up" || kind === "down")}
                  data-testid={`${testId}-row-${kind}`}
                  title={rowOps.enabled === false && (kind === "up" || kind === "down") ? "Elegí «Orden de la hoja» para mover filas" : title}
                >
                  {Icon ? <Icon className="size-3.5" aria-hidden="true" /> : null}
                  {label}
                </Button>
              ))}
            </>
          ) : null}
          {sheet && rowDelete && canEdit ? (
            <Button
              type="button"
              variant="secondary"
              size="sm"
              className="h-7 px-2 text-xs"
              onClick={() => void deleteSelectedRows()}
              data-testid={`${testId}-delete-rows`}
              title="Elimina las filas de la selección (sin motivo; se puede deshacer)"
            >
              <Trash2 className="size-3.5" aria-hidden="true" />
              Eliminar {selectedRowCount > 1 ? `${selectedRowCount} filas` : "fila"}
            </Button>
          ) : null}
          <Button
            type="button"
            variant="secondary"
            size="sm"
            className="h-7 px-2 text-xs"
            onClick={undoLast}
            disabled={undoDepth === 0}
            data-testid={`${testId}-undo`}
          >
            <Undo2 className="size-3.5" aria-hidden="true" />
            Deshacer
          </Button>
          {sheet && canEdit ? (
            <Button
              type="button"
              variant="secondary"
              size="sm"
              className="h-7 px-2 text-xs"
              onClick={() => { setReplaceConfirm(false); setFindOpen(true); }}
              data-testid={`${testId}-find-btn`}
            >
              <Replace className="size-3.5" aria-hidden="true" />
              Buscar y reemplazar
            </Button>
          ) : null}
          {sheet ? (
            <Button
              type="button"
              variant="secondary"
              size="sm"
              className="h-7 px-2 text-xs"
              onClick={redoLast}
              disabled={redoDepth === 0}
              data-testid={`${testId}-redo`}
            >
              <Redo2 className="size-3.5" aria-hidden="true" />
              Rehacer
            </Button>
          ) : null}
        </div>
      </div>

      {sheet && canEdit ? (
        <div className="flex flex-wrap items-center gap-2" role="group" aria-label="Acciones de celdas (táctil)" data-testid={`${testId}-touchbar`}>
          {([
            ["copy", "Copiar", Copy, touchCopy],
            ["paste", "Pegar", ClipboardPaste, touchPaste],
            ["clear", "Borrar", Eraser, touchClear],
            ["filldown", "Rellenar", Rows3, openFillMenu],
          ] as const).map(([id, label, Icon, fn]) => (
            <button
              key={id}
              type="button"
              className="inline-flex min-h-11 items-center gap-1 rounded border border-[var(--os-border)] bg-[var(--os-surface)] px-3 text-xs font-medium"
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => void fn()}
              data-testid={`${testId}-touch-${id}`}
            >
              <Icon className="size-4" aria-hidden="true" /> {label}
            </button>
          ))}
          <span className="text-[11px] text-[var(--os-text-muted)]">Con el dedo: tocá una celda; mantené y arrastrá para elegir un rango.</span>
        </div>
      ) : null}

      {sheet && canEdit && fillMenu ? (
        <div className="space-y-2 rounded border border-[var(--os-border)] bg-[var(--os-surface)] p-3 text-xs" role="dialog" aria-label="Rellenar" data-testid={`${testId}-fill-menu`} onKeyDown={(e) => e.key === "Escape" && setFillMenu(null)}>
          {fillMenu.preview ? (
            <div data-testid={`${testId}-fill-menu-preview`}>
              <p className="font-semibold">Vista previa — {fillMenu.preview.mode === "series" ? "Rellenar en orden numérico" : "Rellenar igual"}</p>
              <p>Se van a modificar {fillMenu.preview.diffs.length} celda{fillMenu.preview.diffs.length === 1 ? "" : "s"} ({fillMenu.preview.overwrites} con datos existentes).</p>
              <ul className="list-disc pl-5 text-[var(--os-text-muted)]">{fillMenu.preview.samples.map((x) => <li key={x}>{x}</li>)}</ul>
              <div className="mt-2 flex gap-2">
                <button type="button" className="min-h-11 rounded border border-[var(--os-teal)] bg-[var(--os-teal-soft)] px-3 font-semibold" onClick={() => { const pv = fillMenu.preview!; setFillMenu(null); processDiffs(pv.diffs, pv.skipped, pv.notes); }} data-testid={`${testId}-fill-menu-apply`}>Aplicar (se puede deshacer)</button>
                <button type="button" className="min-h-11 rounded border border-[var(--os-border)] px-3" onClick={() => setFillMenu(null)} data-testid={`${testId}-fill-menu-cancel`}>Cancelar</button>
              </div>
            </div>
          ) : (
            <>
              <p className="font-semibold">Rellenar las celdas seleccionadas a partir de la primera</p>
              <div className="flex flex-wrap gap-2">
                <button type="button" disabled={fillMenu.seriesReason !== null} className="min-h-11 rounded border border-[var(--os-border)] px-3 font-medium disabled:cursor-not-allowed disabled:opacity-50" onClick={() => chooseFill("series")} data-testid={`${testId}-fill-menu-series`} title={fillMenu.seriesReason ?? undefined}>
                  RELLENAR EN ORDEN NUMÉRICO <span className="block font-normal text-[var(--os-text-muted)]">1, 2, 3, 4…</span>
                </button>
                <button type="button" className="min-h-11 rounded border border-[var(--os-border)] px-3 font-medium" onClick={() => chooseFill("copy")} data-testid={`${testId}-fill-menu-copy`}>
                  RELLENAR IGUAL <span className="block font-normal text-[var(--os-text-muted)]">1, 1, 1, 1…</span>
                </button>
                <button type="button" className="min-h-11 rounded border border-[var(--os-border)] px-3 text-[var(--os-text-muted)]" onClick={() => setFillMenu(null)} data-testid={`${testId}-fill-menu-close`}>Cerrar</button>
              </div>
              {fillMenu.seriesReason ? <p className="text-amber-300" data-testid={`${testId}-fill-menu-series-reason`}>Orden numérico no disponible: {fillMenu.seriesReason}</p> : null}
            </>
          )}
        </div>
      ) : null}

      {sheet && fillChipValid && fillChip ? (
        <div className="flex flex-wrap items-center gap-2 text-xs" data-testid={`${testId}-fill-chip`} role="group" aria-label="Opciones de relleno">
          <span className="text-[var(--os-text-muted)]">Relleno: {fillChip.note}</span>
          {(["series", "copy"] as const).map((m) => (
            <button
              key={m}
              type="button"
              onClick={() => (fillChip.mode === m ? undefined : applyFill(fillChip.plan, m))}
              data-testid={`${testId}-fill-${m}`}
              aria-pressed={fillChip.mode === m}
              className={`rounded border px-2 py-0.5 ${
                fillChip.mode === m
                  ? "border-[var(--os-teal)] bg-[var(--os-teal-soft)] font-semibold text-[var(--os-text)]"
                  : "border-[var(--os-border)] text-[var(--os-text-muted)] hover:bg-[var(--os-teal-soft)]/50"
              }`}
            >
              {m === "series" ? "Rellenar en orden numérico" : "Rellenar igual"}
            </button>
          ))}
        </div>
      ) : null}
      {sheet && rowDeleteResult ? (
        <div className="flex flex-wrap items-center gap-2 text-xs" data-testid={`${testId}-delete-result`} role="status">
          <span className="text-[var(--os-text)]">{rowDeleteResult.message}</span>
          {rowDeleteResult.undo ? (
            <button
              type="button"
              className="rounded border border-[var(--os-teal)] px-2 py-0.5 font-semibold text-[var(--os-teal)] hover:bg-[var(--os-teal-soft)]/50"
              onClick={() => {
                const undo = rowDeleteResult.undo;
                setRowDeleteResult(null);
                void undo?.();
              }}
              data-testid={`${testId}-delete-undo`}
            >
              Deshacer eliminación
            </button>
          ) : null}
        </div>
      ) : null}

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

      {inlineReason && (
        <div
          className={`flex flex-wrap items-center gap-2 rounded-[var(--os-radius-sm)] border px-2 py-1.5 text-xs ${sheet ? "border-amber-400/50 bg-amber-400/10 text-[var(--os-text)]" : "border-amber-400 bg-amber-50"}`}
          data-testid={`${testId}-inline-reason`}
          role="group"
          aria-label="Motivo del cambio"
        >
          <span className={`font-medium ${sheet ? "" : "text-amber-950"}`}>
            {inlineReason.changes[0]!.rowLabel} · {inlineReason.changes[0]!.columnTitle}: {previewValue(inlineReason.changes[0]!.oldValue)} →{" "}
            <strong>{previewValue(inlineReason.changes[0]!.newValue)}</strong>
          </span>
          <span className={sheet ? "text-amber-200" : "text-amber-900"}>{inlineReason.prompt}</span>
          <input
            autoFocus
            value={inlineText}
            onChange={(e) => setInlineText(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                applyInlineReason(inlineText);
              } else if (e.key === "Escape") {
                e.preventDefault();
                cancelInlineReason();
              }
            }}
            placeholder="Motivo + Enter"
            className={`h-7 min-w-[14rem] flex-1 rounded border px-2 text-xs ${sheet ? "border-amber-400/50 bg-[var(--os-surface)] text-[var(--os-text)] placeholder:text-[var(--os-text-muted)]" : "border-amber-400 bg-white text-slate-900 placeholder:text-slate-500"}`}
            data-testid={`${testId}-inline-reason-input`}
          />
          {["Conteo físico", "Corrección de carga", "Merma o rotura", "Devolución a proveedor"].map((m) => (
            <Button key={m} type="button" size="sm" variant="secondary" className="h-6 px-2 text-xs" onClick={() => applyInlineReason(m)}>
              {m}
            </Button>
          ))}
          <Button type="button" size="sm" variant="secondary" className="h-6 px-2 text-xs" onClick={cancelInlineReason} data-testid={`${testId}-inline-reason-cancel`}>
            Cancelar
          </Button>
        </div>
      )}

      <div className={`genus-grid overflow-hidden rounded-[var(--os-radius-sm)] border border-[var(--os-border)] ${sheet ? "genus-sheet" : ""}`}>
        {sheet ? (
          <>
            <div className="genus-sheet-body">
              <div className="genus-sheet-frame" ref={wrapRef} data-testid={`${testId}-frame`}>
                {dsg}
                <FrozenFirstColumn
                  scroller={scroller}
                  rows={gridRows}
                  columnKey={columnKeys[0]}
                  title={columns[0]?.title ?? ""}
                  rowHeight={rowHeight}
                  onSelectRow={(row) => gridRef.current?.setSelection({ min: { col: 0, row }, max: { col: columns.length - 1, row } })}
                  testId={testId}
                />
                {sheetOverlay}
              </div>
              <SheetVScrollbar scroller={scroller} testId={testId} />
            </div>
            <div className="genus-sheet-foot" ref={footRef} style={{ paddingRight: SHEET_BAR_SIZE }}>
              <SheetHScrollbar scroller={scroller} testId={testId} />
            </div>
          </>
        ) : (
          dsg
        )}
      </div>

      {draftRows && canEdit ? (
        <DraftInfo
          drafts={drafts}
          requiredKeys={draftRows.requiredKeys}
          titleOf={(k) => columnByKey.get(k)?.title ?? k}
          testId={testId}
          onAddRows={() => setDrafts((prev) => [...prev, ...Array.from({ length: 10 }, () => newDraft(makeDraftId))])}
          onRetry={(id) => void submitDraft(id)}
        />
      ) : null}
      {hint && <p className="text-[11px] text-[var(--os-text-muted)]">{hint}</p>}

      <Dialog open={findOpen} onOpenChange={(o) => { setFindOpen(o); if (!o) setReplaceConfirm(false); }}>
        <DialogContent className="max-w-md" data-testid={`${testId}-find-dialog`}>
          <DialogHeader>
            <DialogTitle>Buscar y reemplazar</DialogTitle>
            <DialogDescription>Solo cambia celdas editables. Las columnas calculadas o protegidas no se tocan. Se puede deshacer.</DialogDescription>
          </DialogHeader>
          <div className="space-y-2 text-sm">
            <label className="block">Buscar<input value={findText} onChange={(e) => { setFindText(e.target.value); setReplaceConfirm(false); }} className="mt-1 min-h-11 w-full rounded border border-[var(--os-border)] bg-[var(--os-surface)] px-3" data-testid={`${testId}-find-text`} autoComplete="off" /></label>
            <label className="block">Reemplazar por<input value={replaceText} onChange={(e) => { setReplaceText(e.target.value); setReplaceConfirm(false); }} className="mt-1 min-h-11 w-full rounded border border-[var(--os-border)] bg-[var(--os-surface)] px-3" data-testid={`${testId}-replace-text`} autoComplete="off" /></label>
            <label className="block">En la columna
              <select value={findCol} onChange={(e) => { setFindCol(e.target.value); setReplaceConfirm(false); }} className="mt-1 min-h-11 w-full rounded border border-[var(--os-border)] bg-[var(--os-surface)] px-2" data-testid={`${testId}-find-col`}>
                <option value="">Todas las editables</option>
                {columns.filter((c) => !c.noFill).map((c) => (<option key={c.key} value={c.key}>{c.title}</option>))}
              </select>
            </label>
            <label className="flex min-h-11 items-center gap-2"><input type="checkbox" className="size-5" checked={findCase} onChange={(e) => setFindCase(e.target.checked)} /> Distinguir mayúsculas</label>
            <p className="text-xs text-[var(--os-text-muted)]" data-testid={`${testId}-find-count`}>
              {findText ? `${findMatches.diffs.length} celda${findMatches.diffs.length === 1 ? "" : "s"} en ${findMatches.rows} fila${findMatches.rows === 1 ? "" : "s"}` : "Escribí qué buscar."}
            </p>
          </div>
          <DialogFooter>
            <Button variant="secondary" onClick={() => setFindOpen(false)}>Cerrar</Button>
            <Button
              variant="secondary"
              disabled={!findMatches.first}
              onClick={() => { if (findMatches.first) { setFindOpen(false); gridRef.current?.setActiveCell({ col: findMatches.first.col, row: findMatches.first.row }); } }}
              data-testid={`${testId}-find-go`}
            >
              Ir a la primera
            </Button>
            {replaceConfirm ? (
              <Button disabled={findMatches.diffs.length === 0} onClick={doReplaceAll} data-testid={`${testId}-replace-confirm`}>
                Confirmar: reemplazar {findMatches.diffs.length} celda{findMatches.diffs.length === 1 ? "" : "s"}
              </Button>
            ) : (
              <Button disabled={findMatches.diffs.length === 0} onClick={() => (findMatches.diffs.length > 1 ? setReplaceConfirm(true) : doReplaceAll())} data-testid={`${testId}-replace-all`}>
                Reemplazar todo
              </Button>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>

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
              {preview.stockNote && (
                <p className="rounded border border-amber-400/60 bg-amber-400/10 px-3 py-2 text-xs" data-testid={`${testId}-stock-note`}>
                  {preview.stockNote}
                </p>
              )}
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
              {preview.reasonPrompt && (
                <section>
                  <label className="block text-xs font-semibold" htmlFor={`${testId}-reason`}>
                    {preview.reasonPrompt}
                  </label>
                  <textarea
                    id={`${testId}-reason`}
                    data-testid={`${testId}-reason`}
                    value={reasonText}
                    onChange={(e) => setReasonText(e.target.value)}
                    rows={2}
                    className="mt-1 w-full rounded border border-[var(--os-border)] bg-[var(--os-surface)] px-2 py-1 text-sm"
                    placeholder={`Motivo (mín. ${minReasonLength} caracteres)`}
                  />
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
              <Button
                type="button"
                variant="primary"
                onClick={applyPreview}
                disabled={Boolean(preview.reasonPrompt) && reasonText.trim().length < minReasonLength}
                data-testid={`${testId}-preview-apply`}
              >
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
