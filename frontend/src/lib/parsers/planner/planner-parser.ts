import { SECTOR_PERSONNEL } from "@/features/os/operational/lib/sector-personnel";
import type { WorkItemRegistry } from "@/lib/domain/work-item/work-item-registry";
import type { SectorId } from "@/types/operational/sector";
import {
  detectBranchOwnerRow,
  detectLineHeader,
  detectPackagingSectorHeader,
  extractDayColumns,
  inferOriginStage,
  isOperationalNote,
  isQuantityCell,
  isWeekAnchorRow,
  normalizeCellText,
  slugify,
} from "@/lib/parsers/planner/planner-utils";

export interface PlannerParserInput {
  fileId: string;
  tab: string;
  rows: string[][];
  registry: WorkItemRegistry;
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
  dayNumbers: Map<number, string>;
}

interface ColumnSlotDraft {
  client: string | null;
  product: string | null;
  quantity: string | null;
  notes: string[];
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

function isMonthRow(row: string[]): boolean {
  const monthCells = row.filter((c) => c.trim()).map((c) => normalizeCellText(c));
  if (monthCells.length < 2) return false;
  return monthCells.every((c) => c.toLowerCase() === monthCells[0].toLowerCase() && /^[a-záéíóúñ]+$/i.test(c));
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
    dayNumbers: new Map(),
  };
}

function flushColumnDrafts(
  registry: WorkItemRegistry,
  ctx: PlannerContext,
  colIndex: number,
  draft: ColumnSlotDraft,
  fileId: string,
  tab: string,
  rowNumber: number
): number {
  if (!ctx.sector) return 0;
  if (!draft.client && !draft.product && !draft.quantity) return 0;

  const dayLabel = ctx.dayColumns.get(colIndex) ?? null;
  const dayNum = ctx.dayNumbers.get(colIndex);
  const plannedDate =
    dayNum && ctx.monthLabel ? `${dayNum} ${ctx.monthLabel}` : dayNum ?? null;

  const internalId = `planner:${fileId}:${slugify(tab)}:${slugify(ctx.sector)}:${slugify(ctx.line ?? "sin-linea")}:${slugify(ctx.branchOwner ?? "sin-rama")}:${colIndex}:${rowNumber}:${slugify(draft.product ?? draft.client ?? "slot")}`;

  registry.enrich(
    { internalId, client: draft.client, product: draft.product },
    {
      internalId,
      sector: ctx.sector,
      ownerSector: ctx.sector,
      line: ctx.line,
      branchOwner: ctx.branchOwner,
      sectorLead:
        ctx.sector === "ELABORACION" ? SECTOR_PERSONNEL.ELABORACION_ENCARGADO : null,
      weekLabel: ctx.weekLabel,
      dayLabel,
      date: plannedDate,
      plannedClient: draft.client,
      plannedProduct: draft.product,
      plannedQuantity: draft.quantity,
      notes: draft.notes.length > 0 ? draft.notes.join(" · ") : null,
      originStage: inferOriginStage(ctx.sector),
      priority: dayLabel === "Lunes" || dayLabel === "Martes" ? "ESTA_SEMANA" : null,
    },
    "semanas_2026",
    { fileId, range: `${tab}!${rowNumber}:${colIndex + 1}` }
  );

  return 1;
}

function classifyAndStack(
  text: string,
  draft: ColumnSlotDraft
): void {
  if (isOperationalNote(text)) {
    draft.notes.push(text);
    return;
  }

  if (isQuantityCell(text)) {
    draft.quantity = text;
    return;
  }

  if (!draft.client) {
    draft.client = text;
    return;
  }

  if (!draft.product) {
    draft.product = text;
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
      columnDrafts.set(col, { client: null, product: null, quantity: null, notes: [] });
    }
    return columnDrafts.get(col)!;
  };

  const flushAllDrafts = (rowNumber: number) => {
    for (const [col, draft] of columnDrafts) {
      if (draft.client || draft.product || draft.quantity) {
        itemsCreated += flushColumnDrafts(
          input.registry,
          ctx,
          col,
          draft,
          input.fileId,
          input.tab,
          rowNumber
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

    if (isWeekAnchorRow(row)) {
      flushAllDrafts(rowNumber);
      ctx.dayColumns = extractDayColumns(row);
      ctx.weekLabel = `Semana ${rowNumber}`;
      ctx.dayNumbers.clear();
      ctx.monthLabel = null;
      continue;
    }

    if (isDayNumbersRow(row, ctx.dayColumns)) {
      for (const colIndex of ctx.dayColumns.keys()) {
        const t = normalizeCellText(row[colIndex] ?? "");
        if (/^\d+([.,]\d+)?$/.test(t)) {
          ctx.dayNumbers.set(colIndex, t.replace(/\.0$/, ""));
        }
      }
      continue;
    }

    if (isMonthRow(row)) {
      const monthCells = row.filter((c) => c.trim()).map((c) => normalizeCellText(c));
      ctx.monthLabel = monthCells[0];
      continue;
    }

    const packagingSector = detectPackagingSectorHeader(row);
    if (packagingSector) {
      flushAllDrafts(rowNumber);
      ctx.sector = packagingSector;
      ctx.line = null;
      continue;
    }

    const lineHeader = detectLineHeader(row);
    if (lineHeader && ctx.tabSector === "ACONDICIONAMIENTO") {
      flushAllDrafts(rowNumber);
      ctx.line = lineHeader;
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
          ctx,
          colIndex,
          draft,
          input.fileId,
          input.tab,
          rowNumber
        );
        columnDrafts.set(colIndex, { client: null, product: null, quantity: null, notes: [] });
      }

      classifyAndStack(cell, getDraft(colIndex));
    }

    if (!touchedColumn && ctx.tabSector === "ELABORACION") {
      const leftCell = normalizeCellText(row[1] ?? row[0] ?? "");
      if (leftCell && !isWeekAnchorRow(row)) {
        const draft = getDraft(1);
        classifyAndStack(leftCell, draft);
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
