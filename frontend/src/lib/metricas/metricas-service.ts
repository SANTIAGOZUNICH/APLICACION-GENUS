import "server-only";

import { randomUUID } from "node:crypto";
import { sql } from "drizzle-orm";
import { getDb, isDatabaseConfigured } from "@/lib/db/client";
import { isFeatureMemoryAllowed } from "@/lib/db/feature-schema";
import {
  assertProcedureMetricsWritesEnabled,
  isProcedureMetricsSchemaReady,
} from "@/lib/db/procedure-metrics-schema";
import { OrdersForbiddenError, OrdersNotFoundError, OrdersValidationError } from "@/lib/orders/types";
import type { SectorId } from "@/types/operational/sector";
import {
  canAccessMetricas,
  canAdminAllMetricas,
  computeRanking,
  computeTotals,
  isMetricsEnvasadoSector,
  normalizeResponsibleKey,
  type MetricsActor,
  type MetricsListFilters,
  type MetricsRankingEntry,
  type MetricsSector,
  type PackagingMetricRecord,
} from "./types";

type Mem = { metrics: PackagingMetricRecord[] };

const g = globalThis as unknown as { __genusMetricasMem?: Mem };

function mem(): Mem {
  if (!g.__genusMetricasMem) g.__genusMetricasMem = { metrics: [] };
  return g.__genusMetricasMem;
}

export function resetMetricasMemoryForTests(): void {
  g.__genusMetricasMem = { metrics: [] };
}

function assertCanRead(actor: MetricsActor): void {
  if (!canAccessMetricas(actor.sector)) {
    throw new OrdersForbiddenError(
      "Métricas solo disponibles para Envasado Masivo, Premium y Producción."
    );
  }
}

/** Sector de escritura: Envasado usa el propio; Producción puede elegir targetSector. */
function resolveWriteSector(
  actor: MetricsActor,
  targetSector?: MetricsSector | null
): MetricsSector {
  assertCanRead(actor);
  if (canAdminAllMetricas(actor.sector)) {
    if (targetSector && isMetricsEnvasadoSector(targetSector)) return targetSector;
    throw new OrdersValidationError(
      "Producción debe indicar sector ENVASADO_MASIVO o ENVASADO_PREMIUM."
    );
  }
  if (!isMetricsEnvasadoSector(actor.sector)) {
    throw new OrdersForbiddenError("Sector no autorizado para métricas.");
  }
  return actor.sector;
}

function nowIso(): string {
  return new Date().toISOString();
}

function mapMetric(row: Record<string, unknown>): PackagingMetricRecord {
  const dateVal = row.metric_date;
  const metricDate =
    typeof dateVal === "string"
      ? dateVal.slice(0, 10)
      : new Date(String(dateVal)).toISOString().slice(0, 10);
  return {
    id: String(row.id),
    sector: String(row.sector) as MetricsSector,
    metricDate,
    product: row.product ? String(row.product) : null,
    units: Number(row.units ?? 0),
    responsibleDisplay: String(row.responsible_display ?? ""),
    responsibleKey: String(row.responsible_key ?? ""),
    workItemId: row.work_item_id ? String(row.work_item_id) : null,
    createdBy: String(row.created_by),
    createdBySector: String(row.created_by_sector) as SectorId,
    updatedBy: String(row.updated_by ?? ""),
    createdAt: new Date(String(row.created_at)).toISOString(),
    updatedAt: new Date(String(row.updated_at)).toISOString(),
    deletedAt: row.deleted_at ? new Date(String(row.deleted_at)).toISOString() : null,
  };
}

function applyFilters(
  records: PackagingMetricRecord[],
  actor: MetricsActor,
  filters: MetricsListFilters
): PackagingMetricRecord[] {
  return records.filter((r) => {
    if (r.deletedAt) return false;
    if (canAdminAllMetricas(actor.sector)) {
      if (filters.sector && filters.sector !== "ALL" && r.sector !== filters.sector) {
        return false;
      }
    } else if (r.sector !== actor.sector) {
      return false;
    }
    if (filters.dateFrom && r.metricDate < filters.dateFrom) return false;
    if (filters.dateTo && r.metricDate > filters.dateTo) return false;
    if (filters.product && !(r.product ?? "").toLowerCase().includes(filters.product.toLowerCase())) {
      return false;
    }
    if (filters.responsible) {
      const q = filters.responsible.toLowerCase();
      if (
        !r.responsibleDisplay.toLowerCase().includes(q) &&
        !r.responsibleKey.includes(q)
      ) {
        return false;
      }
    }
    return true;
  });
}

export class MetricasService {
  async list(
    actor: MetricsActor,
    filters: MetricsListFilters = {}
  ): Promise<PackagingMetricRecord[]> {
    assertCanRead(actor);

    if (isDatabaseConfigured() && (await isProcedureMetricsSchemaReady())) {
      try {
        const db = getDb();
        const res = await db.execute(sql`
          select * from packaging_metrics
          where deleted_at is null
          order by metric_date desc, created_at desc
        `);
        const rows = (res.rows as Record<string, unknown>[]).map(mapMetric);
        return applyFilters(rows, actor, filters);
      } catch {
        if (!isFeatureMemoryAllowed()) return [];
      }
    }

    if (!isFeatureMemoryAllowed()) return [];
    return applyFilters(mem().metrics, actor, filters);
  }

  async create(
    actor: MetricsActor,
    input: {
      metricDate: string;
      product?: string | null;
      units: number;
      responsibleDisplay: string;
      targetSector?: MetricsSector | null;
    }
  ): Promise<PackagingMetricRecord> {
    const sector = resolveWriteSector(actor, input.targetSector ?? null);
    await assertProcedureMetricsWritesEnabled();

    const units = Math.max(0, Math.floor(input.units));
    const responsibleDisplay = input.responsibleDisplay.trim();
    if (!responsibleDisplay) throw new OrdersValidationError("Responsable obligatorio.");
    if (!input.metricDate) throw new OrdersValidationError("Fecha obligatoria.");

    const id = randomUUID();
    const now = nowIso();
    const responsibleKey = normalizeResponsibleKey(responsibleDisplay);
    const record: PackagingMetricRecord = {
      id,
      sector,
      metricDate: input.metricDate.slice(0, 10),
      product: input.product?.trim() || null,
      units,
      responsibleDisplay,
      responsibleKey,
      workItemId: null,
      createdBy: actor.email,
      createdBySector: actor.sector,
      updatedBy: actor.email,
      createdAt: now,
      updatedAt: now,
      deletedAt: null,
    };

    if (isDatabaseConfigured() && (await isProcedureMetricsSchemaReady())) {
      const db = getDb();
      await db.execute(sql`
        insert into packaging_metrics (id, sector, metric_date, product, units, responsible_display, responsible_key, created_by, created_by_sector, updated_by, created_at, updated_at)
        values (${id}::uuid, ${sector}, ${record.metricDate}::date, ${record.product}, ${units}, ${responsibleDisplay}, ${responsibleKey}, ${actor.email}, ${actor.sector}, ${actor.email}, ${now}::timestamptz, ${now}::timestamptz)
      `);
    } else if (isFeatureMemoryAllowed()) {
      mem().metrics.push(record);
    }

    return record;
  }

  async update(
    actor: MetricsActor,
    id: string,
    patch: {
      metricDate?: string;
      product?: string | null;
      units?: number;
      responsibleDisplay?: string;
    }
  ): Promise<PackagingMetricRecord> {
    assertCanRead(actor);
    await assertProcedureMetricsWritesEnabled();

    const existing = await this.getById(actor, id);
    if (!existing) throw new OrdersNotFoundError("Registro no encontrado.");
    if (
      !canAdminAllMetricas(actor.sector) &&
      existing.sector !== actor.sector
    ) {
      throw new OrdersForbiddenError("No podés editar métricas de otro sector.");
    }

    const now = nowIso();
    const updated: PackagingMetricRecord = {
      ...existing,
      metricDate: patch.metricDate?.slice(0, 10) ?? existing.metricDate,
      product: patch.product !== undefined ? (patch.product?.trim() || null) : existing.product,
      units: patch.units !== undefined ? Math.max(0, Math.floor(patch.units)) : existing.units,
      responsibleDisplay: patch.responsibleDisplay?.trim() ?? existing.responsibleDisplay,
      responsibleKey: patch.responsibleDisplay
        ? normalizeResponsibleKey(patch.responsibleDisplay)
        : existing.responsibleKey,
      updatedBy: actor.email,
      updatedAt: now,
    };

    if (isDatabaseConfigured() && (await isProcedureMetricsSchemaReady())) {
      const db = getDb();
      await db.execute(sql`
        update packaging_metrics set
          metric_date = ${updated.metricDate}::date,
          product = ${updated.product},
          units = ${updated.units},
          responsible_display = ${updated.responsibleDisplay},
          responsible_key = ${updated.responsibleKey},
          updated_by = ${actor.email},
          updated_at = ${now}::timestamptz
        where id = ${id}::uuid
      `);
    } else if (isFeatureMemoryAllowed()) {
      const idx = mem().metrics.findIndex((m) => m.id === id);
      if (idx >= 0) mem().metrics[idx] = updated;
    }

    return updated;
  }

  async delete(actor: MetricsActor, id: string): Promise<void> {
    assertCanRead(actor);
    await assertProcedureMetricsWritesEnabled();
    const existing = await this.getById(actor, id);
    if (!existing) throw new OrdersNotFoundError("Registro no encontrado.");
    if (
      !canAdminAllMetricas(actor.sector) &&
      existing.sector !== actor.sector
    ) {
      throw new OrdersForbiddenError("No podés eliminar métricas de otro sector.");
    }
    const now = nowIso();

    if (isDatabaseConfigured() && (await isProcedureMetricsSchemaReady())) {
      const db = getDb();
      await db.execute(sql`
        update packaging_metrics set deleted_at = ${now}::timestamptz, updated_by = ${actor.email}, updated_at = ${now}::timestamptz
        where id = ${id}::uuid
      `);
    } else if (isFeatureMemoryAllowed()) {
      const m = mem().metrics.find((x) => x.id === id);
      if (m) m.deletedAt = now;
    }
  }

  async getById(actor: MetricsActor, id: string): Promise<PackagingMetricRecord | null> {
    assertCanRead(actor);
    if (isDatabaseConfigured() && (await isProcedureMetricsSchemaReady())) {
      try {
        const db = getDb();
        const res = await db.execute(sql`
          select * from packaging_metrics where id = ${id}::uuid and deleted_at is null limit 1
        `);
        const row = (res.rows as Record<string, unknown>[])[0];
        if (!row) return null;
        const metric = mapMetric(row);
        if (
          !canAdminAllMetricas(actor.sector) &&
          metric.sector !== actor.sector
        ) {
          return null;
        }
        return metric;
      } catch {
        if (!isFeatureMemoryAllowed()) return null;
      }
    }
    if (!isFeatureMemoryAllowed()) return null;
    const m = mem().metrics.find((x) => x.id === id && !x.deletedAt);
    if (!m) return null;
    if (!canAdminAllMetricas(actor.sector) && m.sector !== actor.sector) return null;
    return m;
  }

  async ranking(
    actor: MetricsActor,
    filters: MetricsListFilters = {}
  ): Promise<{ ranking: MetricsRankingEntry[]; totals: { totalUnits: number; recordCount: number } }> {
    const records = await this.list(actor, filters);
    const combined = canAdminAllMetricas(actor.sector) && (!filters.sector || filters.sector === "ALL");
    return {
      ranking: computeRanking(records, { includeSector: !combined }),
      totals: computeTotals(records),
    };
  }
}

let singleton: MetricasService | null = null;

export function getMetricasService(): MetricasService {
  if (!singleton) singleton = new MetricasService();
  return singleton;
}

