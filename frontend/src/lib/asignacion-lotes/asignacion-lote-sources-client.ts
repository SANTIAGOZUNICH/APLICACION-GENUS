import { ACTOR_EMAIL_HEADER, ACTOR_SECTOR_HEADER } from "@/lib/auth/header-names";
import type { OrdersClientSession } from "@/lib/orders/orders-client";
import type {
  AsignacionLoteSource,
  AsignacionLoteSourceInput,
  AsignacionLoteSourceUpdateInput,
  ImportPreviewResult,
  SyncRunSummary,
  TestConnectionResult,
} from "@/lib/asignacion-lotes/source-types";

function headers(session: OrdersClientSession): HeadersInit {
  return {
    "Content-Type": "application/json",
    [ACTOR_EMAIL_HEADER]: session.email,
    [ACTOR_SECTOR_HEADER]: session.sector,
  };
}

async function readJsonOrThrow<T>(res: Response, fallbackError: string): Promise<T> {
  const body = (await res.json().catch(() => ({}))) as T & { error?: string };
  if (!res.ok) throw new Error(body.error ?? fallbackError);
  return body;
}

export async function fetchAsignacionLoteSourcesApi(
  session: OrdersClientSession
): Promise<AsignacionLoteSource[]> {
  const res = await fetch("/api/v1/asignacion-lotes/sources", { credentials: "include", headers: headers(session) });
  const body = await readJsonOrThrow<{ sources: AsignacionLoteSource[] }>(res, "No se pudieron cargar las fuentes.");
  return body.sources;
}

export async function createAsignacionLoteSourceApi(
  session: OrdersClientSession,
  input: AsignacionLoteSourceInput
): Promise<AsignacionLoteSource> {
  const res = await fetch("/api/v1/asignacion-lotes/sources", {
    method: "POST",
    credentials: "include",
    headers: headers(session),
    body: JSON.stringify(input),
  });
  const body = await readJsonOrThrow<{ source: AsignacionLoteSource }>(res, "No se pudo conectar la planilla.");
  return body.source;
}

export async function updateAsignacionLoteSourceApi(
  session: OrdersClientSession,
  id: string,
  input: AsignacionLoteSourceUpdateInput
): Promise<AsignacionLoteSource> {
  const res = await fetch(`/api/v1/asignacion-lotes/sources/${id}`, {
    method: "PATCH",
    credentials: "include",
    headers: headers(session),
    body: JSON.stringify(input),
  });
  const body = await readJsonOrThrow<{ source: AsignacionLoteSource }>(res, "No se pudo actualizar la fuente.");
  return body.source;
}

export async function testAsignacionLoteSourceConnectionApi(
  session: OrdersClientSession,
  spreadsheetUrlOrId: string,
  sheetTab?: string
): Promise<TestConnectionResult> {
  const res = await fetch("/api/v1/asignacion-lotes/sources/test-connection", {
    method: "POST",
    credentials: "include",
    headers: headers(session),
    body: JSON.stringify({ spreadsheetUrlOrId, sheetTab }),
  });
  return readJsonOrThrow<TestConnectionResult>(res, "No se pudo probar la conexión.");
}

export async function previewAsignacionLoteImportApi(
  session: OrdersClientSession,
  spreadsheetUrlOrId: string,
  sheetTab: string
): Promise<ImportPreviewResult> {
  const res = await fetch("/api/v1/asignacion-lotes/sources/preview-import", {
    method: "POST",
    credentials: "include",
    headers: headers(session),
    body: JSON.stringify({ spreadsheetUrlOrId, sheetTab }),
  });
  return readJsonOrThrow<ImportPreviewResult>(res, "No se pudo calcular la vista previa de importación.");
}

export async function syncAsignacionLoteSourceNowApi(
  session: OrdersClientSession,
  id: string
): Promise<SyncRunSummary> {
  const res = await fetch(`/api/v1/asignacion-lotes/sources/${id}/sync`, {
    method: "POST",
    credentials: "include",
    headers: headers(session),
  });
  const body = await readJsonOrThrow<{ run: SyncRunSummary }>(res, "No se pudo sincronizar.");
  return body.run;
}

export interface OfficialAsignacionLotesStatus {
  sources: Array<{
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
  }>;
  syncFrequencyMinutes: number;
}

/** Solo lectura — visible para cualquier sector con acceso a Asignación de Lotes (sección 12 del pedido). */
export async function fetchOfficialAsignacionLotesStatusApi(
  session: OrdersClientSession
): Promise<OfficialAsignacionLotesStatus> {
  const res = await fetch("/api/v1/asignacion-lotes/official-status", {
    credentials: "include",
    headers: headers(session),
  });
  return readJsonOrThrow<OfficialAsignacionLotesStatus>(res, "No se pudo cargar el estado de sincronización.");
}

export async function fetchAsignacionLoteSourceRunsApi(
  session: OrdersClientSession,
  id: string
): Promise<SyncRunSummary[]> {
  const res = await fetch(`/api/v1/asignacion-lotes/sources/${id}/runs`, {
    credentials: "include",
    headers: headers(session),
  });
  const body = await readJsonOrThrow<{ runs: SyncRunSummary[] }>(res, "No se pudo cargar el historial.");
  return body.runs;
}
