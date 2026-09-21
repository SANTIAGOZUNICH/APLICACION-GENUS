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

  /**
   * dd/mm/yy (año de 2 dígitos, día explícito) — formato real confirmado en
   * Asignación de Lotes (hoja SEPTIEMBRE 2026: "1/9/28", "1/10/28") — antes
   * no reconocido porque solo existían patrones de 4 dígitos de año (con
   * día) o de 2 dígitos de año (sin día, mm/yy). Mismo criterio de siglo
   * que mm/yy más abajo (GENUS opera en el rango 2020-2069).
   */
  const ddMmYy = trimmed.match(/^(\d{1,2})[/.-](\d{1,2})[/.-](\d{2})$/);
  if (ddMmYy) {
    const d = Number(ddMmYy[1]);
    const m = Number(ddMmYy[2]);
    const yy = Number(ddMmYy[3]);
    if (m < 1 || m > 12 || d < 1 || d > 31) return null;
    const year = yy <= 69 ? 2000 + yy : 1900 + yy;
    return `${year}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
  }

  const mmYyyy = trimmed.match(/^(\d{1,2})[/.-](\d{4})$/);
  if (mmYyyy) {
    const month = Number(mmYyyy[1]);
    const year = Number(mmYyyy[2]);
    const lastDay = new Date(year, month, 0).getDate();
    return `${year}-${String(month).padStart(2, "0")}-${String(lastDay).padStart(2, "0")}`;
  }

  /**
   * mm/yy (año de 2 dígitos) — el formato real más común para VTO en Excel
   * (confirmado en Asignación de Lotes/MP: "08-28", "07/29"), no reconocido
   * antes por este parser. Mismo criterio de siglo que
   * src/lib/smart-paste/normalize.ts#parseVtoCandidate (GENUS opera en el
   * rango 2020-2069) — implementado acá de forma independiente, sin
   * depender de Smart Paste.
   */
  const mmYy = trimmed.match(/^(\d{1,2})[/.-](\d{2})$/);
  if (mmYy) {
    const month = Number(mmYy[1]);
    const yy = Number(mmYy[2]);
    if (month < 1 || month > 12) return null;
    const year = yy <= 69 ? 2000 + yy : 1900 + yy;
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
