import "server-only";

import { createHash } from "node:crypto";
import { google } from "googleapis";
import { createGoogleAuth } from "@/lib/adapters/google/google-auth";
import { operationsDocumentRepository } from "@/lib/adapters/drive/operations-document-repository";
import type { CriticalSheetKey } from "@/lib/adapters/drive/drive-folder-config";
import { PLANNER_TABS } from "@/lib/parsers/planner/planner-parser";

/**
 * OperationalSheetsWatcher — observa Sheets críticos por contenido (hash).
 * Drive solo descubre IDs; no usa modifiedTime para sync operativa.
 */

const WATCHED_KEYS: CriticalSheetKey[] = [
  "semanas_2026",
  "pedidos_2026",
  "asignacion_lotes_2026",
];

const SEMANAS_TABS = [...PLANNER_TABS];

export interface SheetContentDigest {
  key: CriticalSheetKey;
  spreadsheetId: string;
  hash: string;
  sampledAt: string;
}

const lastHashes = new Map<CriticalSheetKey, string>();
let detectInFlight: Promise<{
  changed: CriticalSheetKey[];
  digests: SheetContentDigest[];
}> | null = null;

function hashRows(parts: string[]): string {
  return createHash("sha256").update(parts.join("\n")).digest("hex");
}

async function readTabValuesFresh(
  spreadsheetId: string,
  tab: string
): Promise<string[][]> {
  const auth = createGoogleAuth();
  const sheets = google.sheets({ version: "v4", auth });
  const response = await sheets.spreadsheets.values.get({
    spreadsheetId,
    range: tab,
  });
  return (response.data.values as string[][]) ?? [];
}

async function listTabsFresh(spreadsheetId: string): Promise<string[]> {
  const auth = createGoogleAuth();
  const sheets = google.sheets({ version: "v4", auth });
  const meta = await sheets.spreadsheets.get({
    spreadsheetId,
    fields: "sheets.properties.title",
  });
  return (
    meta.data.sheets
      ?.map((s) => s.properties?.title)
      .filter((t): t is string => Boolean(t)) ?? []
  );
}

function serializeRows(rows: string[][]): string {
  return rows.map((row) => row.map((c) => String(c ?? "")).join("\t")).join("\n");
}

async function digestSemanas(spreadsheetId: string): Promise<string> {
  const tabs = await listTabsFresh(spreadsheetId);
  const parts: string[] = [];

  for (const preferred of SEMANAS_TABS) {
    const match = tabs.find((t) => t.toUpperCase() === preferred.toUpperCase());
    if (!match) continue;
    try {
      const rows = await readTabValuesFresh(spreadsheetId, match);
      parts.push(`${match}::${serializeRows(rows)}`);
    } catch {
      parts.push(`${match}::ERROR`);
    }
  }

  if (parts.length === 0) {
    for (const tab of tabs.slice(0, 4)) {
      try {
        const rows = await readTabValuesFresh(spreadsheetId, tab);
        parts.push(`${tab}::${serializeRows(rows)}`);
      } catch {
        parts.push(`${tab}::ERROR`);
      }
    }
  }

  return hashRows(parts);
}

async function digestGeneric(spreadsheetId: string): Promise<string> {
  const tabs = await listTabsFresh(spreadsheetId);
  const parts: string[] = [];
  for (const tab of tabs.slice(0, 3)) {
    try {
      const rows = await readTabValuesFresh(spreadsheetId, tab);
      parts.push(`${tab}::${serializeRows(rows)}`);
    } catch {
      parts.push(`${tab}::ERROR`);
    }
  }
  return hashRows(parts);
}

export async function computeSheetDigest(
  key: CriticalSheetKey
): Promise<SheetContentDigest | null> {
  const ref = await operationsDocumentRepository.tryGetCriticalSheetRef(key);
  if (!ref) return null;

  try {
    const hash =
      key === "semanas_2026"
        ? await digestSemanas(ref.fileId)
        : await digestGeneric(ref.fileId);

    return {
      key,
      spreadsheetId: ref.fileId,
      hash,
      sampledAt: new Date().toISOString(),
    };
  } catch {
    return null;
  }
}

/** Detecta cambios por hash de contenido Sheets (sin Drive modifiedTime). */
export async function detectChangedSheetsByContent(): Promise<{
  changed: CriticalSheetKey[];
  digests: SheetContentDigest[];
}> {
  await operationsDocumentRepository.ensureOperationalReady();

  const changed: CriticalSheetKey[] = [];
  const digests: SheetContentDigest[] = [];

  for (const key of WATCHED_KEYS) {
    const digest = await computeSheetDigest(key);
    if (!digest) continue;
    digests.push(digest);

    const previous = lastHashes.get(key);
    if (previous === undefined) {
      lastHashes.set(key, digest.hash);
      continue;
    }

    if (previous !== digest.hash) {
      changed.push(key);
      lastHashes.set(key, digest.hash);
    }
  }

  return { changed, digests };
}

export function rememberSheetHash(key: CriticalSheetKey, hash: string): void {
  lastHashes.set(key, hash);
}

export function getRememberedSheetHash(key: CriticalSheetKey): string | undefined {
  return lastHashes.get(key);
}

/** Solo tests. */
export function resetOperationalSheetsWatcherForTests(): void {
  lastHashes.clear();
}
