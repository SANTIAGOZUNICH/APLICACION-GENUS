import type { EntityPageModel } from "@/types/entity-page";
import type { BandejaDayPulse, BandejaTask } from "@/types/bandeja/bandeja-task";
import type { WorkspaceId } from "@/types/actions";
import type {
  WorkspacePanoramaMetric,
  WorkspaceTask,
} from "@/types/workspace/workspace-task";
import type {
  ConsultaEntityKind,
  ConsultaSearchResponse,
} from "@/types/consulta/consulta-result";
import type { DiscoverySummaryResponse } from "@/types/discovery/discovery.types";
import type { WorkItemsResponse } from "@/types/operational/work-item";
import type { SectorId } from "@/types/operational/sector";
import type { OperationsDiagnostics } from "@/types/operations/operations-diagnostics";

/** JSON-safe entity page (Lucide icons are rehydrated on the client). */
export type EntityPageModelDTO = Omit<EntityPageModel, "identityIcon">;

export type ApiDataSource = "drive" | "drive-partial" | "demo" | "sheets";

export interface LoteBundleResponse {
  loteId: string;
  entityPage: EntityPageModelDTO;
  source: ApiDataSource;
}

export interface LoteListResponse {
  lotes: LoteBundleResponse[];
  source: ApiDataSource;
}

export interface OeBundleResponse {
  lookupKey?: string;
  fileId?: string;
  fileName?: string;
  oeId?: string;
  fields?: import("@/lib/adapters/drive/types/document.types").OeSheetFields;
  entityPage: EntityPageModelDTO;
  source: ApiDataSource;
}

export interface OaBundleResponse {
  lookupKey?: string;
  fileId?: string;
  fileName?: string;
  oaId?: string;
  entityPage: EntityPageModelDTO;
  source: ApiDataSource;
}

export interface PedidoBundleResponse {
  pedidoId: string;
  entityPage: EntityPageModelDTO;
  source: ApiDataSource;
}

export interface LiberacionBundleResponse {
  liberacionId: string;
  loteId?: string;
  entityPage: EntityPageModelDTO;
  source: ApiDataSource;
}

export interface OperationsStateResponse {
  bandejaTasks: BandejaTask[];
  workspaceTasks: Record<WorkspaceId, WorkspaceTask[]>;
  dayPulse: BandejaDayPulse;
  workspacePanorama: Partial<Record<WorkspaceId, WorkspacePanoramaMetric[]>>;
  source: ApiDataSource;
  diagnostics?: OperationsDiagnostics;
  error?: string;
  code?: string;
}

export interface ApiErrorBody {
  error: string;
  code?: string;
}

export class OperationsApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly code?: string
  ) {
    super(message);
    this.name = "OperationsApiError";
  }
}

async function parseJson<T>(response: Response): Promise<T> {
  const body = (await response.json()) as T | ApiErrorBody;
  if (!response.ok) {
    const errorBody = body as ApiErrorBody;
    throw new OperationsApiError(
      errorBody.error || "Error al consultar datos operativos.",
      response.status,
      errorBody.code
    );
  }
  return body as T;
}

export async function fetchLoteList(): Promise<LoteListResponse> {
  const response = await fetch("/api/v1/lotes", {
    method: "GET",
    cache: "no-store",
  });
  return parseJson<LoteListResponse>(response);
}

export async function fetchLoteById(loteId: string): Promise<LoteBundleResponse> {
  const response = await fetch(
    `/api/v1/lotes/${encodeURIComponent(loteId)}`,
    {
      method: "GET",
      cache: "no-store",
    }
  );
  return parseJson<LoteBundleResponse>(response);
}

export async function fetchOeById(lookupKey: string): Promise<OeBundleResponse> {
  const response = await fetch(`/api/v1/oe/${encodeURIComponent(lookupKey)}`, {
    method: "GET",
    cache: "no-store",
  });
  return parseJson<OeBundleResponse>(response);
}

export async function fetchOaById(lookupKey: string): Promise<OaBundleResponse> {
  const response = await fetch(`/api/v1/oa/${encodeURIComponent(lookupKey)}`, {
    method: "GET",
    cache: "no-store",
  });
  return parseJson<OaBundleResponse>(response);
}

export async function fetchPedidoById(
  pedidoId: string
): Promise<PedidoBundleResponse> {
  const response = await fetch(
    `/api/v1/pedidos/${encodeURIComponent(pedidoId)}`,
    {
      method: "GET",
      cache: "no-store",
    }
  );
  return parseJson<PedidoBundleResponse>(response);
}

export async function fetchLiberacionById(
  liberacionId: string
): Promise<LiberacionBundleResponse> {
  const response = await fetch(
    `/api/v1/liberaciones/${encodeURIComponent(liberacionId)}`,
    {
      method: "GET",
      cache: "no-store",
    }
  );
  return parseJson<LiberacionBundleResponse>(response);
}

export async function fetchOperationsState(): Promise<OperationsStateResponse> {
  const response = await fetch("/api/v1/operations/state", {
    method: "GET",
    cache: "no-store",
  });
  return parseJson<OperationsStateResponse>(response);
}

export async function fetchConsulta(
  query: string,
  types?: ConsultaEntityKind[]
): Promise<ConsultaSearchResponse> {
  const params = new URLSearchParams();
  if (query.trim()) {
    params.set("q", query.trim());
  }
  if (types && types.length > 0) {
    params.set("types", types.join(","));
  }

  const response = await fetch(`/api/v1/consulta?${params.toString()}`, {
    method: "GET",
    cache: "no-store",
  });
  return parseJson<ConsultaSearchResponse>(response);
}

export async function fetchDiscoverySummary(): Promise<DiscoverySummaryResponse> {
  const response = await fetch("/api/v1/discovery/summary", {
    method: "GET",
    cache: "no-store",
  });
  return parseJson<DiscoverySummaryResponse>(response);
}

export async function fetchWorkItems(sector: SectorId): Promise<WorkItemsResponse> {
  const params = new URLSearchParams({ sector });
  const response = await fetch(`/api/v1/work-items?${params.toString()}`, {
    method: "GET",
    cache: "no-store",
  });
  return parseJson<WorkItemsResponse>(response);
}

export async function fetchWorkItemsPreview(
  sector: SectorId
): Promise<import("@/types/operational/work-items-preview.types").WorkItemsPreviewResponse> {
  const params = new URLSearchParams({ sector });
  const response = await fetch(`/api/v1/work-items/preview?${params.toString()}`, {
    method: "GET",
    cache: "no-store",
  });
  return parseJson(response);
}

export async function fetchWorkItemsDebug(): Promise<
  import("@/types/operational/work-items-preview.types").WorkItemsDebugResponse
> {
  const response = await fetch("/api/v1/work-items/debug", {
    method: "GET",
    cache: "no-store",
  });
  return parseJson(response);
}

function entityFetchPath(kind: EntityPageModel["kind"], entityId: string) {
  switch (kind) {
    case "oe":
      return fetchOeById(entityId);
    case "oa":
      return fetchOaById(entityId);
    case "lote":
      return fetchLoteById(entityId);
    case "pedido":
      return fetchPedidoById(entityId);
    case "liberacion":
      return fetchLiberacionById(entityId);
  }
}

export async function fetchEntityByKind(
  kind: EntityPageModel["kind"],
  entityId: string
): Promise<{ entityPage: EntityPageModelDTO; source: ApiDataSource }> {
  const response = await entityFetchPath(kind, entityId);
  return {
    entityPage: response.entityPage,
    source: response.source,
  };
}
