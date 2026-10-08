/**
 * Enlace INEQUÍVOCO entre una tarea operativa de un sector (WorkItem) y la tarea de Semanas a la que Producción le asignó
 * prioridad. PURO (cliente/servidor). No lee Google ni infiere nada por colores: usa solo los datos de enlace guardados
 * junto a la prioridad (fecha, cliente, productos, sección).
 *
 * Reglas:
 *  - pestaña/sección según el sector: Elaboración → ELABORACION; Envasado Masivo / Premium → ACONDICIONAMIENTO (sección
 *    «consumo masivo» / «premium»); Codificado/Loteado hereda la del envasado de origen; otros sectores no tienen tarea
 *    en Semanas (no se les muestra prioridad inventada);
 *  - misma fecha (dentro del rango de la tarea), mismo cliente y el producto coincide con alguno de la tarea;
 *  - si hay más de una fila candidata con prioridades distintas → AMBIGUO: no se asigna (NORMAL), nunca se adivina.
 */
import { fold, productsMatch } from "./calendar-tasks";
import type { Priority } from "./priorities";

export interface PriorityLinkRow {
  tab: string;
  taskKey: string;
  taskDate: string | null;
  taskDateTo: string | null;
  clientNorm: string | null;
  productsNorm: string[];
  sectionNorm: string | null;
  priority: Priority;
  version: number;
  updatedByName: string;
  updatedAt: string;
}

export interface LinkableWorkItem {
  sector: string;
  plannedDate: string | null;
  client: string | null;
  product: string | null;
  codificadoOriginSector?: string | null;
}

export interface GenusPriority {
  priority: Priority;
  updatedByName: string;
  updatedAt: string;
  version: number;
}

function target(wi: LinkableWorkItem): { tab: string; section: RegExp | null } | null {
  const sector = wi.sector === "CODIFICADO" ? (wi.codificadoOriginSector ?? "") : wi.sector;
  if (sector === "ELABORACION") return { tab: "ELABORACION", section: null };
  if (sector === "ENVASADO_MASIVO") return { tab: "ACONDICIONAMIENTO", section: /masivo|consumo/ };
  if (sector === "ENVASADO_PREMIUM") return { tab: "ACONDICIONAMIENTO", section: /premi/ };
  return null;
}

export function linkWorkItemPriority(wi: LinkableWorkItem, rows: PriorityLinkRow[]): GenusPriority | null {
  const tg = target(wi);
  if (!tg || !wi.plannedDate || !wi.product) return null;
  const client = wi.client ? fold(wi.client) : "";
  const found = rows.filter((r) => {
    if (r.tab !== tg.tab || !r.taskDate) return false;
    const to = r.taskDateTo ?? r.taskDate;
    if (wi.plannedDate! < r.taskDate || wi.plannedDate! > to) return false;
    if (tg.section && !tg.section.test(r.sectionNorm ?? "")) return false;
    if (r.clientNorm && client && r.clientNorm !== client) return false;
    if (r.clientNorm && !client) return false;
    return r.productsNorm.some((p) => productsMatch(p, wi.product!));
  });
  if (found.length === 0) return null;
  const first = found[0]!;
  if (found.some((r) => r.priority !== first.priority)) return null; // ambiguo → no se adivina
  const latest = [...found].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))[0]!;
  return { priority: latest.priority, updatedByName: latest.updatedByName, updatedAt: latest.updatedAt, version: latest.version };
}
