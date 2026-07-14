import "server-only";

import { operationsDocumentRepository } from "@/lib/adapters/drive/operations-document-repository";
import type { CriticalSheetKey } from "@/lib/adapters/drive/drive-folder-config";
import { serverCache } from "@/lib/adapters/drive/cache/server-cache";
import { loadOperationalPipeline } from "@/lib/parsers/load-operational-pipeline";
import { operationalEventBus } from "@/lib/live-sync/operational-event-bus";
import { liveSyncStore } from "@/lib/live-sync/live-sync-store";
import { serverOperationalState } from "@/lib/live-sync/server-operational-state";
import {
  parseSemanasTabsToWorkItems,
  projectWorkItemsForCheck,
} from "@/lib/live-sync/load-semanas-hot-path";
import {
  getLiveSyncCheckMetrics,
  getRememberedSheetHash,
  getSemanasVersion,
  rememberSheetHash,
  recordHashComparison,
  recordParseDuration,
  recordProjectDuration,
  recordTotalCheckDuration,
  type SemanasVersionResult,
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
import type { WorkItem, WorkItemsResponse } from "@/types/operational/work-item";

const CRITICAL_SHEETS: CriticalSheetKey[] = [
  "semanas_2026",
  "pedidos_2026",
  "asignacion_lotes_2026",
];

/** Última versión SEMANAS ya aplicada (hot path) en esta instancia. */
let lastAppliedSemanasVersion: string | null = null;
/** WorkItems SEMANAS parseados para la versión aplicada (sin Pedidos/Lotes). */
let hotSemanasItems: WorkItem[] = [];
let hotParseInFlight: Promise<{
  version: string;
  revision: number;
  items: WorkItem[];
  parseDurationMs: number;
}> | null = null;

export interface LiveSyncCheckRequest {
  knownVersion?: string | null;
  sector: SectorId;
  ownerPerson?: string | null;
  date?: string | null;
  weekStart?: string | null;
}

export interface LiveSyncCheckResponse {
  changed: boolean;
  version: string;
  revision: number;
  checkedAt: string;
  workItems?: WorkItem[];
  counts?: ReturnType<typeof countMiTrabajoSections>;
  metrics: ReturnType<typeof getLiveSyncCheckMetrics> & {
    readDurationMs?: number | null;
    hashDurationMs?: number | null;
    parseDurationMs?: number | null;
    projectDurationMs?: number | null;
    totalDurationMs?: number | null;
  };
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

function bumpRevisionFromHotParse(version: string, items: WorkItem[]): number {
  const prev = liveSyncStore.getSnapshot();
  const revision = (prev?.revision ?? 0) + 1;
  const updatedAt = new Date().toISOString();

  // Snapshot es optimización: merge SEMANAS por id; conserva quality/others si existen.
  const byId = new Map((prev?.workItems ?? []).map((item) => [item.id, item]));
  for (const item of items) {
    byId.set(item.id, item);
  }

  const snapshot: LiveSyncSnapshot = {
    revision,
    updatedAt,
    sheetsSyncedAt: updatedAt,
    workItems: Array.from(byId.values()),
    qualityItems: prev?.qualityItems ?? [],
    warnings: prev?.warnings ?? [],
    sourcesIndexed: {
      semanas_2026: true,
      pedidos_2026: prev?.sourcesIndexed.pedidos_2026 ?? false,
      asignacion_lotes_2026: prev?.sourcesIndexed.asignacion_lotes_2026 ?? false,
    },
  };

  liveSyncStore.setSnapshot(snapshot);
  rememberSheetHash("semanas_2026", version);
  lastAppliedSemanasVersion = version;
  hotSemanasItems = items;

  operationalEventBus.publish({
    type: "snapshot.updated",
    revision,
    at: updatedAt,
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

  return revision;
}

async function ensureHotSemanasParsed(detection: SemanasVersionResult): Promise<{
  version: string;
  revision: number;
  items: WorkItem[];
  parseDurationMs: number;
}> {
  if (
    lastAppliedSemanasVersion === detection.version &&
    hotSemanasItems.length > 0
  ) {
    return {
      version: detection.version,
      revision: liveSyncStore.getSnapshot()?.revision ?? 0,
      items: hotSemanasItems,
      parseDurationMs: 0,
    };
  }

  if (hotParseInFlight) return hotParseInFlight;

  hotParseInFlight = (async () => {
    if (!detection.tabs.length) {
      throw new Error("SEMANAS batchGet sin pestañas operativas.");
    }

    const parsed = parseSemanasTabsToWorkItems(
      detection.spreadsheetId,
      detection.tabs
    );
    recordParseDuration(parsed.parseDurationMs);

    const revision = bumpRevisionFromHotParse(detection.version, parsed.workItems);

    if (process.env.NODE_ENV !== "production") {
      console.info(
        `[live-sync] hot SEMANAS parse — ${parsed.workItems.length} items in ${parsed.parseDurationMs}ms`
      );
    }

    return {
      version: detection.version,
      revision,
      items: parsed.workItems,
      parseDurationMs: parsed.parseDurationMs,
    };
  })().finally(() => {
    hotParseInFlight = null;
  });

  return hotParseInFlight;
}

export interface ListForSectorOptions {
  ownerPerson?: string | null;
  date?: string | null;
  weekStart?: string | null;
}

/**
 * Live Sync Engine — request-driven para Sheet→app.
 * /check es autoritativo: detecta + parse SEMANAS + proyección en la misma request.
 */
export class LiveSyncEngine {
  async check(request: LiveSyncCheckRequest): Promise<LiveSyncCheckResponse> {
    const totalStarted = Date.now();
    const known = request.knownVersion?.trim() || null;
    const detection = await getSemanasVersion();

    if (known && known === detection.version) {
      recordHashComparison(false);
      if (!lastAppliedSemanasVersion) {
        lastAppliedSemanasVersion = detection.version;
        rememberSheetHash("semanas_2026", detection.version);
      }
      const totalDurationMs = Date.now() - totalStarted;
      recordTotalCheckDuration(totalDurationMs);
      return {
        changed: false,
        version: detection.version,
        revision: liveSyncStore.getSnapshot()?.revision ?? 0,
        checkedAt: detection.sampledAt,
        metrics: {
          ...getLiveSyncCheckMetrics(),
          readDurationMs: detection.readDurationMs,
          hashDurationMs: detection.hashDurationMs,
          parseDurationMs: 0,
          projectDurationMs: 0,
          totalDurationMs,
        },
      };
    }

    const hot = await ensureHotSemanasParsed(detection);
    const projection = projectWorkItemsForCheck(hot.items, {
      sector: request.sector,
      ownerPerson: request.ownerPerson,
      date: request.date,
      weekStart: request.weekStart,
    });
    recordProjectDuration(projection.projectDurationMs);

    const changed = Boolean(known) && known !== hot.version;
    if (known) recordHashComparison(changed);

    const totalDurationMs = Date.now() - totalStarted;
    recordTotalCheckDuration(totalDurationMs);

    return {
      changed,
      version: hot.version,
      revision: hot.revision,
      checkedAt: new Date().toISOString(),
      workItems: changed || !known ? projection.workItems : undefined,
      counts: changed || !known ? projection.counts : undefined,
      metrics: {
        ...getLiveSyncCheckMetrics(),
        readDurationMs: detection.readDurationMs,
        hashDurationMs: detection.hashDurationMs,
        parseDurationMs: hot.parseDurationMs,
        projectDurationMs: projection.projectDurationMs,
        totalDurationMs,
      },
    };
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
        revision: 0,
        semanasVersion: lastAppliedSemanasVersion,
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
      revision: snapshot.revision,
      semanasVersion:
        lastAppliedSemanasVersion ?? getRememberedSheetHash("semanas_2026") ?? null,
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
    lastAppliedSemanasVersion = null;
    hotSemanasItems = [];
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
  hotSemanasItems = [];
  hotParseInFlight = null;
}
