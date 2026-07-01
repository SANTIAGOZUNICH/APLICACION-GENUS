import type { EntityPageModel } from "@/types/entity-page";

/** JSON-safe entity page (Lucide icons are rehydrated on the client). */
export type EntityPageModelDTO = Omit<EntityPageModel, "identityIcon">;

export interface LoteBundleResponse {
  loteId: string;
  entityPage: EntityPageModelDTO;
  source: "sheets" | "demo";
}

export interface LoteListResponse {
  lotes: LoteBundleResponse[];
  source: "sheets" | "demo";
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
