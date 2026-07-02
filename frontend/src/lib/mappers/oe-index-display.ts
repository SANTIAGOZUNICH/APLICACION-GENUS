import type { OeIndexEntry, OeListItem } from "@/lib/adapters/drive/types/document.types";
import { oePageHref } from "@/config/entity-pages";
import { parseOeFileNameMetadata } from "@/lib/mappers/oe-file-name";
import { Status } from "@/types/ui/status";

/** E7.2 — display-only status for OEs known from Drive index, not from Sheet content. */
export const OE_INDEX_STATUS = Status.PENDIENTE;

export function formatOeModifiedTime(modifiedTime?: string): string {
  if (!modifiedTime) return "No detectado";
  const date = new Date(modifiedTime);
  if (Number.isNaN(date.getTime())) return modifiedTime;
  return date.toLocaleDateString("es-AR", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export function extractMonthFolderLabel(folderPath?: string): string {
  if (!folderPath?.trim()) return "Sin carpeta";
  const parts = folderPath.split("/").filter(Boolean);
  return parts[parts.length - 1] ?? folderPath;
}

export function buildOeIndexCardData(entry: OeListItem | OeIndexEntry) {
  const parsed = parseOeFileNameMetadata(entry.fileName);
  const title = parsed.cliente
    ? `${parsed.producto} · ${parsed.cliente}`
    : parsed.producto;

  return {
    lookupKey: entry.fileSlug || entry.fileId,
    oeId: entry.fileSlug || entry.fileId,
    title,
    producto: parsed.producto,
    cliente: parsed.cliente,
    fileName: entry.fileName,
    folderPath: entry.folderPath,
    folderLabel: extractMonthFolderLabel(entry.folderPath),
    modifiedTime: entry.modifiedTime,
    modifiedLabel: formatOeModifiedTime(entry.modifiedTime),
    status: OE_INDEX_STATUS,
    statusLabel: "Indexada",
    href: oePageHref(entry.fileSlug || entry.fileId),
  };
}

export function oeIndexSearchFields(entry: OeListItem | OeIndexEntry): string[] {
  const card = buildOeIndexCardData(entry);
  return [
    entry.fileName,
    card.producto,
    card.cliente,
    entry.fileSlug,
    entry.folderPath,
    card.folderLabel,
  ].filter(Boolean) as string[];
}
