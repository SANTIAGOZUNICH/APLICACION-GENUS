import "server-only";

import { operationsDocumentRepository } from "@/lib/adapters/drive/operations-document-repository";
import type { CriticalSheetKey } from "@/lib/adapters/drive/drive-folder-config";
import { serverCache } from "@/lib/adapters/drive/cache/server-cache";
import { loadOperationalPipeline } from "@/lib/parsers/load-operational-pipeline";
import { operationalEventBus } from "@/lib/live-sync/operational-event-bus";
import { liveSyncStore } from "@/lib/live-sync/live-sync-store";
import { serverOperationalState } from "@/lib/live-sync/server-operational-state";
import {
  getLiveSyncCheckMetrics,
  getRememberedSheetHash,
  getSemanasVersion,
  invalidateSemanasVersionCache,
  rememberSheetHash,
  recordHashComparison,
  recordParseDuration,
} from "@/lib/live-sync/operational-sheets-watcher";
import type { LiveSyncSnapshot, LiveSyncStatus } from "@/lib/live-sync/types";
import {
  filterWorkItemsForSectorAndPerson,
  filterWorkItemsForSector,
  filterWorkItemsByDate,
  filterWorkItemsByWeekStart,
  countMiTrabajoSections,
} from "@/lib/operational/work-item-filters";
import { buildProductionOverview } from "@/lib/operational/build-production-overview";
import { getServerDataMode } from "@/lib/config/data-mode";
import type { SectorId } from "@/types/operational/sector";
import type { WorkItemsResponse } from "@/types/operational/work-item";

const CRITICAL_SHEETS: CriticalSheetKey[] = [
  "semanas_2026",
  "pedidos_2026",
  "asignacion_lotes_2026",
];

/** Última versión SEMANAS ya aplicada al snapshot de esta instancia. */
let lastAppliedSemanasVersion: string | null = null;
let ensureAppliedInFlight: Promise<{
  version: string;
  revision?: number;
  checkedAt: string;
}> | null = null;

export interface LiveSyncCheckResponse {
  changed: boolean;
  version: string;
  revision?: number;
  checkedAt: string;
  metrics: ReturnType<typeof getLiveSyncCheckMetrics>;
}

function invalidateSpreadsheetCache(spreadsheetId: string): void {
  serverCache.deleteByPrefix(`sheet:${spreadsheetId}:`);
}

async function rebuildSnapshot(
  reason: string,
  options?: { semanasVersion?: string }
): Promise<LiveSyncSnapshot | null> {
  const existing = liveSyncStore.getSyncInFlight();
  if (existing) return existing;

  const promise = (async () => {
    const parseStarted = Date.now();
    try {
      const pipeline = await loadOperationalPipeline();
      recordParseDuration(Date.now() - parseStarted);

      if (
        pipeline.workItems.length === 0 &&
        !pipeline.sourcesIndexed.semanas_2026
      ) {
        return liveSyncStore.getSnapshot();
      }

      const snapshot: LiveSyncSnapshot = {
        revision: (liveSyncStore.getSnapshot()?.revision ?? 0) + 1,
        updatedAt: new Date().toISOString(),
        sheetsSyncedAt: new Date().toISOString(),
        workItems: pipeline.workItems,
        qualityItems: pipeline.qualityItems,
        warnings: pipeline.warnings,
        sourcesIndexed: pipeline.sourcesIndexed,
      };

      liveSyncStore.setSnapshot(snapshot);

      if (options?.semanasVersion) {
        rememberSheetHash("semanas_2026", options.semanasVersion);
        lastAppliedSemanasVersion = options.semanasVersion;
      }

      operationalEventBus.publish({
        type: "snapshot.updated",
        revision: snapshot.revision,
        at: snapshot.updatedAt,
        sectors: [
          "ENVASADO_MASIVO",
          "ENVASADO_PREMIUM",
          "ELABORACION",
          "CALIDAD",
          "PRODUCCION",
          "DIRECCION",
        ],
        totalWorkItems: snapshot.workItems.length,
      });

      if (process.env.NODE_ENV !== "production") {
        console.info(`[live-sync] snapshot rebuilt (${reason}) — ${snapshot.workItems.length} items`);
      }

      return snapshot;
    } catch (err) {
      if (process.env.NODE_ENV !== "production") {
        console.warn("[live-sync] rebuild failed:", err);
      }
      return liveSyncStore.getSnapshot();
    } finally {
      liveSyncStore.setSyncInFlight(null);
    }
  })();

  liveSyncStore.setSyncInFlight(promise);
  return promise;
}

function applyOperationalOverlay(snapshot: LiveSyncSnapshot): LiveSyncSnapshot {
  return {
    ...snapshot,
    workItems: serverOperationalState.applyToWorkItems(snapshot.workItems),
    qualityItems: serverOperationalState.mergeCompletions(
      serverOperationalState.applyToQualityItems(snapshot.qualityItems)
    ),
  };
}

export interface ListForSectorOptions {
  ownerPerson?: string | null;
  date?: string | null;
  weekStart?: string | null;
}

/**
 * Live Sync Engine — request-driven para Sheet→app.
 * Genus OS → otros usuarios sigue por operaciones + SSE.
 * No hay setInterval server-side permanente.
 */
export class LiveSyncEngine {
  /**
   * Check liviano idempotente:
   * - lee hash SEMANAS (dedupe / cache 2s en el watcher);
   * - si knownVersion === hash → sin rebuild;
   * - si cambió → invalidar, parsear, snapshot, SSE;
   * - `changed` se deriva por caller según knownVersion.
   */
  async check(knownVersion?: string | null): Promise<LiveSyncCheckResponse> {
    const known = knownVersion?.trim() || null;
    const detection = await getSemanasVersion();

    if (known && known === detection.version) {
      recordHashComparison(false);
      if (!liveSyncStore.getSnapshot()) {
        await this.ensureSemanasSnapshotApplied(detection);
      } else if (!lastAppliedSemanasVersion) {
        lastAppliedSemanasVersion = detection.version;
        rememberSheetHash("semanas_2026", detection.version);
      }
      return {
        changed: false,
        version: detection.version,
        revision: liveSyncStore.getSnapshot()?.revision,
        checkedAt: detection.sampledAt,
        metrics: getLiveSyncCheckMetrics(),
      };
    }

    const state = await this.ensureSemanasSnapshotApplied(detection);
    const changed = Boolean(known) && known !== state.version;
    if (known) recordHashComparison(changed);

    return {
      changed,
      version: state.version,
      revision: state.revision,
      checkedAt: state.checkedAt,
      metrics: getLiveSyncCheckMetrics(),
    };
  }

  private async ensureSemanasSnapshotApplied(
    prefetched?: Awaited<ReturnType<typeof getSemanasVersion>>
  ): Promise<{
    version: string;
    revision?: number;
    checkedAt: string;
  }> {
    if (ensureAppliedInFlight) return ensureAppliedInFlight;

    ensureAppliedInFlight = (async () => {
      const detection = prefetched ?? (await getSemanasVersion());
      const snapshot = liveSyncStore.getSnapshot();
      const applied =
        lastAppliedSemanasVersion ?? getRememberedSheetHash("semanas_2026") ?? null;

      if (snapshot && applied === detection.version) {
        return {
          version: detection.version,
          revision: snapshot.revision,
          checkedAt: detection.sampledAt,
        };
      }

      invalidateSemanasVersionCache();
      invalidateSpreadsheetCache(detection.spreadsheetId);

      const rebuilt = await rebuildSnapshot("live-sync-check", {
        semanasVersion: detection.version,
      });

      return {
        version: detection.version,
        revision: rebuilt?.revision ?? liveSyncStore.getSnapshot()?.revision,
        checkedAt: new Date().toISOString(),
      };
    })().finally(() => {
      ensureAppliedInFlight = null;
    });

    return ensureAppliedInFlight;
  }

  /** Lectura caliente — no dispara detección Sheets en background. */
  async getSnapshot(): Promise<LiveSyncSnapshot | null> {
    const cached = liveSyncStore.getSnapshot();
    if (cached) {
      void operationsDocumentRepository.ensureOperationalReady();
      return applyOperationalOverlay(cached);
    }

    await operationsDocumentRepository.ensureOperationalReady();
    void rebuildSnapshot("cold-start");
    return null;
  }

  async warmSnapshot(): Promise<LiveSyncSnapshot | null> {
    await operationsDocumentRepository.ensureOperationalReady();
    const cached = liveSyncStore.getSnapshot();
    if (cached) return applyOperationalOverlay(cached);
    return rebuildSnapshot("warm");
  }

  async listForSector(
    sector: SectorId,
    ownerPersonOrOptions?: string | null | ListForSectorOptions
  ): Promise<WorkItemsResponse> {
    const options: ListForSectorOptions =
      typeof ownerPersonOrOptions === "object" && ownerPersonOrOptions !== null
        ? ownerPersonOrOptions
        : { ownerPerson: ownerPersonOrOptions ?? null };

    const ownerPerson = options.ownerPerson ?? null;
    let snapshot = await this.getSnapshot();

    if (!snapshot) {
      snapshot = await this.warmSnapshot();
    }

    if (!snapshot) {
      return {
        sector,
        ownerPerson,
        source: "drive",
        scannedAt: new Date().toISOString(),
        workItems: [],
        qualityItems: [],
        counts: { total: 0, hoy: 0, semana: 0, pendientes: 0, bloqueados: 0 },
        message: "Inicializando Live Sync — reintentá en unos segundos.",
        warnings: [],
      };
    }

    let filtered = filterWorkItemsForSectorAndPerson(
      snapshot.workItems,
      sector,
      ownerPerson
    );

    if (options.date) {
      filtered = filterWorkItemsByDate(filtered, options.date);
    } else if (options.weekStart) {
      filtered = filterWorkItemsByWeekStart(filtered, options.weekStart);
    }

    const calidadItems = sector === "CALIDAD" ? snapshot.qualityItems : [];
    const overlay = serverOperationalState.snapshot();
    const workItemsWithOverlay = serverOperationalState.applyToWorkItems(filtered);
    const backgroundSyncing = operationsDocumentRepository.isBackgroundIndexInFlight();

    return {
      sector,
      ownerPerson,
      source: "drive",
      scannedAt: snapshot.sheetsSyncedAt ?? snapshot.updatedAt,
      workItems: workItemsWithOverlay,
      qualityItems: calidadItems,
      counts: countMiTrabajoSections(workItemsWithOverlay),
      warnings: snapshot.warnings.slice(0, 10),
      operationalOverlay: {
        revision: overlay.revision,
        progress: overlay.progress,
        decisions: overlay.decisions,
        completions: overlay.completions,
      },
      message: backgroundSyncing
        ? "Sincronizando — mostrando último snapshot disponible."
        : filtered.length > 0
          ? sector === "PRODUCCION"
            ? `${filtered.length} WorkItem(s) agregados (Live Sync).`
            : `${filtered.length} WorkItem(s) para ${sector}${ownerPerson ? ` · ${ownerPerson}` : ""}.`
          : options.date
            ? "No hay trabajos planificados para este día."
            : sector === "PRODUCCION"
              ? "Sin operación agregada — verificar SEMANAS indexado."
              : `Sin trabajos para ${sector}${ownerPerson ? ` · ${ownerPerson}` : ""}.`,
    };
  }

  getStatus(): LiveSyncStatus {
    const snapshot = liveSyncStore.getSnapshot();
    return {
      revision: snapshot?.revision ?? 0,
      updatedAt: snapshot?.updatedAt ?? new Date(0).toISOString(),
      sheetsSyncedAt: snapshot?.sheetsSyncedAt ?? null,
      subscribers: operationalEventBus.subscriberCount,
      snapshotReady: liveSyncStore.isReady(),
      workItemCount: snapshot?.workItems.length ?? 0,
      backgroundSyncing: operationsDocumentRepository.isBackgroundIndexInFlight(),
    };
  }

  async forceRefresh(): Promise<LiveSyncSnapshot | null> {
    for (const key of CRITICAL_SHEETS) {
      const ref = await operationsDocumentRepository.tryGetCriticalSheetRef(key);
      if (ref) invalidateSpreadsheetCache(ref.fileId);
    }
    invalidateSemanasVersionCache();
    lastAppliedSemanasVersion = null;
    return rebuildSnapshot("manual");
  }
}

export const liveSyncEngine = new LiveSyncEngine();

if (getServerDataMode() === "real") {
  void liveSyncEngine.warmSnapshot();
}

export function getProductionOverviewFromSnapshot() {
  const snapshot = liveSyncStore.getSnapshot();
  if (!snapshot) return null;
  const items = filterWorkItemsForSector(snapshot.workItems, "PRODUCCION");
  const overview = buildProductionOverview(items);
  overview.warnings = snapshot.warnings.slice(0, 10);
  return overview;
}

/** Solo tests. */
export function resetLiveSyncEngineCheckStateForTests(): void {
  lastAppliedSemanasVersion = null;
  ensureAppliedInFlight = null;
}
