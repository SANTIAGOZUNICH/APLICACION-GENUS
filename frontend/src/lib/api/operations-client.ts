import type { EntityPageModel } from "@/types/entity-page";
import type { WorkItemsResponse } from "@/types/operational/work-item";
import type { SectorId } from "@/types/operational/sector";
import type {
  WorkItemsDebugResponse,
  WorkItemsPreviewResponse,
} from "@/types/operational/work-items-preview.types";

/** JSON-safe entity page (Lucide icons are rehydrated on the client). */
export type EntityPageModelDTO = Omit<EntityPageModel, "identityIcon">;

export interface LoteBundleResponse {
  loteId: string;
  entityPage: EntityPageModelDTO;
  source: "drive" | "demo" | "sheets";
}

export interface LoteListResponse {
  lotes: LoteBundleResponse[];
  source: "drive" | "demo" | "sheets";
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

export async function fetchWorkItems(
  sector: SectorId,
  options?: { ownerPerson?: string | null }
): Promise<WorkItemsResponse> {
  const params = new URLSearchParams({ sector });
  if (options?.ownerPerson?.trim()) {
    params.set("ownerPerson", options.ownerPerson.trim());
  }
  const response = await fetch(`/api/v1/work-items?${params.toString()}`, {
    method: "GET",
    cache: "no-store",
  });
  return parseJson<WorkItemsResponse>(response);
}

export async function fetchWorkItemsPreview(
  sector: SectorId
): Promise<WorkItemsPreviewResponse> {
  const params = new URLSearchParams({ sector });
  const response = await fetch(`/api/v1/work-items/preview?${params.toString()}`, {
    method: "GET",
    cache: "no-store",
  });
  return parseJson<WorkItemsPreviewResponse>(response);
}

export async function fetchWorkItemsDebug(): Promise<WorkItemsDebugResponse> {
  const response = await fetch("/api/v1/work-items/debug", {
    method: "GET",
    cache: "no-store",
  });
  return parseJson<WorkItemsDebugResponse>(response);
}
