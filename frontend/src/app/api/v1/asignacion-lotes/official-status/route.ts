import { NextResponse } from "next/server";
import { getAsignacionLoteSourcesService } from "@/lib/asignacion-lotes/asignacion-lote-sources-service";
import { listSyncRuns } from "@/lib/asignacion-lotes/asignacion-lotes-sync-service";
import { OFFICIAL_ASIGNACION_LOTES_SPREADSHEETS } from "@/lib/asignacion-lotes/official-sources";
import { canAccessAsignacionLotes } from "@/features/os/operational/lib/asignacion-lotes-rbac";
import { resolveOrdersActor } from "@/lib/orders/actor";
import { ordersErrorResponse } from "@/lib/orders/http";
import { OrdersForbiddenError } from "@/lib/orders/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export interface OfficialSourceStatus {
  year: string;
  name: string;
  spreadsheetId: string;
  connected: boolean;
  enabled: boolean;
  syncStatus: string;
  lastSyncAt: string | null;
  lastSuccessfulSyncAt: string | null;
  lastError: string | null;
  lastRun: {
    status: string;
    rowsRead: number;
    sheetsTotal: number | null;
    ignoredTabsCount: number;
  } | null;
}

/**
 * Estado de sincronización de las DOS fuentes oficiales (2025/2026, ver
 * official-sources.ts) — sección 12 del pedido: "no necesito + Conectar
 * planilla para la operación normal", pero sí un estado simple, visible
 * para cualquier sector con acceso a Asignación de Lotes (no solo
 * Producción/Dirección, que son los únicos que ven la pantalla avanzada de
 * fuentes). Solo lectura — nunca dispara una sincronización.
 */
export async function GET(request: Request) {
  try {
    const actor = await resolveOrdersActor(request);
    if (!canAccessAsignacionLotes(actor.sector)) {
      throw new OrdersForbiddenError("Asignación de Lotes está habilitado solo para Calidad, Producción y Codificado.");
    }

    const sourcesService = getAsignacionLoteSourcesService();
    const all = await sourcesService.listAllForSync();

    const sources: OfficialSourceStatus[] = [];
    for (const official of OFFICIAL_ASIGNACION_LOTES_SPREADSHEETS) {
      const match = all.find((s) => s.spreadsheetId === official.spreadsheetId && !s.sheetTab);
      let lastRun: OfficialSourceStatus["lastRun"] = null;
      if (match) {
        const [run] = await listSyncRuns(match.id, 1);
        if (run) {
          lastRun = {
            status: run.status,
            rowsRead: run.rowsRead,
            sheetsTotal: run.sheetsTotal ?? null,
            ignoredTabsCount: run.ignoredTabs?.length ?? 0,
          };
        }
      }
      sources.push({
        year: official.year,
        name: official.name,
        spreadsheetId: official.spreadsheetId,
        connected: Boolean(match),
        enabled: match?.enabled ?? false,
        syncStatus: match?.syncStatus ?? "nunca_sincronizado",
        lastSyncAt: match?.lastSyncAt ?? null,
        lastSuccessfulSyncAt: match?.lastSuccessfulSyncAt ?? null,
        lastError: match?.lastError ?? null,
        lastRun,
      });
    }

    return NextResponse.json({ sources, syncFrequencyMinutes: 10 });
  } catch (err) {
    return ordersErrorResponse(err);
  }
}
