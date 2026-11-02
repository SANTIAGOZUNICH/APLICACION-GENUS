import { ACTOR_EMAIL_HEADER, ACTOR_SECTOR_HEADER } from "@/lib/auth/header-names";

export const ME_CONTROL_FOCUS_KEY = "genus_me_control_focus";
export const ME_CONTROL_FOCUS_EVENT = "genus:me-control-focus";

export type MeControlFocus = { week: string; client: string; product: string };

export const actorHeaders = (email: string | null | undefined, sectorId: string): HeadersInit => ({ [ACTOR_EMAIL_HEADER]: email ?? "", [ACTOR_SECTOR_HEADER]: sectorId, "Content-Type": "application/json" });

export async function meApi<T>(path: string, headers: HeadersInit, init: { method?: string; body?: unknown } = {}): Promise<T> {
  const res = await fetch(`/api/v1/me-control${path}`, { credentials: "include", cache: "no-store", method: init.method ?? "GET", headers, body: init.body === undefined ? undefined : JSON.stringify(init.body) });
  const json = (await res.json().catch(() => ({}))) as T & { error?: string };
  if (!res.ok) throw new Error(json.error ?? "No se pudo completar la operación.");
  return json;
}

export const fmtDate = (iso: string) => (/^\d{4}-\d{2}-\d{2}$/.test(iso) ? `${iso.slice(8, 10)}/${iso.slice(5, 7)}/${iso.slice(0, 4)}` : iso);
export const fmtNum = (n: number | null | undefined) => (n == null ? "—" : new Intl.NumberFormat("es-AR", { maximumFractionDigits: 3 }).format(n));

export function setFocus(f: MeControlFocus) {
  try {
    sessionStorage.setItem(ME_CONTROL_FOCUS_KEY, JSON.stringify(f));
  } catch {
    /* sin sessionStorage: se abre la pantalla igual */
  }
  window.dispatchEvent(new CustomEvent(ME_CONTROL_FOCUS_EVENT, { detail: f }));
}
export function takeFocus(): MeControlFocus | null {
  try {
    const raw = sessionStorage.getItem(ME_CONTROL_FOCUS_KEY);
    if (!raw) return null;
    sessionStorage.removeItem(ME_CONTROL_FOCUS_KEY);
    return JSON.parse(raw) as MeControlFocus;
  } catch {
    return null;
  }
}
