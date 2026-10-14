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
import { metricNaturalKey, validateImportRow, type MetricsImportRow } from "./metricas-paste";
import type { MetricImportCommitResult, MetricImportPreviewRow } from "./metricas-service-types";
import type { SectorId } from "@/types/operational/sector";
import {
  canAccessMetricas,
  canAdminAllMetricas,
  computeRanking,
  computeTotals,
  isMetricsEnvasadoSector,
  MetricsConflictError,
  normalizeResponsibleKey,
  type MetricsActor,
  type MetricsListFilters,
  type MetricsRankingEntry,
  type MetricsSector,
  type PackagingMetricRecord,
} from "./types";

type MetricAuditEvent = { action: string; actorEmail: string; actorSector: string; entityId: string | null; idempotencyKey: string | null; payload: Record<string, unknown>; createdAt: string };
type Mem = { metrics: PackagingMetricRecord[]; audit: MetricAuditEvent[] };

const g = globalThis as unknown as { __genusMetricasMem?: Mem };

function mem(): Mem {
  if (!g.__genusMetricasMem) g.__genusMetricasMem = { metrics: [], audit: [] };
  return g.__genusMetricasMem;
}

export function resetMetricasMemoryForTests(): void {
  g.__genusMetricasMem = { metrics: [], audit: [] };
}

/** Auditoría en memoria (solo demo/pruebas): mismo contenido que feature_audit_events. */
export function getMetricasAuditMemoryForTests(): MetricAuditEvent[] {
  return mem().audit;
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


type SqlTx = { execute: (q: ReturnType<typeof sql>) => Promise<{ rows: unknown[] }> };

const recordSnapshot = (r: Pick<PackagingMetricRecord, "sector" | "metricDate" | "product" | "units" | "responsibleDisplay">) => ({
  sector: r.sector,
  metricDate: r.metricDate,
  product: r.product,
  units: r.units,
  responsibleDisplay: r.responsibleDisplay,
});

/** Auditoría de Métricas en feature_audit_events (dominio «metricas»): quién, cuándo, qué y valores antes/después. */
async function auditMetric(
  tx: SqlTx | null,
  actor: MetricsActor,
  event: { action: string; entityId: string | null; idempotencyKey?: string | null; payload: Record<string, unknown> }
): Promise<void> {
  if (tx) {
    await tx.execute(sql`
      insert into feature_audit_events (id, domain, action, actor_email, actor_sector, entity_id, idempotency_key, payload, created_at)
      values (${randomUUID()}::uuid, 'metricas', ${event.action}, ${actor.email}, ${String(actor.sector)}, ${event.entityId}, ${event.idempotencyKey ?? null}, ${JSON.stringify(event.payload)}::jsonb, now())
    `);
    return;
  }
  mem().audit.push({
    action: event.action,
    actorEmail: actor.email,
    actorSector: String(actor.sector),
    entityId: event.entityId,
    idempotencyKey: event.idempotencyKey ?? null,
    payload: event.payload,
    createdAt: nowIso(),
  });
}

export const MAX_METRIC_IMPORT_ROWS = 500;

export class MetricasService {
  async list(
    actor: MetricsActor,
    filters: MetricsListFilters = {}
  ): Promise<PackagingMetricRecord[]> {
    assertCanRead(actor);
    const onlyDeleted = Boolean(filters.onlyDeleted);

    if (isDatabaseConfigured() && (await isProcedureMetricsSchemaReady())) {
      try {
        const db = getDb();
        const res = await db.execute(
          onlyDeleted
            ? sql`
          select * from packaging_metrics
          where deleted_at is not null
          order by metric_date desc, created_at desc
        `
            : sql`
          select * from packaging_metrics
          where deleted_at is null
          order by metric_date desc, created_at desc
        `
        );
        const rows = (res.rows as Record<string, unknown>[]).map(mapMetric);
        return applyFilters(rows, actor, filters);
      } catch {
        if (!isFeatureMemoryAllowed()) return [];
      }
    }

    if (!isFeatureMemoryAllowed()) return [];
    const base = mem().metrics.filter((m) =>
      onlyDeleted ? Boolean(m.deletedAt) : !m.deletedAt
    );
    return applyFilters(base, actor, filters);
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
      await db.transaction(async (tx) => {
        await tx.execute(sql`
          insert into packaging_metrics (id, sector, metric_date, product, units, responsible_display, responsible_key, created_by, created_by_sector, updated_by, created_at, updated_at)
          values (${id}::uuid, ${sector}, ${record.metricDate}::date, ${record.product}, ${units}, ${responsibleDisplay}, ${responsibleKey}, ${actor.email}, ${actor.sector}, ${actor.email}, ${now}::timestamptz, ${now}::timestamptz)
        `);
        await auditMetric(tx, actor, { action: "create", entityId: id, payload: { after: recordSnapshot(record), via: "form" } });
      });
    } else if (isFeatureMemoryAllowed()) {
      mem().metrics.push(record);
      await auditMetric(null, actor, { action: "create", entityId: id, payload: { after: recordSnapshot(record), via: "form" } });
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
      /** Versión que el usuario tenía al editar (updatedAt). Si cambió, se rechaza con conflicto (nunca se pisa en silencio). */
      expectedUpdatedAt?: string;
      /** De dónde viene el cambio (queda en la auditoría). */
      via?: "form" | "grid";
    }
  ): Promise<PackagingMetricRecord> {
    assertCanRead(actor);
    await assertProcedureMetricsWritesEnabled();

    const buildUpdated = (existing: PackagingMetricRecord, now: string): PackagingMetricRecord => ({
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
    });
    const guard = (existing: PackagingMetricRecord | null): PackagingMetricRecord => {
      if (!existing) throw new OrdersNotFoundError("Registro no encontrado.");
      if (!canAdminAllMetricas(actor.sector) && existing.sector !== actor.sector) {
        throw new OrdersForbiddenError("No podés editar métricas de otro sector.");
      }
      if (patch.expectedUpdatedAt && patch.expectedUpdatedAt !== existing.updatedAt) {
        throw new MetricsConflictError("Otra persona modificó este registro al mismo tiempo. Recargá y volvé a aplicar tu cambio.");
      }
      if (patch.responsibleDisplay !== undefined && !patch.responsibleDisplay.trim()) {
        throw new OrdersValidationError("Responsable obligatorio.");
      }
      return existing;
    };

    if (isDatabaseConfigured() && (await isProcedureMetricsSchemaReady())) {
      const db = getDb();
      return db.transaction(async (tx) => {
        // Bloqueo de la fila: dos ediciones simultáneas se serializan y la segunda ve la versión nueva.
        const res = await tx.execute(sql`select * from packaging_metrics where id = ${id}::uuid and deleted_at is null for update`);
        const row = (res.rows as Record<string, unknown>[])[0];
        const existing = guard(row ? mapMetric(row) : null);
        const now = nowIso();
        const updated = buildUpdated(existing, now);
        await tx.execute(sql`
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
        await auditMetric(tx, actor, { action: "update", entityId: id, payload: { before: recordSnapshot(existing), after: recordSnapshot(updated), via: patch.via ?? "form" } });
        return updated;
      });
    }

    const existing = guard(await this.getById(actor, id));
    const updated = buildUpdated(existing, nowIso());
    if (isFeatureMemoryAllowed()) {
      const idx = mem().metrics.findIndex((m) => m.id === id);
      if (idx >= 0) mem().metrics[idx] = updated;
      await auditMetric(null, actor, { action: "update", entityId: id, payload: { before: recordSnapshot(existing), after: recordSnapshot(updated), via: patch.via ?? "form" } });
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
      await db.transaction(async (tx) => {
        await tx.execute(sql`
          update packaging_metrics set deleted_at = ${now}::timestamptz, updated_by = ${actor.email}, updated_at = ${now}::timestamptz
          where id = ${id}::uuid
        `);
        await auditMetric(tx, actor, { action: "delete", entityId: id, payload: { before: recordSnapshot(existing) } });
      });
    } else if (isFeatureMemoryAllowed()) {
      const m = mem().metrics.find((x) => x.id === id);
      if (m) m.deletedAt = now;
      await auditMetric(null, actor, { action: "delete", entityId: id, payload: { before: recordSnapshot(existing) } });
    }
  }

  /** Restaura una métrica soft-deleted (limpia deleted_at). */
  async restore(actor: MetricsActor, id: string): Promise<PackagingMetricRecord> {
    assertCanRead(actor);
    await assertProcedureMetricsWritesEnabled();

    if (isDatabaseConfigured() && (await isProcedureMetricsSchemaReady())) {
      const db = getDb();
      const existing = await db.execute(sql`
        select * from packaging_metrics where id = ${id}::uuid limit 1
      `);
      const row = (existing.rows as Record<string, unknown>[])[0];
      if (!row) throw new OrdersNotFoundError("Registro no encontrado.");
      const metric = mapMetric(row);
      if (
        !canAdminAllMetricas(actor.sector) &&
        metric.sector !== actor.sector
      ) {
        throw new OrdersForbiddenError("No podés restaurar métricas de otro sector.");
      }
      if (!metric.deletedAt) return metric;
      const now = nowIso();
      await db.transaction(async (tx) => {
        await tx.execute(sql`
          update packaging_metrics set deleted_at = null, updated_by = ${actor.email}, updated_at = ${now}::timestamptz
          where id = ${id}::uuid
        `);
        await auditMetric(tx, actor, { action: "restore", entityId: id, payload: { after: recordSnapshot(metric) } });
      });
      return { ...metric, deletedAt: null };
    }

    if (!isFeatureMemoryAllowed()) throw new OrdersNotFoundError("Registro no encontrado.");
    const m = mem().metrics.find((x) => x.id === id);
    if (!m) throw new OrdersNotFoundError("Registro no encontrado.");
    if (!canAdminAllMetricas(actor.sector) && m.sector !== actor.sector) {
      throw new OrdersForbiddenError("No podés restaurar métricas de otro sector.");
    }
    m.deletedAt = null;
    await auditMetric(null, actor, { action: "restore", entityId: id, payload: { after: recordSnapshot(m) } });
    return m;
  }

  // ───────────────────────── Pegado masivo desde Excel / Google Sheets ─────────────────────────

  /** Valida cada fila contra las reglas del actor (sector de escritura) y devuelve filas limpias o el error. */
  private prepareImportRows(actor: MetricsActor, rawRows: unknown[]): Array<{ row: MetricsImportRow } | { error: string }> {
    assertCanRead(actor);
    if (!Array.isArray(rawRows) || rawRows.length === 0) throw new OrdersValidationError("No hay filas para importar.");
    if (rawRows.length > MAX_METRIC_IMPORT_ROWS) {
      throw new OrdersValidationError(`Máximo ${MAX_METRIC_IMPORT_ROWS} filas por pegado. Dividí la planilla.`);
    }
    return rawRows.map((raw) => {
      const v = validateImportRow(raw);
      if (!v.ok) return { error: v.message };
      // Envasado solo escribe en su propio sector; Producción en Masivo/Premium (el sector de la fila se respeta).
      if (!canAdminAllMetricas(actor.sector) && v.row.sector !== actor.sector) {
        return { error: "No podés cargar métricas de otro sector." };
      }
      return { row: v.row };
    });
  }

  /** Registros vivos que podrían coincidir (mismos sectores y rango de fechas de lo pegado). */
  private async existingForImport(rows: MetricsImportRow[]): Promise<PackagingMetricRecord[]> {
    if (rows.length === 0) return [];
    const sectors = [...new Set(rows.map((r) => r.sector))];
    const dates = rows.map((r) => r.metricDate).sort();
    const from = dates[0]!;
    const to = dates[dates.length - 1]!;
    if (isDatabaseConfigured() && (await isProcedureMetricsSchemaReady())) {
      const db = getDb();
      const res = await db.execute(sql`
        select * from packaging_metrics
        where deleted_at is null and metric_date between ${from}::date and ${to}::date
      `);
      return (res.rows as Record<string, unknown>[]).map(mapMetric).filter((m) => sectors.includes(m.sector));
    }
    return mem().metrics.filter((m) => !m.deletedAt && sectors.includes(m.sector) && m.metricDate >= from && m.metricDate <= to);
  }

  private classify(prepared: Array<{ row: MetricsImportRow } | { error: string }>, existing: PackagingMetricRecord[]): MetricImportPreviewRow[] {
    const byKey = new Map<string, PackagingMetricRecord>();
    for (const m of existing) byKey.set(metricNaturalKey(m), m);
    const seen = new Set<string>();
    return prepared.map((p, index): MetricImportPreviewRow => {
      if ("error" in p) return { index, status: "invalid", message: p.error };
      const key = metricNaturalKey(p.row);
      if (seen.has(key)) {
        return { index, status: "duplicate_in_batch", message: "Repetida en lo pegado (misma fecha, producto y responsable): se usa solo la primera." };
      }
      seen.add(key);
      const ex = byKey.get(key);
      if (!ex) return { index, status: "new" };
      const info = { id: ex.id, units: ex.units, updatedAt: ex.updatedAt };
      if (ex.units === p.row.units) return { index, status: "identical", existing: info, message: "Ya existe con las mismas unidades." };
      return { index, status: "conflict", existing: info, message: `Ya existe con ${ex.units.toLocaleString("es-AR")} unidades; lo pegado dice ${p.row.units.toLocaleString("es-AR")}.` };
    });
  }

  /** Vista previa: clasifica cada fila (nueva / ya existe / existe con otras unidades / repetida / inválida). No escribe nada. */
  async importPreview(actor: MetricsActor, rawRows: unknown[]): Promise<MetricImportPreviewRow[]> {
    const prepared = this.prepareImportRows(actor, rawRows);
    const existing = await this.existingForImport(prepared.flatMap((p) => ("row" in p ? [p.row] : [])));
    return this.classify(prepared, existing);
  }

  /**
   * Confirma el pegado. Atómico (todo o nada) e idempotente por `batchId`.
   * - Filas nuevas → se crean.
   * - Ya existen con las mismas unidades → no se toca nada.
   * - Existen con otras unidades → SOLO se actualizan si el usuario las confirmó (`overwrite`: índice → updatedAt que vio).
   * - Repetidas dentro de lo pegado → solo la primera.
   */
  async importCommit(
    actor: MetricsActor,
    input: { batchId: string; rows: unknown[]; overwrite?: Record<string, string> }
  ): Promise<MetricImportCommitResult> {
    const batchId = String(input.batchId ?? "").trim();
    if (batchId.length < 6) throw new OrdersValidationError("Falta el identificador del pegado.");
    const prepared = this.prepareImportRows(actor, input.rows);
    await assertProcedureMetricsWritesEnabled();
    const overwrite = input.overwrite ?? {};
    const key = `metricas:import:${batchId}`;

    const plan = (existing: PackagingMetricRecord[]) => {
      const classified = this.classify(prepared, existing);
      return { classified };
    };

    const finish = (results: MetricImportCommitResult["results"]): MetricImportCommitResult => ({
      batchId,
      created: results.filter((r) => r.outcome === "created").length,
      updated: results.filter((r) => r.outcome === "updated").length,
      skipped: results.filter((r) => !["created", "updated"].includes(r.outcome)).length,
      results,
    });

    const applyRows = async (
      exec: SqlTx | null,
      classified: MetricImportPreviewRow[]
    ): Promise<MetricImportCommitResult["results"]> => {
      const results: MetricImportCommitResult["results"] = [];
      for (const c of classified) {
        const p = prepared[c.index]!;
        if ("error" in p) {
          results.push({ index: c.index, outcome: "invalid", message: p.error });
          continue;
        }
        const row = p.row;
        if (c.status === "duplicate_in_batch") {
          results.push({ index: c.index, outcome: "duplicate_in_batch", message: c.message });
        } else if (c.status === "identical") {
          results.push({ index: c.index, outcome: "identical", id: c.existing?.id });
        } else if (c.status === "conflict") {
          const confirmed = overwrite[String(c.index)];
          if (!confirmed) {
            results.push({ index: c.index, outcome: "conflict_not_confirmed", id: c.existing?.id, message: c.message });
          } else if (confirmed !== c.existing!.updatedAt) {
            // El registro cambió después de que el usuario vio la vista previa: no se pisa.
            results.push({ index: c.index, outcome: "conflict_not_confirmed", id: c.existing?.id, message: "El registro cambió mientras revisabas el pegado: volvé a abrir la vista previa." });
          } else {
            const now = nowIso();
            if (exec) {
              await exec.execute(sql`
                update packaging_metrics set units = ${row.units}, updated_by = ${actor.email}, updated_at = ${now}::timestamptz
                where id = ${c.existing!.id}::uuid
              `);
              await auditMetric(exec, actor, { action: "update", entityId: c.existing!.id, payload: { before: { units: c.existing!.units }, after: { units: row.units }, via: "paste", batchId } });
            } else {
              const m = mem().metrics.find((x) => x.id === c.existing!.id);
              if (m) {
                m.units = row.units;
                m.updatedBy = actor.email;
                m.updatedAt = now;
              }
              await auditMetric(null, actor, { action: "update", entityId: c.existing!.id, payload: { before: { units: c.existing!.units }, after: { units: row.units }, via: "paste", batchId } });
            }
            results.push({ index: c.index, outcome: "updated", id: c.existing!.id });
          }
        } else {
          const id = randomUUID();
          const now = nowIso();
          const responsibleKey = normalizeResponsibleKey(row.responsibleDisplay);
          if (exec) {
            await exec.execute(sql`
              insert into packaging_metrics (id, sector, metric_date, product, units, responsible_display, responsible_key, created_by, created_by_sector, updated_by, created_at, updated_at)
              values (${id}::uuid, ${row.sector}, ${row.metricDate}::date, ${row.product}, ${row.units}, ${row.responsibleDisplay}, ${responsibleKey}, ${actor.email}, ${actor.sector}, ${actor.email}, ${now}::timestamptz, ${now}::timestamptz)
            `);
            await auditMetric(exec, actor, { action: "create", entityId: id, payload: { after: recordSnapshot({ ...row, product: row.product }), via: "paste", batchId } });
          } else {
            mem().metrics.push({
              id, sector: row.sector, metricDate: row.metricDate, product: row.product, units: row.units,
              responsibleDisplay: row.responsibleDisplay, responsibleKey, workItemId: null,
              createdBy: actor.email, createdBySector: actor.sector, updatedBy: actor.email, createdAt: now, updatedAt: now, deletedAt: null,
            });
            await auditMetric(null, actor, { action: "create", entityId: id, payload: { after: recordSnapshot({ ...row, product: row.product }), via: "paste", batchId } });
          }
          results.push({ index: c.index, outcome: "created", id });
        }
      }
      return results;
    };

    if (isDatabaseConfigured() && (await isProcedureMetricsSchemaReady())) {
      const db = getDb();
      return db.transaction(async (tx) => {
        // Idempotencia: el evento del lote se inserta PRIMERO (índice único). Un reintento o una confirmación
        // simultánea espera, no inserta y devuelve el resultado ya guardado.
        const claimed = await tx.execute(sql`
          insert into feature_audit_events (id, domain, action, actor_email, actor_sector, entity_id, idempotency_key, payload, created_at)
          values (${randomUUID()}::uuid, 'metricas', 'import', ${actor.email}, ${String(actor.sector)}, null, ${key}, '{}'::jsonb, now())
          on conflict (idempotency_key) where idempotency_key is not null do nothing
          returning id
        `);
        if ((claimed.rows as unknown[]).length === 0) {
          const prior = await tx.execute(sql`select payload from feature_audit_events where idempotency_key = ${key} limit 1`);
          const payload = ((prior.rows as Record<string, unknown>[])[0]?.payload ?? null) as { result?: MetricImportCommitResult } | null;
          if (payload?.result) return { ...payload.result, idempotentReplay: true };
          throw new MetricsConflictError("Este pegado ya se está procesando. Esperá unos segundos y revisá la tabla.");
        }
        const existingRes = await tx.execute(sql`
          select * from packaging_metrics
          where deleted_at is null
            and metric_date between ${prepared.flatMap((p) => ("row" in p ? [p.row.metricDate] : [])).sort()[0] ?? "1900-01-01"}::date
                              and ${prepared.flatMap((p) => ("row" in p ? [p.row.metricDate] : [])).sort().slice(-1)[0] ?? "1900-01-01"}::date
          for update
        `);
        const existing = (existingRes.rows as Record<string, unknown>[]).map(mapMetric);
        const { classified } = plan(existing);
        const result = finish(await applyRows(tx, classified));
        await tx.execute(sql`
          update feature_audit_events set payload = ${JSON.stringify({ result, rows: prepared.length })}::jsonb
          where idempotency_key = ${key}
        `);
        return result;
      });
    }

    // Demo / pruebas (memoria): mismo contrato.
    const prior = mem().audit.find((e) => e.idempotencyKey === key);
    if (prior) return { ...(prior.payload.result as MetricImportCommitResult), idempotentReplay: true };
    const existing = await this.existingForImport(prepared.flatMap((p) => ("row" in p ? [p.row] : [])));
    const result = finish(await applyRows(null, plan(existing).classified));
    await auditMetric(null, actor, { action: "import", entityId: null, idempotencyKey: key, payload: { result, rows: prepared.length } });
    return result;
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

