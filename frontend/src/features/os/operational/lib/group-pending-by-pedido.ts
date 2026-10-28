/**
 * Agrupa SOLO PARA MOSTRAR (pestaña Pendientes de Envasado) los trabajos que pertenecen al MISMO pedido.
 *
 * - Criterio único y confiable: trabajo nativo (planificación) con `pedidoRef` = id real del pedido de Producción y el
 *   MISMO sector. Nunca por parecido de cliente / producto / nombre, ni con los datos de texto libre de la planilla
 *   histórica (ahí `pedidoRef` es un texto sin garantía).
 * - Un trabajo sin pedido vinculado, o el único de su pedido, queda como tarjeta individual.
 * - No modifica ni copia datos: devuelve los MISMOS WorkItem (ids, cantidades, fechas, estados y responsables intactos).
 * - Lo que llega acá ya es lo pendiente (el filtro de pendientes se aplica antes); los completos no suman.
 */
import type { WorkItem } from "@/types/operational/work-item";
import { isNativeWorkItemId } from "@/lib/planning/work-item-cell-edit";
import { parseOperationalQuantity } from "./operational-progress";

export type PedidoGroup = {
  key: string;
  pedidoRef: string;
  /** «Pedido 125» (N° legible si existe). */
  label: string;
  client: string;
  items: WorkItem[];
  /**
   * Suma de las cantidades PLANIFICADAS de los trabajos que siguen pendientes (los completos ya no están en la lista, así que no
   * suman). No se resta «realizado»: en los trabajos nativos esa columna arranca igual a lo planificado y no es un avance.
   * null si ningún trabajo tiene cantidad numérica.
   */
  totalPending: number | null;
  /** Trabajos cuya cantidad no es numérica (no suman al total). */
  unparsed: number;
  unit: string;
  status: WorkItem["status"];
  firstDate: string | null;
  lastDate: string | null;
};

export type PendingEntry = { kind: "single"; item: WorkItem } | { kind: "group"; group: PedidoGroup };

const STATUS_ORDER: WorkItem["status"][] = ["bloqueado", "en_curso", "pendiente"];

/** Estado general: el único si todos coinciden; si no, el más «activo» (bloqueado > en curso > pendiente). */
export function generalStatus(items: WorkItem[]): WorkItem["status"] {
  const set = new Set(items.map((i) => i.status));
  if (set.size === 1) return items[0]!.status;
  return STATUS_ORDER.find((s) => set.has(s)) ?? items[0]!.status;
}

export function pedidoGroupKey(item: WorkItem): string | null {
  const ref = item.pedidoRef?.trim();
  if (!ref || !isNativeWorkItemId(item.id)) return null;
  return `${item.sector}|${ref}`;
}

export function groupPendingByPedido(items: WorkItem[]): PendingEntry[] {
  const byKey = new Map<string, WorkItem[]>();
  for (const item of items) {
    const key = pedidoGroupKey(item);
    if (key) byKey.set(key, [...(byKey.get(key) ?? []), item]);
  }
  const out: PendingEntry[] = [];
  const emitted = new Set<string>();
  for (const item of items) {
    const key = pedidoGroupKey(item);
    const members = key ? byKey.get(key)! : null;
    if (!key || !members || members.length < 2) {
      out.push({ kind: "single", item });
      continue;
    }
    if (emitted.has(key)) continue; // la tarjeta del grupo va donde aparece su primer trabajo (se respeta el orden de la lista)
    emitted.add(key);
    let pending = 0;
    let parsed = 0;
    for (const m of members) {
      const p = parseOperationalQuantity(m.quantity);
      if (p === null) continue;
      parsed += 1;
      pending += p;
    }
    const units = new Set(members.map((m) => (m.unit ?? "").trim()).filter(Boolean));
    const dates = members.map((m) => m.plannedDate).filter((d): d is string => Boolean(d)).sort();
    const op = members.map((m) => m.pedidoOp?.trim()).find(Boolean);
    const ref = members[0]!.pedidoRef!.trim();
    const clients = [...new Set(members.map((m) => (m.client ?? "").trim()).filter(Boolean))];
    out.push({
      kind: "group",
      group: {
        key,
        pedidoRef: ref,
        label: op ? `Pedido ${op}` : "Pedido vinculado",
        client: clients.join(" / "),
        items: members,
        totalPending: parsed > 0 ? pending : null,
        unparsed: members.length - parsed,
        unit: units.size === 1 ? [...units][0]! : "",
        status: generalStatus(members),
        firstDate: dates[0] ?? null,
        lastDate: dates[dates.length - 1] ?? null,
      },
    });
  }
  return out;
}
