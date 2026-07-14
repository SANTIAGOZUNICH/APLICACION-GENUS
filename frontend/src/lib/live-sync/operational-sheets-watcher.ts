import "server-only";

import { createHash } from "node:crypto";
import { google } from "googleapis";
import { createGoogleAuth } from "@/lib/adapters/google/google-auth";
import { operationsDocumentRepository } from "@/lib/adapters/drive/operations-document-repository";
import type { CriticalSheetKey } from "@/lib/adapters/drive/drive-folder-config";
import { PLANNER_TABS } from "@/lib/parsers/planner/planner-parser";

/**
 * OperationalSheetsWatcher — servicio request-driven.
 * Calcula versión/hash de SEMANAS por contenido (Sheets API).
 * No inicia timers ni loops en background entre invocaciones.
 */

const OPERATIONAL_TABS = [...PLANNER_TABS] as const;
const CHECK_RESULT_TTL_MS = 2_000;

export interface SheetContentDigest {
  key: CriticalSheetKey;
  spreadsheetId: string;
  hash: string;
  sampledAt: string;
}

export interface LiveSyncCheckMetrics {
  checksExecuted: number;
  checksDeduped: number;
  sheetsReads: number;
  hashUnchanged: number;
  hashChanged: number;
  rateLimit429: number;
  lastReadDurationMs: number | null;
  lastParseDurationMs: number | null;
}

export interface SemanasVersionResult {
  version: string;
  spreadsheetId: string;
  sampledAt: string;
  fromCache: boolean;
  readDurationMs: number;
}

type DigestReader = (spreadsheetId: string) => Promise<{
  hash: string;
  readDurationMs: number;
}>;

const lastHashes = new Map<CriticalSheetKey, string>();

const metrics: LiveSyncCheckMetrics = {
  checksExecuted: 0,
  checksDeduped: 0,
  sheetsReads: 0,
  hashUnchanged: 0,
  hashChanged: 0,
  rateLimit429: 0,
  lastReadDurationMs: null,
  lastParseDurationMs: null,
};

let digestReaderOverride: DigestReader | null = null;
let inFlightVersion: Promise<SemanasVersionResult> | null = null;
let cachedVersion: SemanasVersionResult | null = null;
let cachedVersionAt = 0;

function hashRows(parts: string[]): string {
  return createHash("sha256").update(parts.join("\n")).digest("hex");
}

function serializeRows(rows: string[][]): string {
  return rows.map((row) => row.map((c) => String(c ?? "")).join("\t")).join("\n");
}

function isRateLimitError(err: unknown): boolean {
  if (!err || typeof err !== "object") return false;
  const e = err as { code?: number | string; status?: number; message?: string };
  if (e.code === 429 || e.status === 429) return true;
  if (typeof e.code === "string" && e.code.includes("429")) return true;
  if (typeof e.message === "string" && /rate limit|quota|429/i.test(e.message)) {
    return true;
  }
  return false;
}

async function defaultDigestReader(spreadsheetId: string): Promise<{
  hash: string;
  readDurationMs: number;
}> {
  const auth = createGoogleAuth();
  const sheets = google.sheets({ version: "v4", auth });
  const started = Date.now();

  try {
    const response = await sheets.spreadsheets.values.batchGet({
      spreadsheetId,
      ranges: [...OPERATIONAL_TABS],
    });

    const parts: string[] = [];
    for (const valueRange of response.data.valueRanges ?? []) {
      const range = valueRange.range ?? "unknown";
      const tab = range.split("!")[0]?.replace(/^'|'$/g, "") ?? range;
      const rows = (valueRange.values as string[][]) ?? [];
      parts.push(`${tab}::${serializeRows(rows)}`);
    }

    if (parts.length === 0) {
      parts.push("empty");
    }

    return {
      hash: hashRows(parts),
      readDurationMs: Date.now() - started,
    };
  } catch (err) {
    if (isRateLimitError(err)) {
      metrics.rateLimit429 += 1;
    }
    throw err;
  }
}

/** Versión global de SEMANAS (ELABORACION + ACONDICIONAMIENTO vía batchGet). */
export async function getSemanasVersion(): Promise<SemanasVersionResult> {
  const now = Date.now();
  if (cachedVersion && now - cachedVersionAt < CHECK_RESULT_TTL_MS) {
    metrics.checksDeduped += 1;
    return { ...cachedVersion, fromCache: true };
  }

  if (inFlightVersion) {
    metrics.checksDeduped += 1;
    return inFlightVersion;
  }

  inFlightVersion = (async () => {
    metrics.checksExecuted += 1;
    metrics.sheetsReads += 1;

    await operationsDocumentRepository.ensureOperationalReady();
    const ref = await operationsDocumentRepository.tryGetCriticalSheetRef("semanas_2026");
    if (!ref) {
      throw new Error("SEMANAS 2026 no disponible.");
    }

    const reader = digestReaderOverride ?? defaultDigestReader;
    const { hash, readDurationMs } = await reader(ref.fileId);
    metrics.lastReadDurationMs = readDurationMs;

    const result: SemanasVersionResult = {
      version: hash,
      spreadsheetId: ref.fileId,
      sampledAt: new Date().toISOString(),
      fromCache: false,
      readDurationMs,
    };

    cachedVersion = result;
    cachedVersionAt = Date.now();
    lastHashes.set("semanas_2026", hash);
    return result;
  })().finally(() => {
    inFlightVersion = null;
  });

  return inFlightVersion;
}

export async function computeSheetDigest(
  key: CriticalSheetKey
): Promise<SheetContentDigest | null> {
  if (key !== "semanas_2026") {
    return null;
  }

  try {
    const version = await getSemanasVersion();
    return {
      key,
      spreadsheetId: version.spreadsheetId,
      hash: version.version,
      sampledAt: version.sampledAt,
    };
  } catch {
    return null;
  }
}

/**
 * Compara knownVersion con el hash vivo de SEMANAS.
 * No rebuild — solo lectura/versión. Side effect: actualiza métricas de igualdad.
 */
export async function checkForChanges(knownVersion: string | null | undefined): Promise<{
  changed: boolean;
  version: string;
  spreadsheetId: string;
  checkedAt: string;
  readDurationMs: number;
  fromCache: boolean;
}> {
  const digest = await getSemanasVersion();
  const known = knownVersion?.trim() || null;
  const changed = Boolean(known) && known !== digest.version;

  if (changed) {
    metrics.hashChanged += 1;
  } else if (known) {
    metrics.hashUnchanged += 1;
  }

  return {
    changed,
    version: digest.version,
    spreadsheetId: digest.spreadsheetId,
    checkedAt: digest.sampledAt,
    readDurationMs: digest.readDurationMs,
    fromCache: digest.fromCache,
  };
}

export function rememberSheetHash(key: CriticalSheetKey, hash: string): void {
  lastHashes.set(key, hash);
  if (key === "semanas_2026") {
    if (cachedVersion && cachedVersion.version === hash) {
      cachedVersionAt = Date.now();
    } else if (cachedVersion) {
      cachedVersion = { ...cachedVersion, version: hash, sampledAt: new Date().toISOString() };
      cachedVersionAt = Date.now();
    }
  }
}

export function getRememberedSheetHash(key: CriticalSheetKey): string | undefined {
  return lastHashes.get(key);
}

export function getLiveSyncCheckMetrics(): LiveSyncCheckMetrics {
  return { ...metrics };
}

export function recordParseDuration(ms: number): void {
  metrics.lastParseDurationMs = ms;
}

export function recordHashComparison(changed: boolean): void {
  if (changed) metrics.hashChanged += 1;
  else metrics.hashUnchanged += 1;
}

/** Solo tests. */
export function resetOperationalSheetsWatcherForTests(): void {
  lastHashes.clear();
  inFlightVersion = null;
  cachedVersion = null;
  cachedVersionAt = 0;
  digestReaderOverride = null;
  metrics.checksExecuted = 0;
  metrics.checksDeduped = 0;
  metrics.sheetsReads = 0;
  metrics.hashUnchanged = 0;
  metrics.hashChanged = 0;
  metrics.rateLimit429 = 0;
  metrics.lastReadDurationMs = null;
  metrics.lastParseDurationMs = null;
}

/** Solo tests — inyecta lector de digest sin Sheets API. */
export function setSemanasDigestReaderForTests(reader: DigestReader | null): void {
  digestReaderOverride = reader;
}

export function invalidateSemanasVersionCache(): void {
  cachedVersion = null;
  cachedVersionAt = 0;
}
