/**
 * Fuentes configurables de Asignación de Lotes (Google Sheets) — 0032.
 * Neon (Production) o memoria de proceso (vitest / sin DATABASE_URL), mismo
 * patrón que asignacion-lotes-service.ts.
 */
import "server-only";

import { desc, eq } from "drizzle-orm";
import { canConfigureAsignacionLoteSources } from "@/features/os/operational/lib/asignacion-lote-sources-rbac";
import { getDb, isDatabaseConfigured } from "@/lib/db/client";
import { asignacionLoteSources } from "@/lib/db/schema";
import { sheetsReader } from "@/lib/adapters/sheets/sheets-reader";
import { extractSpreadsheetId } from "./spreadsheet-url";
import { ASIGNACION_LOTES_FIELD_ALIASES } from "@/features/os/operational/lib/asignacion-lotes-import";
import { autoMapColumns, normalizeHeaderKey } from "@/features/os/operational/lib/clipboard-import";
import { OrdersForbiddenError, OrdersNotFoundError, OrdersValidationError } from "@/lib/orders/types";
import type { AsignacionLotesActor } from "./types";
import type {
  AsignacionLoteSource,
  AsignacionLoteSourceInput,
  AsignacionLoteSourceUpdateInput,
  TestConnectionResult,
} from "./source-types";

const g = globalThis as unknown as { __genusAsignacionLoteSourcesMem?: AsignacionLoteSource[] };

function mem(): AsignacionLoteSource[] {
  if (!g.__genusAsignacionLoteSourcesMem) g.__genusAsignacionLoteSourcesMem = [];
  return g.__genusAsignacionLoteSourcesMem;
}

export function resetAsignacionLoteSourcesMemoryForTests(): void {
  g.__genusAsignacionLoteSourcesMem = [];
}

function neonEnabled(): boolean {
  return isDatabaseConfigured();
}

function makeId(): string {
  return `als-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function assertConfigAccess(actor: AsignacionLotesActor): void {
  if (!canConfigureAsignacionLoteSources(actor.sector)) {
    throw new OrdersForbiddenError(
      "Configurar fuentes de Asignación de Lotes está habilitado solo para Producción/Dirección."
    );
  }
}

function rowToDomain(row: typeof asignacionLoteSources.$inferSelect): AsignacionLoteSource {
  return {
    id: row.id,
    name: row.name,
    period: row.period,
    spreadsheetId: row.spreadsheetId,
    sheetTab: row.sheetTab,
    enabled: row.enabled,
    priority: row.priority,
    lastSyncAt: row.lastSyncAt ? row.lastSyncAt.toISOString() : null,
    lastSuccessfulSyncAt: row.lastSuccessfulSyncAt ? row.lastSuccessfulSyncAt.toISOString() : null,
    syncStatus: row.syncStatus as AsignacionLoteSource["syncStatus"],
    lastError: row.lastError,
    createdBy: row.createdBy,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

export class AsignacionLoteSourcesService {
  async list(actor: AsignacionLotesActor): Promise<AsignacionLoteSource[]> {
    assertConfigAccess(actor);
    if (neonEnabled()) {
      const db = getDb();
      const rows = await db.select().from(asignacionLoteSources).orderBy(desc(asignacionLoteSources.createdAt));
      return rows.map(rowToDomain);
    }
    return [...mem()].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }

  async get(actor: AsignacionLotesActor, id: string): Promise<AsignacionLoteSource | null> {
    assertConfigAccess(actor);
    if (neonEnabled()) {
      const db = getDb();
      const [row] = await db.select().from(asignacionLoteSources).where(eq(asignacionLoteSources.id, id));
      return row ? rowToDomain(row) : null;
    }
    return mem().find((s) => s.id === id) ?? null;
  }

  /** Lectura interna sin RBAC — usada por el motor de sync (proceso confiable, no un request de usuario). */
  async getForSync(id: string): Promise<AsignacionLoteSource | null> {
    if (neonEnabled()) {
      const db = getDb();
      const [row] = await db.select().from(asignacionLoteSources).where(eq(asignacionLoteSources.id, id));
      return row ? rowToDomain(row) : null;
    }
    return mem().find((s) => s.id === id) ?? null;
  }

  async listEnabledForSync(): Promise<AsignacionLoteSource[]> {
    if (neonEnabled()) {
      const db = getDb();
      const rows = await db.select().from(asignacionLoteSources).where(eq(asignacionLoteSources.enabled, true));
      return rows.map(rowToDomain);
    }
    return mem().filter((s) => s.enabled);
  }

  async create(actor: AsignacionLotesActor, input: AsignacionLoteSourceInput): Promise<AsignacionLoteSource> {
    assertConfigAccess(actor);
    const name = input.name.trim();
    // Hoja opcional (0033): vacío/omitido = descubrir e importar TODAS las
    // hojas compatibles del spreadsheet en cada sync, en vez de exigir una.
    const sheetTab = input.sheetTab?.trim() || null;
    if (!name) throw new OrdersValidationError("El nombre de la fuente es obligatorio.");
    const spreadsheetId = extractSpreadsheetId(input.spreadsheetUrlOrId);
    if (!spreadsheetId) {
      throw new OrdersValidationError(
        "No se pudo reconocer el spreadsheetId — pegá la URL completa de Google Sheets."
      );
    }

    const now = new Date().toISOString();
    const record: AsignacionLoteSource = {
      id: makeId(),
      name,
      period: input.period?.trim() ?? "",
      spreadsheetId,
      sheetTab,
      enabled: input.enabled ?? true,
      priority: input.priority ?? 0,
      lastSyncAt: null,
      lastSuccessfulSyncAt: null,
      syncStatus: "nunca_sincronizado",
      lastError: null,
      createdBy: actor.displayName || actor.email,
      createdAt: now,
      updatedAt: now,
    };

    if (neonEnabled()) {
      const db = getDb();
      await db.insert(asignacionLoteSources).values({
        id: record.id,
        name: record.name,
        period: record.period,
        spreadsheetId: record.spreadsheetId,
        sheetTab: record.sheetTab,
        enabled: record.enabled,
        priority: record.priority,
        syncStatus: record.syncStatus,
        createdBy: record.createdBy,
        createdAt: new Date(record.createdAt),
        updatedAt: new Date(record.updatedAt),
      });
      return record;
    }

    mem().push(record);
    return record;
  }

  async update(
    actor: AsignacionLotesActor,
    id: string,
    input: AsignacionLoteSourceUpdateInput
  ): Promise<AsignacionLoteSource> {
    assertConfigAccess(actor);
    const now = new Date().toISOString();

    if (neonEnabled()) {
      const db = getDb();
      const [existing] = await db.select().from(asignacionLoteSources).where(eq(asignacionLoteSources.id, id));
      if (!existing) throw new OrdersNotFoundError("Fuente no encontrada.");
      const patch: Partial<typeof asignacionLoteSources.$inferInsert> = { updatedAt: new Date(now) };
      if (input.name !== undefined) patch.name = input.name.trim();
      if (input.period !== undefined) patch.period = input.period.trim();
      if (input.sheetTab !== undefined) patch.sheetTab = input.sheetTab?.trim() || null;
      if (input.enabled !== undefined) patch.enabled = input.enabled;
      if (input.priority !== undefined) patch.priority = input.priority;
      await db.update(asignacionLoteSources).set(patch).where(eq(asignacionLoteSources.id, id));
      return rowToDomain({ ...existing, ...patch } as typeof asignacionLoteSources.$inferSelect);
    }

    const items = mem();
    const idx = items.findIndex((s) => s.id === id);
    if (idx < 0) throw new OrdersNotFoundError("Fuente no encontrada.");
    const existing = items[idx]!;
    const updated: AsignacionLoteSource = {
      ...existing,
      name: input.name !== undefined ? input.name.trim() : existing.name,
      period: input.period !== undefined ? input.period.trim() : existing.period,
      sheetTab: input.sheetTab !== undefined ? input.sheetTab?.trim() || null : existing.sheetTab,
      enabled: input.enabled !== undefined ? input.enabled : existing.enabled,
      priority: input.priority !== undefined ? input.priority : existing.priority,
      updatedAt: now,
    };
    items[idx] = updated;
    return updated;
  }

  /** Solo lo llama el motor de sync — no expuesto a RBAC de usuario. */
  async recordSyncOutcome(
    id: string,
    outcome: { ok: boolean; error?: string | null }
  ): Promise<void> {
    const now = new Date();
    if (neonEnabled()) {
      const db = getDb();
      const patch: Partial<typeof asignacionLoteSources.$inferInsert> = {
        lastSyncAt: now,
        syncStatus: outcome.ok ? "ok" : "error",
        lastError: outcome.ok ? null : outcome.error ?? "Error desconocido",
        updatedAt: now,
      };
      if (outcome.ok) patch.lastSuccessfulSyncAt = now;
      await db.update(asignacionLoteSources).set(patch).where(eq(asignacionLoteSources.id, id));
      return;
    }
    const items = mem();
    const idx = items.findIndex((s) => s.id === id);
    if (idx < 0) return;
    items[idx] = {
      ...items[idx]!,
      lastSyncAt: now.toISOString(),
      lastSuccessfulSyncAt: outcome.ok ? now.toISOString() : items[idx]!.lastSuccessfulSyncAt,
      syncStatus: outcome.ok ? "ok" : "error",
      lastError: outcome.ok ? null : outcome.error ?? "Error desconocido",
      updatedAt: now.toISOString(),
    };
  }

  /**
   * Prueba de conexión — NUNCA persiste nada. Lee metadata + headers reales
   * vía la misma sheetsReader que usa el resto del proyecto.
   */
  async testConnection(
    actor: AsignacionLotesActor,
    spreadsheetUrlOrId: string,
    sheetTab?: string
  ): Promise<TestConnectionResult> {
    assertConfigAccess(actor);
    const spreadsheetId = extractSpreadsheetId(spreadsheetUrlOrId);
    if (!spreadsheetId) {
      return {
        ok: false,
        spreadsheetAccessible: false,
        sheetFound: false,
        availableTabs: [],
        headersRecognized: [],
        headersUnrecognized: [],
        rowCount: 0,
        error: "No se pudo reconocer el spreadsheetId a partir de la URL.",
      };
    }

    let availableTabs: string[];
    try {
      availableTabs = await sheetsReader.listTabs(spreadsheetId);
    } catch (err) {
      return {
        ok: false,
        spreadsheetAccessible: false,
        sheetFound: false,
        availableTabs: [],
        headersRecognized: [],
        headersUnrecognized: [],
        rowCount: 0,
        error: err instanceof Error ? err.message : "No se pudo acceder a la planilla.",
      };
    }

    const tab = sheetTab?.trim() || availableTabs[0];
    if (!tab || !availableTabs.includes(tab)) {
      return {
        ok: false,
        spreadsheetAccessible: true,
        sheetFound: false,
        availableTabs,
        headersRecognized: [],
        headersUnrecognized: [],
        rowCount: 0,
        error: tab ? `La hoja "${tab}" no existe en esta planilla.` : "La planilla no tiene hojas.",
      };
    }

    const rows = await sheetsReader.readTab(spreadsheetId, tab);
    const header = rows[0] ?? [];
    const mapping = autoMapColumns(header, ASIGNACION_LOTES_FIELD_ALIASES);
    const mappedCols = new Set(Object.values(mapping).filter((idx): idx is number => idx !== null));
    const recognized: string[] = [];
    const unrecognized: string[] = [];
    header.forEach((label, colIndex) => {
      if (mappedCols.has(colIndex)) recognized.push(label);
      else if (normalizeHeaderKey(label)) unrecognized.push(label);
    });

    return {
      ok: true,
      spreadsheetAccessible: true,
      sheetFound: true,
      availableTabs,
      headersRecognized: recognized,
      headersUnrecognized: unrecognized,
      rowCount: Math.max(0, rows.length - 1),
    };
  }
}

let singleton: AsignacionLoteSourcesService | null = null;

export function getAsignacionLoteSourcesService(): AsignacionLoteSourcesService {
  if (!singleton) singleton = new AsignacionLoteSourcesService();
  return singleton;
}
