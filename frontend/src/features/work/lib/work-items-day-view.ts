import type { WorkItem } from "@/types/operational/work-item";
import {
  addDays,
  formatShortDay,
  isSameDay,
  startOfDay,
  toIsoDate,
} from "./calendar";

export const MASIVO_LINE_IDS = ["LÍNEA 1", "LÍNEA 2", "LÍNEA 3"] as const;
export type MasivoLineId = (typeof MASIVO_LINE_IDS)[number];

export interface MasivoLineSlot {
  lineId: string;
  work: WorkItem | null;
}

export interface DayScheduleView {
  isoDate: string;
  lines: MasivoLineSlot[];
  items: WorkItem[];
  jobCount: number;
  totalUnits: number;
  statusLabel: string;
}

export interface WeekDaySummary {
  date: Date;
  isoDate: string;
  jobCount: number;
  totalUnits: number;
  statusLabel: string;
}

function normalizeText(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");
}

function parseSheetDate(raw: string, anchor: Date): Date | null {
  const trimmed = raw.trim();
  if (!trimmed) return null;

  if (/^\d{4}-\d{2}-\d{2}/.test(trimmed)) {
    const parsed = startOfDay(new Date(trimmed));
    return Number.isNaN(parsed.getTime()) ? null : parsed;
  }

  const slash = trimmed.match(/^(\d{1,2})[/.-](\d{1,2})(?:[/.-](\d{2,4}))?$/);
  if (slash) {
    const day = Number.parseInt(slash[1], 10);
    const month = Number.parseInt(slash[2], 10) - 1;
    const yearRaw = slash[3];
    const year = yearRaw
      ? Number.parseInt(yearRaw.length === 2 ? `20${yearRaw}` : yearRaw, 10)
      : anchor.getFullYear();
    return startOfDay(new Date(year, month, day));
  }

  return null;
}

export function normalizeMasivoLine(line: string | null): MasivoLineId | null {
  if (!line) return null;
  const normalized = normalizeText(line);
  if (normalized.includes("linea 1") || normalized === "l1" || normalized.includes("linea1")) {
    return "LÍNEA 1";
  }
  if (normalized.includes("linea 2") || normalized === "l2" || normalized.includes("linea2")) {
    return "LÍNEA 2";
  }
  if (normalized.includes("linea 3") || normalized === "l3" || normalized.includes("linea3")) {
    return "LÍNEA 3";
  }
  return null;
}

export function workItemMatchesDate(item: WorkItem, date: Date, today: Date): boolean {
  if (item.date) {
    const parsed = parseSheetDate(item.date, today);
    if (parsed && isSameDay(parsed, date)) return true;
  }

  if (item.deliveryDate) {
    const parsed = parseSheetDate(item.deliveryDate, today);
    if (parsed && isSameDay(parsed, date)) return true;
  }

  if (item.dayLabel) {
    const dayName = normalizeText(formatShortDay(date));
    const label = normalizeText(item.dayLabel);
    if (label === dayName || label.startsWith(dayName.slice(0, 3))) return true;
  }

  return false;
}

export function filterWorkItemsForDate(
  items: WorkItem[],
  date: Date,
  today: Date
): WorkItem[] {
  const dated = items.filter((item) => workItemMatchesDate(item, date, today));
  if (dated.length > 0) return dated;

  const hasDateMetadata = items.some((item) => item.date || item.dayLabel || item.deliveryDate);
  if (!hasDateMetadata && isSameDay(date, today)) return items;

  return [];
}

function parseQuantity(value: string | null): number {
  if (!value) return 0;
  const digits = value.replace(/[^\d]/g, "");
  const parsed = Number.parseInt(digits, 10);
  return Number.isNaN(parsed) ? 0 : parsed;
}

export function formatWorkItemPresentation(item: WorkItem): string {
  if (item.quantity && item.unit) {
    return `${item.quantity} × ${item.unit}`;
  }
  return item.quantity ?? "—";
}

export function formatWorkItemDelivery(item: WorkItem, today: Date): string {
  if (item.deliveryDate) {
    const parsed = parseSheetDate(item.deliveryDate, today);
    if (parsed && isSameDay(parsed, today)) return "Hoy";
    if (parsed && isSameDay(parsed, addDays(today, 1))) return "Mañana";
    return item.deliveryDate;
  }
  if (item.priority === "HOY") return "Hoy";
  if (item.priority === "URGENTE") return "Urgente";
  if (item.priority === "ESTA_SEMANA") return "Esta semana";
  return "—";
}

export function summarizeWorkItems(items: WorkItem[]) {
  return {
    paraHacer: items.filter((i) => i.status === "pendiente").length,
    enProgreso: items.filter((i) => i.status === "en_curso").length,
    terminadas: items.filter((i) => i.status === "completo").length,
    bloqueadas: items.filter((i) => i.status === "bloqueado").length,
  };
}

export function buildDayScheduleView(
  items: WorkItem[],
  date: Date,
  today: Date
): DayScheduleView {
  return buildLineScheduleView(items, date, today, [...MASIVO_LINE_IDS]);
}

export function buildLineScheduleView(
  items: WorkItem[],
  date: Date,
  today: Date,
  lineIds: readonly string[]
): DayScheduleView {
  const dayItems = filterWorkItemsForDate(items, date, today);

  const normalizeLineForSlot = (line: string | null): string | null => {
    if (!line) return null;
    const masivo = normalizeMasivoLine(line);
    if (masivo) return masivo;
    return line.trim().toUpperCase();
  };

  const lines: MasivoLineSlot[] = lineIds.map((lineId) => {
    const match =
      dayItems.find((item) => normalizeLineForSlot(item.line) === lineId) ??
      dayItems.find((item) => normalizeText(item.line ?? "") === normalizeText(lineId)) ??
      null;
    return { lineId, work: match };
  });

  const assigned = new Set(lines.map((l) => l.work?.id).filter(Boolean));
  const unassigned = dayItems.filter((item) => !assigned.has(item.id));
  if (unassigned.length > 0) {
    for (const slot of lines) {
      if (!slot.work && unassigned.length > 0) {
        slot.work = unassigned.shift() ?? null;
      }
    }
  }

  const totalUnits = dayItems.reduce((sum, item) => sum + parseQuantity(item.quantity), 0);
  const blocked = dayItems.filter((i) => i.status === "bloqueado").length;

  let statusLabel = "Sin trabajos";
  if (dayItems.length > 0) {
    statusLabel =
      blocked > 0
        ? `${dayItems.length} trabajo(s) · ${blocked} bloqueado(s)`
        : `${dayItems.length} trabajo(s)`;
  }

  return {
    isoDate: toIsoDate(date),
    lines,
    items: dayItems,
    jobCount: dayItems.length,
    totalUnits,
    statusLabel,
  };
}

export function discoverPackagingLines(items: WorkItem[]): string[] {
  const discovered = new Set<string>();
  for (const item of items) {
    if (item.line?.trim()) {
      discovered.add(item.line.trim());
    }
  }
  if (discovered.size > 0) {
    return [...discovered].sort((a, b) => a.localeCompare(b, "es"));
  }
  return ["PREMIUM A", "PREMIUM B"];
}

export function buildWeekPlanSummary(
  items: WorkItem[],
  weekDays: Date[],
  today: Date
): WeekDaySummary[] {
  return weekDays.map((day) => {
    const dayItems = filterWorkItemsForDate(items, day, today);
    const totalUnits = dayItems.reduce((sum, item) => sum + parseQuantity(item.quantity), 0);
    const blocked = dayItems.filter((i) => i.status === "bloqueado").length;

    let statusLabel = "Sin trabajos";
    if (dayItems.length > 0) {
      statusLabel = blocked > 0 ? `${blocked} bloqueado(s)` : `${dayItems.length} trabajo(s)`;
    }

    return {
      date: day,
      isoDate: toIsoDate(day),
      jobCount: dayItems.length,
      totalUnits,
      statusLabel,
    };
  });
}

export function extractUpcomingDeliveries(items: WorkItem[], today: Date) {
  return items
    .filter((item) => item.deliveryDate || item.priority === "HOY" || item.priority === "URGENTE")
    .slice(0, 5)
    .map((item) => ({
      client: item.client ?? "—",
      product: item.product ?? "—",
      when: formatWorkItemDelivery(item, today),
    }));
}

export function extractProblems(items: WorkItem[]): string[] {
  const problems: string[] = [];

  for (const item of items) {
    if (item.status === "bloqueado") {
      problems.push(
        `${item.line ?? "Sin línea"} bloqueado — ${item.client ?? item.product ?? "trabajo"}`
      );
    }
    if (item.priority === "URGENTE") {
      problems.push(`Urgente — ${item.client ?? item.product ?? "trabajo"}`);
    }
    if (item.notes?.trim()) {
      problems.push(item.notes.trim());
    }
    if (item.blockedBy?.length) {
      problems.push(`Esperando: ${item.blockedBy.join(", ")}`);
    }
  }

  return [...new Set(problems)].slice(0, 6);
}
