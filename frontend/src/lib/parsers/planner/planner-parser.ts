import { SECTOR_PERSONNEL } from "@/features/os/operational/lib/sector-personnel";
import type { WorkItemAssembler } from "@/lib/domain/work-item/work-item-assembler";
import type { WorkItemRegistry } from "@/lib/domain/work-item/work-item-registry";
import type { SectorId } from "@/types/operational/sector";
import {
  blockExpectsExplicitLine,
  detectBranchOwnerRow,
  detectLineHeader,
  detectPackagingSectorHeader,
  extractDayColumns,
  findPackagingSectorRow,
  inferDayColumnsFromLineRow,
  inferOriginStage,
  isDateHeaderRow,
  isOperationalNote,
  isQuantityCell,
  isWeekAnchorRow,
  normalizeCellText,
  slugify,
} from "@/lib/parsers/planner/planner-utils";
import {
  columnIndexToLetter,
  extractColumnDatesFromHeaderRow,
  isMonthName,
  markInherited,
  resolveSplitColumnDate,
  SEMANAS_OPERATIONAL_YEAR,
  type ResolvedColumnDate,
} from "@/lib/parsers/planner/date-header-resolver";
import {
  resolvePlannedDateIso,
  resolveWeekId,
  weekStartMonday,
} from "@/lib/operational/operational-calendar";

export interface PlannerParserInput {
  fileId: string;
  tab: string;
  rows: string[][];
  registry: WorkItemRegistry;
  assembler: WorkItemAssembler;
}

export interface PlannerParserResult {
  itemsCreated: number;
  warnings: string[];
}

interface PlannerContext {
  tabSector: "ELABORACION" | "ACONDICIONAMIENTO";
  sector: SectorId | null;
  line: string | null;
  branchOwner: string | null;
  weekLabel: string | null;
  dayColumns: Map<number, string>;
  monthLabel: string | null;
  monthByColumn: Map<number, string>;
  dayNumbers: Map<number, string>;
  columnDates: Map<number, ResolvedColumnDate>;
  dateHeaderRow: number | null;
}

interface ColumnSlotDraft {
  client: string | null;
  product: string | null;
  quantity: string | null;
  notes: string[];
  clientRow: number | null;
  productRow: number | null;
  quantityRow: number | null;
}

function emptyColumnDraft(): ColumnSlotDraft {
  return {
    client: null,
    product: null,
    quantity: null,
    notes: [],
    clientRow: null,
    productRow: null,
    quantityRow: null,
  };
}

function isDayNumbersRow(row: string[], dayColumns: Map<number, string>): boolean {
  let hasNumeric = false;
  for (const colIndex of dayColumns.keys()) {
    const cell = normalizeCellText(row[colIndex] ?? "");
    if (!cell) continue;
    if (!/^\d+([.,]\d+)?$/.test(cell)) return false;
    hasNumeric = true;
  }
  return hasNumeric;
}

/** Fila de mes(es) — admite cambio de mes dentro de la misma semana. */
function isMonthRow(row: string[], dayColumns: Map<number, string>): boolean {
  if (dayColumns.size === 0) return false;
  let monthHits = 0;
  for (const colIndex of dayColumns.keys()) {
    const cell = normalizeCellText(row[colIndex] ?? "");
    if (!cell) continue;
    if (!isMonthName(cell)) return false;
    monthHits += 1;
  }
  return monthHits >= 2;
}

function rebuildSplitColumnDates(ctx: PlannerContext, warnings: string[]): void {
  if (ctx.dayNumbers.size === 0) return;

  const next = new Map<number, ResolvedColumnDate>();
  for (const colIndex of ctx.dayColumns.keys()) {
    const dayNum = ctx.dayNumbers.get(colIndex);
    const month =
      ctx.monthByColumn.get(colIndex) ?? ctx.monthLabel ?? null;
    const expectedWeekday = ctx.dayColumns.get(colIndex) ?? null;
    const resolved = resolveSplitColumnDate(
      dayNum,
      month,
      SEMANAS_OPERATIONAL_YEAR,
      expectedWeekday
    );
    if (!resolved) continue;
    if (resolved.warning) warnings.push(resolved.warning);
    next.set(colIndex, resolved);
  }
  if (next.size > 0) {
    ctx.columnDates = next;
  }
}

function defaultContext(tab: string): PlannerContext {
  const tabKey = tab.trim().toUpperCase();
  const tabSector =
    tabKey.includes("ACONDICIONAMIENTO") || tabKey.includes("ENVASADO")
      ? "ACONDICIONAMIENTO"
      : "ELABORACION";

  return {
    tabSector,
    sector: tabSector === "ELABORACION" ? "ELABORACION" : null,
    line: null,
    branchOwner: null,
    weekLabel: null,
    dayColumns: new Map(),
    monthLabel: null,
    monthByColumn: new Map(),
    dayNumbers: new Map(),
    columnDates: new Map(),
    dateHeaderRow: null,
  };
}

function flushColumnDrafts(
  registry: WorkItemRegistry,
  assembler: WorkItemAssembler,
  ctx: PlannerContext,
  colIndex: number,
  draft: ColumnSlotDraft,
  fileId: string,
  tab: string,
  rowNumber: number,
  rows: string[][],
  warnings: string[]
): number {
  if (!ctx.sector) return 0;
  if (!draft.client && !draft.product && !draft.quantity) return 0;

  const dayLabel = ctx.dayColumns.get(colIndex) ?? null;
  const dayNum = ctx.dayNumbers.get(colIndex);
  const monthForCol =
    ctx.monthByColumn.get(colIndex) ?? ctx.monthLabel ?? null;
  const dateLabel =
    dayNum && monthForCol ? `${dayNum} ${monthForCol}` : dayNum ?? null;

  let resolved = ctx.columnDates.get(colIndex) ?? null;
  let dateResolutionMethod = resolved?.method ?? null;
  let dateHeaderSourceRange: string | null = null;

  if (resolved) {
    if (ctx.dateHeaderRow != null) {
      dateHeaderSourceRange = `${tab}!${columnIndexToLetter(colIndex)}${ctx.dateHeaderRow}`;
    }
    // Tras el encabezado, los slots siguientes heredan el contexto de semana.
    if (resolved.method !== "inherited_week_context" && rowNumber > (ctx.dateHeaderRow ?? 0) + 1) {
      resolved = markInherited(resolved);
      dateResolutionMethod = "inherited_week_context";
    }
  } else {
    const plannedDateIso = resolvePlannedDateIso(dayNum, monthForCol, SEMANAS_OPERATIONAL_YEAR);
    if (plannedDateIso) {
      const split = resolveSplitColumnDate(
        dayNum,
        monthForCol,
        SEMANAS_OPERATIONAL_YEAR,
        dayLabel
      );
      resolved = split;
      dateResolutionMethod = split?.method ?? "split_header";
      if (split?.warning) warnings.push(split.warning);
    }
  }

  const plannedDateIso = resolved?.plannedDate ?? null;
  const weekStart = plannedDateIso ? weekStartMonday(plannedDateIso) : null;
  const weekId = resolveWeekId(plannedDateIso);

  const sectorRow = findPackagingSectorRow(rows, rowNumber);
  const lineExpectedInSheet =
    sectorRow !== null ? blockExpectsExplicitLine(rows, sectorRow, rowNumber) : null;

  const internalId = `planner:${fileId}:${slugify(tab)}:${slugify(ctx.sector)}:${slugify(ctx.line ?? "sin-linea")}:${slugify(ctx.branchOwner ?? "sin-rama")}:${colIndex}:${rowNumber}:${slugify(draft.product ?? draft.client ?? "slot")}`;

  const col = colIndex + 1;
  const slotRange = `${tab}!${rowNumber}:${col}`;
  const productRange =
    draft.productRow !== null ? `${tab}!${draft.productRow}:${col}` : undefined;
  const quantityRange =
    draft.quantityRow !== null ? `${tab}!${draft.quantityRow}:${col}` : undefined;

  assembler.apply(
    registry,
    { internalId, client: draft.client, product: draft.product },
    {
      internalId,
      sector: ctx.sector,
      ownerSector: ctx.sector,
      line: ctx.line,
      lineExpectedInSheet,
      branchOwner: ctx.branchOwner,
      sectorLead:
        ctx.sector === "ELABORACION" ? SECTOR_PERSONNEL.ELABORACION_ENCARGADO : null,
      weekLabel: ctx.weekLabel,
      weekStart,
      weekId,
      dayLabel: resolved?.dayLabel ?? dayLabel,
      dayOfWeek: resolved?.dayOfWeek ?? dayLabel,
      date: resolved?.headerText ?? dateLabel,
      plannedDate: plannedDateIso,
      dateHeaderSourceRange,
      dateResolutionMethod,
      plannedClient: draft.client,
      plannedProduct: draft.product,
      plannedQuantity: draft.quantity,
      notes: draft.notes.length > 0 ? draft.notes.join(" · ") : null,
      originStage: inferOriginStage(ctx.sector),
      priority:
        plannedDateIso == null && (dayLabel === "Lunes" || dayLabel === "Martes")
          ? "ESTA_SEMANA"
          : null,
    },
    "semanas_2026",
    { fileId, range: slotRange, productRange, quantityRange }
  );

  return 1;
}

function classifyAndStack(
  text: string,
  draft: ColumnSlotDraft,
  rowNumber: number
): void {
  if (isOperationalNote(text)) {
    draft.notes.push(text);
    return;
  }

  if (isQuantityCell(text)) {
    draft.quantity = text;
    draft.quantityRow = rowNumber;
    return;
  }

  if (!draft.client) {
    draft.client = text;
    draft.clientRow = rowNumber;
    return;
  }

  if (!draft.product) {
    draft.product = text;
    draft.productRow = rowNumber;
    return;
  }

  draft.notes.push(text);
}

/** PlannerParser — geometría columnar SEMANAS 2026 (bloques visuales). */
export function parsePlannerTab(input: PlannerParserInput): PlannerParserResult {
  const warnings: string[] = [];
  let itemsCreated = 0;
  const ctx = defaultContext(input.tab);

  const columnDrafts = new Map<number, ColumnSlotDraft>();
  const getDraft = (col: number): ColumnSlotDraft => {
    if (!columnDrafts.has(col)) {
      columnDrafts.set(col, emptyColumnDraft());
    }
    return columnDrafts.get(col)!;
  };

  const flushAllDrafts = (rowNumber: number) => {
    for (const [col, draft] of columnDrafts) {
      if (draft.client || draft.product || draft.quantity) {
        itemsCreated += flushColumnDrafts(
          input.registry,
          input.assembler,
          ctx,
          col,
          draft,
          input.fileId,
          input.tab,
          rowNumber,
          input.rows,
          warnings
        );
      }
    }
    columnDrafts.clear();
  };

  for (let rowIndex = 0; rowIndex < input.rows.length; rowIndex++) {
    const row = input.rows[rowIndex] ?? [];
    const rowNumber = rowIndex + 1;

    if (!row.some((c) => c.trim())) {
      flushAllDrafts(rowNumber);
      continue;
    }

    // Antes del ancla Lunes/Martes: filas humanas ("martes 14 julio") también
    // contienen esos nombres y no deben tratarse como ancla de solo día.
    if (isDateHeaderRow(row)) {
      flushAllDrafts(rowNumber);
      const extracted = extractColumnDatesFromHeaderRow(row, SEMANAS_OPERATIONAL_YEAR);
      if (extracted.dayColumns.size > 0) {
        ctx.dayColumns = extracted.dayColumns;
        ctx.columnDates = extracted.columnDates;
        ctx.dateHeaderRow = rowNumber;
        ctx.weekLabel = `Semana ${rowNumber}`;
        ctx.dayNumbers.clear();
        ctx.monthLabel = null;
        ctx.monthByColumn.clear();
        for (const w of extracted.warnings) warnings.push(`${input.tab}:${w}`);
      }
      continue;
    }

    if (isWeekAnchorRow(row)) {
      flushAllDrafts(rowNumber);
      ctx.dayColumns = extractDayColumns(row);
      ctx.weekLabel = `Semana ${rowNumber}`;
      ctx.dayNumbers.clear();
      ctx.monthLabel = null;
      ctx.monthByColumn.clear();
      ctx.columnDates.clear();
      ctx.dateHeaderRow = null;
      ctx.line = null;
      continue;
    }

    if (isDayNumbersRow(row, ctx.dayColumns)) {
      for (const colIndex of ctx.dayColumns.keys()) {
        const t = normalizeCellText(row[colIndex] ?? "");
        if (/^\d+([.,]\d+)?$/.test(t)) {
          ctx.dayNumbers.set(colIndex, t.replace(/\.0$/, ""));
        }
      }
      rebuildSplitColumnDates(ctx, warnings);
      if (ctx.columnDates.size > 0) {
        ctx.dateHeaderRow = rowNumber;
      }
      continue;
    }

    if (isMonthRow(row, ctx.dayColumns)) {
      ctx.monthByColumn.clear();
      for (const colIndex of ctx.dayColumns.keys()) {
        const cell = normalizeCellText(row[colIndex] ?? "");
        if (cell && isMonthName(cell)) {
          ctx.monthByColumn.set(colIndex, cell);
        }
      }
      const months = [...ctx.monthByColumn.values()];
      ctx.monthLabel = months[0] ?? null;
      rebuildSplitColumnDates(ctx, warnings);
      if (ctx.columnDates.size > 0 && ctx.dateHeaderRow == null) {
        ctx.dateHeaderRow = rowNumber;
      }
      continue;
    }

    const packagingSector = detectPackagingSectorHeader(row);
    if (packagingSector) {
      flushAllDrafts(rowNumber);
      ctx.sector = packagingSector;
      const lineOnSectorRow = detectLineHeader(row);
      ctx.line = lineOnSectorRow;
      continue;
    }

    const lineHeader = detectLineHeader(row);
    if (lineHeader && ctx.tabSector === "ACONDICIONAMIENTO") {
      flushAllDrafts(rowNumber);
      ctx.line = lineHeader;
      const inferredCols = inferDayColumnsFromLineRow(row);
      if (inferredCols.size > 0 && ctx.columnDates.size === 0) {
        ctx.dayColumns = inferredCols;
      }
      continue;
    }

    const branchOwner = detectBranchOwnerRow(row, ctx.tabSector);
    if (branchOwner) {
      flushAllDrafts(rowNumber);
      ctx.branchOwner = branchOwner;
      continue;
    }

    let touchedColumn = false;
    for (const [colIndex] of ctx.dayColumns) {
      const cell = normalizeCellText(row[colIndex] ?? "");
      if (!cell) continue;

      touchedColumn = true;
      const draft = getDraft(colIndex);

      if (draft.quantity && (draft.client || draft.product)) {
        itemsCreated += flushColumnDrafts(
          input.registry,
          input.assembler,
          ctx,
          colIndex,
          draft,
          input.fileId,
          input.tab,
          rowNumber,
          input.rows,
          warnings
        );
        columnDrafts.set(colIndex, emptyColumnDraft());
      }

      classifyAndStack(cell, getDraft(colIndex), rowNumber);
    }

    if (!touchedColumn && ctx.tabSector === "ELABORACION") {
      const leftCell = normalizeCellText(row[1] ?? row[0] ?? "");
      if (leftCell && !isWeekAnchorRow(row)) {
        classifyAndStack(leftCell, getDraft(1), rowNumber);
      }
    }
  }

  flushAllDrafts(input.rows.length);

  if (itemsCreated === 0) {
    warnings.push(`${input.tab}: PlannerParser no detectó slots de trabajo.`);
  }

  return { itemsCreated, warnings };
}

export const PLANNER_TABS = ["ELABORACION", "ACONDICIONAMIENTO"] as const;
