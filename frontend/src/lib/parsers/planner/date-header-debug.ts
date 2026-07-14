import {
  todayInBuenosAires,
  weekStartMonday,
} from "@/lib/operational/operational-calendar";
import {
  columnIndexToLetter,
  extractColumnDatesFromHeaderRow,
  SEMANAS_OPERATIONAL_YEAR,
} from "@/lib/parsers/planner/date-header-resolver";
import { isDateHeaderRow } from "@/lib/parsers/planner/planner-utils";
import type { WorkItem } from "@/types/operational/work-item";

export interface DateHeaderDebugSample {
  sheet: string;
  headerText: string;
  headerRange: string;
  resolvedDate: string;
  dayColumn: string;
  dayOfWeek: string;
  weekStart: string | null;
  method: string;
  workItemsCount: number;
  warnings: string[];
}

export interface DateHeaderDebugResult {
  checkedAt: string;
  todayBuenosAires: string;
  operationalYear: number;
  samples: DateHeaderDebugSample[];
  todayBySector: Record<
    string,
    {
      count: number;
      firstItems: Array<{
        product: string | null;
        client: string | null;
        quantity: string | null;
        plannedDate: string | null;
        ownerPerson: string | null;
        line: string | null;
        dateHeaderSourceRange?: string | null;
        dateResolutionMethod?: string | null;
      }>;
    }
  >;
  warnings: string[];
}

/** Escanea filas crudas y produce muestras de resolución de encabezados. */
export function collectDateHeaderSamplesFromRows(
  sheet: string,
  rows: string[][],
  workItems: WorkItem[],
  year = SEMANAS_OPERATIONAL_YEAR
): DateHeaderDebugSample[] {
  const samples: DateHeaderDebugSample[] = [];

  for (let rowIndex = 0; rowIndex < rows.length; rowIndex++) {
    const row = rows[rowIndex] ?? [];
    if (!isDateHeaderRow(row)) continue;

    const extracted = extractColumnDatesFromHeaderRow(row, year);
    const rowNumber = rowIndex + 1;

    for (const sample of extracted.samples) {
      const headerRange = `${sheet}!${sample.dayColumn}${rowNumber}`;
      const count = workItems.filter(
        (item) =>
          item.plannedDate === sample.resolvedDate &&
          (item.sourceSheet === sheet ||
            item.sourceRange?.startsWith(`${sheet}!`) ||
            item.dateHeaderSourceRange?.startsWith(`${sheet}!`))
      ).length;

      samples.push({
        sheet,
        headerText: sample.headerText,
        headerRange,
        resolvedDate: sample.resolvedDate,
        dayColumn: sample.dayColumn,
        dayOfWeek:
          extracted.columnDates.get(sample.colIndex)?.dayOfWeek ??
          extracted.dayColumns.get(sample.colIndex) ??
          "",
        weekStart: weekStartMonday(sample.resolvedDate),
        method: sample.method,
        workItemsCount: count,
        warnings: extracted.warnings.filter((w) =>
          w.includes(sample.headerText)
        ),
      });
    }
  }

  return samples;
}

export function buildTodayBySector(
  workItems: WorkItem[],
  today = todayInBuenosAires()
): DateHeaderDebugResult["todayBySector"] {
  const bySector: DateHeaderDebugResult["todayBySector"] = {};
  const todays = workItems.filter((i) => i.plannedDate === today);

  for (const item of todays) {
    const key = item.sector;
    if (!bySector[key]) {
      bySector[key] = { count: 0, firstItems: [] };
    }
    bySector[key].count += 1;
    if (bySector[key].firstItems.length < 5) {
      bySector[key].firstItems.push({
        product: item.product,
        client: item.client,
        quantity: item.quantity,
        plannedDate: item.plannedDate,
        ownerPerson: item.ownerPerson,
        line: item.line,
        dateHeaderSourceRange: item.dateHeaderSourceRange,
        dateResolutionMethod: item.dateResolutionMethod,
      });
    }
  }

  return bySector;
}

/** Helper de tests: letra de columna visible. */
export function debugColumnLetter(index0: number): string {
  return columnIndexToLetter(index0);
}
