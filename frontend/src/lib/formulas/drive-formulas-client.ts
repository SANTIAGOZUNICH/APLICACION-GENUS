import type { WorkFormulaInfo } from "./work-formula-info";

/** Cliente HTTP (navegador) de la carpeta nueva de fórmulas. Los errores del servidor ya vienen explicados en castellano. */
async function call<T>(url: string, init?: RequestInit): Promise<T> {
  let res: Response;
  try {
    res = await fetch(url, { credentials: "include", cache: "no-store", ...init, headers: { "content-type": "application/json", ...(init?.headers ?? {}) } });
  } catch {
    throw new Error("Sin conexión con el servidor. Revisá la conexión y volvé a intentar.");
  }
  const body = (await res.json().catch(() => ({}))) as T & { error?: string; result?: { error?: string } };
  if (!res.ok) throw new Error(body.error ?? body.result?.error ?? `No se pudo completar la operación (${res.status}).`);
  return body;
}

export type FormulaLinkResponse = {
  link: { id: string; fileId: string; fileName: string };
  oe: { status: string; message?: string; orderNumber?: string } | null;
};

export const driveFormulasApi = {
  workInfo: (workItemId: string) => call<WorkFormulaInfo>(`/api/v1/formulas/work/${workItemId}`),
  link: (body: { client: string; product: string; fileId: string; note?: string; workItemId?: string }) =>
    call<FormulaLinkResponse>("/api/v1/formulas/drive-links", { method: "POST", body: JSON.stringify(body) }),
  unlink: (id: string, reason: string) => call<{ ok: true }>(`/api/v1/formulas/drive-links?id=${encodeURIComponent(id)}&reason=${encodeURIComponent(reason)}`, { method: "DELETE" }),
  sync: () => call<{ result: { ok: boolean; fileCount?: number; clientCount?: number; added?: number; removed?: number; error?: string } }>("/api/v1/formulas/drive-index", { method: "POST" }),
  /** Vuelve a preparar la OE del trabajo si quedó con la fórmula pendiente (no reemplaza una fórmula cargada). */
  retryOe: (workItemId: string) =>
    call<{ pending: { checked: number; resolved: number; orderNumbers: string[] }; info: WorkFormulaInfo }>(`/api/v1/formulas/work/${workItemId}`, { method: "POST" }),
  downloadUrl: (fileId: string) => `/api/v1/formulas/drive-file/${encodeURIComponent(fileId)}`,
};
