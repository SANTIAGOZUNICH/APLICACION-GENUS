import { parseArDecimal } from "@/lib/utils/ar-number-parsing";

/**
 * Reglas puras de las PROGRAMACIONES de una misma OE/OA en varios días. Una programación es un trabajo con su propia fecha y
 * cantidad planificada, vinculado a la original; la orden (OE/OA), el pedido, los consumos de MP y las entregas NO se duplican.
 */

export type ScheduleMember = { id: string; date: string; qty: number };
export type NewSchedule = { date: string; qty: number };

export type SchedulePlan =
  | { ok: true; total: number; programmed: number; newSourceQty: number | null; exceeds: boolean }
  | { ok: false; code: "EMPTY" | "BAD_QTY" | "BAD_DATE" | "DUP_DATE" | "NO_REMAINDER" | "EXCEEDS"; message: string; total?: number; programmed?: number };

const ISO = /^\d{4}-\d{2}-\d{2}$/;
const eps = 1e-9;

export function formatQty(n: number): string {
  return String(Math.round(n * 1000) / 1000);
}

export function parseQty(raw: unknown): number | null {
  if (raw == null) return null;
  if (typeof raw === "number") return Number.isFinite(raw) && raw > 0 ? raw : null;
  const r = parseArDecimal(String(raw));
  return r.value != null && Number.isFinite(r.value) && r.value > 0 ? r.value : null;
}

/**
 * @param members   programaciones VIGENTES de la orden (incluye la original y la que se copia)
 * @param sourceId  programación desde la que se copia
 * @param total     cantidad total de la orden a repartir (de la original)
 * @param rebalance true = la programación origen se queda con lo que falte (total − las demás − las nuevas)
 */
export function planSchedules(input: { members: ScheduleMember[]; sourceId: string; total: number; items: NewSchedule[]; rebalance: boolean; allowExceed: boolean }): SchedulePlan {
  const { members, sourceId, total, items, rebalance, allowExceed } = input;
  if (items.length === 0) return { ok: false, code: "EMPTY", message: "Elegí al menos un día." };
  const seen = new Set(members.map((m) => m.date));
  for (const it of items) {
    if (!ISO.test(it.date)) return { ok: false, code: "BAD_DATE", message: `Fecha inválida: ${it.date}` };
    if (!Number.isFinite(it.qty) || it.qty <= 0) return { ok: false, code: "BAD_QTY", message: "Cada programación necesita una cantidad mayor a 0." };
    if (seen.has(it.date)) return { ok: false, code: "DUP_DATE", message: `Esta orden ya tiene una programación el ${it.date.split("-").reverse().join("/")}.` };
    seen.add(it.date);
  }
  const newSum = items.reduce((s, i) => s + i.qty, 0);
  const others = members.filter((m) => m.id !== sourceId).reduce((s, m) => s + m.qty, 0);
  if (rebalance) {
    const remainder = total - others - newSum;
    if (remainder <= eps) {
      return { ok: false, code: "NO_REMAINDER", message: `Las otras programaciones suman ${formatQty(others + newSum)} y la orden es de ${formatQty(total)}: no queda cantidad para la original.`, total, programmed: others + newSum };
    }
    return { ok: true, total, programmed: total, newSourceQty: remainder, exceeds: false };
  }
  const programmed = members.reduce((s, m) => s + m.qty, 0) + newSum;
  const exceeds = programmed > total + eps;
  if (exceeds && !allowExceed) {
    return { ok: false, code: "EXCEEDS", message: `Las programaciones sumarían ${formatQty(programmed)} y la orden es de ${formatQty(total)}. Confirmá si querés superar la cantidad de la orden.`, total, programmed };
  }
  return { ok: true, total, programmed, newSourceQty: null, exceeds };
}

/**
 * Proporción de una orden que corresponde a las programaciones que caen en un período (p. ej. la semana). Con programaciones
 * repartidas en varias semanas, la necesidad de MP de la orden se reparte en proporción a lo planificado en cada una (suma 1),
 * en vez de contarse completa en cada semana.
 */
export function weekShare(group: Array<{ qty: number | null; inPeriod: boolean }>): number | null {
  if (group.some((g) => g.qty == null || g.qty <= 0)) return null;
  const all = group.reduce((s, g) => s + (g.qty ?? 0), 0);
  if (all <= 0) return null;
  const inPeriod = group.filter((g) => g.inPeriod).reduce((s, g) => s + (g.qty ?? 0), 0);
  return Math.round((inPeriod / all) * 1e9) / 1e9;
}
