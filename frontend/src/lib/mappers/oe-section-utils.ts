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

function daysSince(isoDate?: string): number | null {
  if (!isoDate) return null;
  const date = new Date(isoDate);
  if (Number.isNaN(date.getTime())) return null;
  return (Date.now() - date.getTime()) / 86_400_000;
}

/** Maps ELABORACION index metadata to existing produccion section ids. */
export function resolveProduccionSectionId(entry: OeListItem): string {
  const folderPath = entry.folderPath?.trim();
  const path = folderPath?.toLowerCase() ?? "";
  const recentDays = daysSince(entry.modifiedTime);

  if (recentDays !== null && recentDays <= 45) {
    return "en-curso";
  }

  if (!folderPath) {
    return "en-curso";
  }

  const monthInPath = MONTH_NAMES.find((month) => path.includes(month));
  if (!monthInPath) {
    return "en-curso";
  }

  const currentMonth = MONTH_NAMES[new Date().getMonth()];
  return path.includes(currentMonth) ? "en-curso" : "esperando-otros";
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
