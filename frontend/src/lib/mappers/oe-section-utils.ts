import type { OeListItem } from "@/lib/adapters/drive/types/document.types";

const MONTH_NAMES = [
  "enero",
  "febrero",
  "marzo",
  "abril",
  "mayo",
  "junio",
  "julio",
  "agosto",
  "septiembre",
  "octubre",
  "noviembre",
  "diciembre",
] as const;

const RECENT_DAYS = 21;

function daysSince(isoDate?: string): number | null {
  if (!isoDate) return null;
  const date = new Date(isoDate);
  if (Number.isNaN(date.getTime())) return null;
  return (Date.now() - date.getTime()) / 86_400_000;
}

function folderContainsMonth(folderPath: string, month: string): boolean {
  return folderPath.toLowerCase().includes(month);
}

/** E7.2 produccion sections: recientes | julio | junio | meses-anteriores */
export function resolveProduccionSectionId(entry: OeListItem): string {
  const recentDays = daysSince(entry.modifiedTime);
  if (recentDays !== null && recentDays <= RECENT_DAYS) {
    return "recientes";
  }

  const path = entry.folderPath?.toLowerCase() ?? "";
  if (path && folderContainsMonth(path, "julio")) return "julio";
  if (path && folderContainsMonth(path, "junio")) return "junio";

  return "meses-anteriores";
}

export function sortOesByRecency<T extends { modifiedTime?: string }>(
  entries: T[]
): T[] {
  return [...entries].sort((left, right) => {
    const leftTime = left.modifiedTime ? Date.parse(left.modifiedTime) : 0;
    const rightTime = right.modifiedTime ? Date.parse(right.modifiedTime) : 0;
    return rightTime - leftTime;
  });
}

export { MONTH_NAMES };
