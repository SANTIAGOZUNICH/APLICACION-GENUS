/**
 * Fecha de entrega — urgencia visual y ordenamiento.
 * Usa ISO YYYY-MM-DD internamente; UI en DD/MM/AAAA.
 */

export type DeliveryUrgency = "vencido" | "hoy" | "proximo" | "ok" | "sin_fecha";

/** Días hacia adelante que se consideran "próximo a vencer". */
export const DELIVERY_SOON_DAYS = 3;

export function todayIso(now = new Date()): string {
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, "0");
  const d = String(now.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

/** Formatea ISO YYYY-MM-DD → DD/MM/AAAA. */
export function formatDateDisplay(iso: string | null | undefined): string {
  if (!iso) return "—";
  const m = iso.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!m) return iso;
  return `${m[3]}/${m[2]}/${m[1]}`;
}

export function parseFlexibleDate(raw: string): string | null {
  const trimmed = raw.trim();
  if (!trimmed) return null;

  const iso = trimmed.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/);
  if (iso) {
    const y = Number(iso[1]);
    const m = Number(iso[2]);
    const d = Number(iso[3]);
    return `${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
  }

  const ddMmYyyy = trimmed.match(/^(\d{1,2})[/.-](\d{1,2})[/.-](\d{4})$/);
  if (ddMmYyyy) {
    const d = Number(ddMmYyyy[1]);
    const m = Number(ddMmYyyy[2]);
    const y = Number(ddMmYyyy[3]);
    return `${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
  }

  const mmYyyy = trimmed.match(/^(\d{1,2})[/.-](\d{4})$/);
  if (mmYyyy) {
    const month = Number(mmYyyy[1]);
    const year = Number(mmYyyy[2]);
    const lastDay = new Date(year, month, 0).getDate();
    return `${year}-${String(month).padStart(2, "0")}-${String(lastDay).padStart(2, "0")}`;
  }

  return null;
}

export function resolveDeliveryUrgency(
  deliveryDate: string | null | undefined,
  now = new Date()
): DeliveryUrgency {
  if (!deliveryDate) return "sin_fecha";
  const today = todayIso(now);
  if (deliveryDate < today) return "vencido";
  if (deliveryDate === today) return "hoy";
  const limit = new Date(now);
  limit.setDate(limit.getDate() + DELIVERY_SOON_DAYS);
  const limitIso = todayIso(limit);
  if (deliveryDate <= limitIso) return "proximo";
  return "ok";
}

export const DELIVERY_URGENCY_LABELS: Record<DeliveryUrgency, string> = {
  vencido: "Vencido",
  hoy: "Entrega hoy",
  proximo: "Próximo a vencer",
  ok: "En plazo",
  sin_fecha: "Sin fecha",
};

export function compareByDeliveryDateAsc(
  a: string | null | undefined,
  b: string | null | undefined
): number {
  if (!a && !b) return 0;
  if (!a) return 1;
  if (!b) return -1;
  return a.localeCompare(b);
}

export function sortByDeliveryDateNearest<T extends { deliveryDate?: string | null }>(
  items: T[]
): T[] {
  return [...items].sort((x, y) => compareByDeliveryDateAsc(x.deliveryDate, y.deliveryDate));
}

export function filterByDeliveryDate<T extends { deliveryDate?: string | null }>(
  items: T[],
  filterIso: string | null | undefined
): T[] {
  if (!filterIso) return items;
  return items.filter((item) => item.deliveryDate === filterIso);
}
