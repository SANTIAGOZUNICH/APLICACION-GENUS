import { stripSheetExtension } from "@/lib/adapters/drive/oe-document-locator";

export function parseOeFileNameMetadata(fileName: string): {
  producto: string;
  cliente?: string;
} {
  const base = stripSheetExtension(fileName);
  const parts = base
    .split(/\s[-–|]\s/)
    .map((part) => part.trim())
    .filter(Boolean);

  if (parts.length >= 2) {
    return {
      producto: parts[0],
      cliente: parts.slice(1).join(" · "),
    };
  }

  return { producto: base };
}
