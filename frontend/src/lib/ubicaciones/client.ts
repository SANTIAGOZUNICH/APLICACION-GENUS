/** Cliente de navegador — Ubicaciones. La identidad la resuelve el servidor por la cookie de sesión. */
import type { IngresoPendiente, IngresoReview, MapView, MaterialOption, MovementView, OpResultView, UbicacionView, ShapeView } from "./types";

const BASE = "/api/v1/ubicaciones";

export class UbicacionesApiError extends Error {
  constructor(message: string, readonly status: number, readonly code: string) {
    super(message);
  }
}

async function call<T>(path: string, init?: RequestInit): Promise<T> {
  let res: Response;
  try {
    res = await fetch(`${BASE}${path}`, { ...init, credentials: "include", cache: "no-store", headers: { "Content-Type": "application/json", ...(init?.headers ?? {}) } });
  } catch {
    throw new UbicacionesApiError("No hay conexión con el servidor. Revisá tu internet y volvé a intentar.", 0, "NETWORK");
  }
  const body = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  if (!res.ok) throw new UbicacionesApiError(String(body.error ?? "No se pudo completar la operación."), res.status, String(body.code ?? "ERROR"));
  return body as T;
}
const post = (path: string, body: unknown) => call<never>(path, { method: "POST", body: JSON.stringify(body) });

export const newKey = () => (typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID() : `k-${Date.now()}-${Math.random().toString(36).slice(2)}`);

export const fetchMap = () => call<{ map: MapView }>("").then((r) => r.map);
export const fetchHistory = (locationId?: string) => call<{ movements: MovementView[] }>(`?view=history${locationId ? `&locationId=${encodeURIComponent(locationId)}` : ""}`).then((r) => r.movements);
export const fetchClients = () => call<{ clients: Array<{ name: string; key: string }> }>("?view=clients").then((r) => r.clients);
export const fetchMaterials = (q: string) => call<{ materials: MaterialOption[] }>(`?view=materials&q=${encodeURIComponent(q)}`).then((r) => r.materials);

export const fetchIngresos = (q = "") => call<{ unplaced: IngresoPendiente[]; review: IngresoReview[] }>(`?view=ingresos${q ? `&q=${encodeURIComponent(q)}` : ""}`);
export const opIngresoAjustar = (b: Record<string, unknown>) => post("", { action: "ingreso_ajustar", ...b }) as Promise<OpResultView>;
export const opIngresoRetirar = (b: Record<string, unknown>) => post("", { action: "ingreso_retirar", ...b }) as Promise<OpResultView>;
export const opVincular = (b: Record<string, unknown>) => post("", { action: "vincular", ...b }) as Promise<OpResultView>;
export const opAgregar = (b: Record<string, unknown>) => post("", { action: "agregar", ...b }) as Promise<OpResultView>;
export const opRetirar = (b: Record<string, unknown>) => post("", { action: "retirar", ...b }) as Promise<OpResultView>;
export const opObservaciones = (b: Record<string, unknown>) => post("", { action: "observaciones", ...b }) as Promise<OpResultView>;
export const opTrasladar = (b: Record<string, unknown>) => post("", { action: "trasladar", ...b }) as Promise<OpResultView>;
export const opLiberar = (b: Record<string, unknown>) => post("", { action: "liberar", ...b }) as Promise<OpResultView>;
export const opIngresoMe = (b: Record<string, unknown>) => post("", { action: "ingreso_me", ...b }) as Promise<OpResultView>;

export const cfgCrear = (b: Record<string, unknown>) => post("/config", { action: "crear", ...b }) as Promise<{ location: UbicacionView }>;
export const cfgActualizar = (b: Record<string, unknown>) => post("/config", { action: "actualizar", ...b }) as Promise<{ location: UbicacionView }>;
export const cfgForma = (b: Record<string, unknown>) => post("/config", { action: "forma", ...b }) as Promise<{ shape: ShapeView }>;
export const cfgPlano = (b: Record<string, unknown>) => post("/config", { action: "plano", ...b });
