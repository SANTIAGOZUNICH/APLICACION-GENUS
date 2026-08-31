import { NextResponse } from "next/server";
import { canUseDriveAdapter } from "@/lib/api/bff-helpers";
import { getServerDataMode } from "@/lib/config/data-mode";
import { isDatabaseConfigured } from "@/lib/db/client";
import {
  countMiTrabajoSections,
  filterWorkItemsByDate,
  filterWorkItemsByWeekStart,
  filterWorkItemsForSectorAndPerson,
} from "@/lib/operational/work-item-filters";
import { workItemsService } from "@/lib/operational/work-items.service";
import { getPlanningService } from "@/lib/planning/get-planning-service";
import {
  projectNativeWorkItems,
  projectQualityItems,
} from "@/lib/planning/native-projector";
import { getPlanningSource } from "@/lib/planning/planning-source";
import { CURRENT_SECTOR_OPTIONS, type CurrentSectorId } from "@/types/operational/sector";
import type { SectorId } from "@/types/operational/sector";

/** Sectores válidos en API /work-items. DEPOSITO pendiente de modelado — PR posterior. */
function parseSector(value: string | null): SectorId | null {
  if (!value) return null;
  const normalized = value.trim().toUpperCase();
  if (CURRENT_SECTOR_OPTIONS.includes(normalized as CurrentSectorId)) {
    return normalized as SectorId;
  }
  return null;
}

function parseIsoDateParam(value: string | null): string | null {
  if (!value?.trim()) return null;
  const v = value.trim();
  return /^\d{4}-\d{2}-\d{2}$/.test(v) ? v : null;
}

async function listNativeWorkItems(
  sector: SectorId,
  ownerPerson: string | null,
  date: string | null,
  weekStart: string | null
) {
  if (!isDatabaseConfigured()) {
    return NextResponse.json(
      {
        sector,
        ownerPerson,
        source: "native" as const,
        scannedAt: new Date().toISOString(),
        workItems: [],
        counts: { total: 0, hoy: 0, semana: 0, pendientes: 0, bloqueados: 0 },
        message: "Producción todavía no publicó una planificación.",
        planningSource: "native",
      },
      { status: 503 }
    );
  }

  // Calidad: cola nativa completa (pendientes/aprobados/rechazados), no
  // depende del sector/rango pedido — necesita ver todo lo completado por
  // cualquier sector productivo, ver AUDIT_TRAZABILIDAD (Calidad en modo
  // nativo devolvía qualityItems: [] siempre).
  //
  // IMPORTANTE (ver AUDIT_TRAZABILIDAD_PROPAGACION): "CALIDAD" nunca es un
  // valor real de work_items.sector (CHECK constraint solo admite
  // ELABORACION/ENVASADO_MASIVO/ENVASADO_PREMIUM/CODIFICADO) — antes
  // `workItems` para este sector salía de listPublishedItems({sector:
  // "CALIDAD", ...}), que no matchea ningún caso de su propio filtro y caía
  // en un fallback SIN condición de sector, ordenado por plannedDate ASC y
  // limitado a 500 filas. En una base con más de 500 trabajos publicados
  // históricos, un trabajo recién completado podía quedar fuera de ese
  // array (los 500 más VIEJOS ganan el límite). Consumidores que buscan el
  // WorkItem completo por id en ese array — CodificadoTracePanel (detalle
  // de Calidad) y remitoGapsFromQuality/resolveWorkItem (remito) — hacían
  // ese find() en silencio, no encontraban el item, y mostraban Lote/VTO/
  // packingGroups/muestras/sobrante vacíos aunque el dato existiera intacto
  // en Neon. Fix: para CALIDAD, workItems y qualityItems salen de la MISMA
  // consulta (listCompletedItems, completedAt IS NOT NULL, ordenada por
  // completedAt DESC — nunca trunca lo recién completado), así que ambos
  // arrays están siempre en sync y nunca pueden desincronizarse entre sí.
  let workItems;
  let qualityItems: ReturnType<typeof projectQualityItems>;
  if (sector === "CALIDAD") {
    const completedRows = await getPlanningService().listCompletedItems({ limit: 500 });
    workItems = projectNativeWorkItems(completedRows);
    qualityItems = projectQualityItems(completedRows);
  } else {
    // Empujar date/weekStart al SQL (evita descargar todos los publicados).
    const rows = await getPlanningService().listPublishedItems({
      sector,
      ownerPerson,
      date,
      weekStart,
    });
    workItems = projectNativeWorkItems(rows);
    workItems = filterWorkItemsForSectorAndPerson(workItems, sector, ownerPerson);
    // Filtro JS residual solo si el repo no aplicó rango (p.ej. memoria).
    if (date) workItems = filterWorkItemsByDate(workItems, date);
    else if (weekStart) workItems = filterWorkItemsByWeekStart(workItems, weekStart);
    qualityItems = [];
  }

  const emptyMessage = date
    ? "Hoy no hay trabajos publicados."
    : weekStart
      ? "Esta semana no hay trabajos publicados."
      : sector === "PRODUCCION" || sector === "DIRECCION"
        ? "Todavía no hay una planificación publicada."
        : sector === "CALIDAD"
          ? "Todavía no hay trabajos para revisar."
          : "Producción todavía no publicó una planificación.";

  return NextResponse.json({
    sector,
    ownerPerson,
    source: "native" as const,
    scannedAt: new Date().toISOString(),
    workItems,
    qualityItems,
    counts: countMiTrabajoSections(workItems),
    message:
      sector === "CALIDAD"
        ? qualityItems.length === 0
          ? emptyMessage
          : undefined
        : workItems.length === 0
          ? emptyMessage
          : undefined,
    planningSource: "native",
  });
}

export async function GET(request: Request) {
  const url = new URL(request.url);
  const sector = parseSector(url.searchParams.get("sector"));
  const ownerPerson = url.searchParams.get("ownerPerson")?.trim() || null;
  const date = parseIsoDateParam(url.searchParams.get("date"));
  const weekStart = parseIsoDateParam(url.searchParams.get("weekStart"));

  if (!sector) {
    return NextResponse.json(
      {
        error: "Parámetro sector requerido.",
        code: "SECTOR_REQUIRED",
        allowed: CURRENT_SECTOR_OPTIONS,
      },
      { status: 400 }
    );
  }

  const planningSource = getPlanningSource();

  if (planningSource === "native") {
    try {
      return await listNativeWorkItems(sector, ownerPerson, date, weekStart);
    } catch (error) {
      return NextResponse.json(
        {
          sector,
          source: "native" as const,
          scannedAt: new Date().toISOString(),
          workItems: [],
          counts: { total: 0, hoy: 0, semana: 0, pendientes: 0, bloqueados: 0 },
          error: error instanceof Error ? error.message : "Error planificación nativa.",
          code: "NATIVE_WORK_ITEMS_FAILED",
          planningSource: "native",
        },
        { status: 502 }
      );
    }
  }

  // SHEETS — flujo legacy intacto
  if (getServerDataMode() !== "real" || !canUseDriveAdapter()) {
    return NextResponse.json({
      sector,
      ownerPerson,
      source: "demo" as const,
      scannedAt: new Date().toISOString(),
      workItems: [],
      counts: { total: 0, hoy: 0, semana: 0, pendientes: 0, bloqueados: 0 },
      planningSource: "sheets",
      message:
        getServerDataMode() !== "real"
          ? "Modo demo — WorkItems reales requieren GENUS_DATA_MODE=real."
          : "Drive no configurado — sin WorkItems inventados.",
    });
  }

  try {
    const response = await workItemsService.listForSector(sector, {
      ownerPerson,
      date,
      weekStart: date ? null : weekStart,
    });
    const syncStatus = workItemsService.getSyncStatus();
    return NextResponse.json(
      { ...response, planningSource: "sheets" },
      {
        headers: {
          "X-Live-Sync-Revision": String(syncStatus.revision),
          "X-Live-Sync-Updated-At": syncStatus.updatedAt,
        },
      }
    );
  } catch (error) {
    return NextResponse.json(
      {
        sector,
        source: "drive" as const,
        scannedAt: new Date().toISOString(),
        workItems: [],
        counts: { total: 0, hoy: 0, semana: 0, pendientes: 0, bloqueados: 0 },
        error: error instanceof Error ? error.message : "Error al cargar WorkItems.",
        code: "WORK_ITEMS_FAILED",
        planningSource: "sheets",
      },
      { status: 502 }
    );
  }
}
