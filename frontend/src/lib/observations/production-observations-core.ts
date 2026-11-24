/**
 * Observaciones transversales de Producción — parte PURA (sin I/O): normalización, deduplicación, orden, cadena del trabajo,
 * permisos por sector, filtros e indicador de «nuevas». La lectura de la base vive en production-observations-service.ts.
 *
 * NO es un almacén nuevo: es una vista unificada de solo lectura sobre los textos que ya guardan las entregas
 * (work_item_delivery_lines.observations, work_item_codificado_transfers.note, etc.). Todo se vincula por IDs reales
 * (trabajo, pedido, orden OE/OA, línea de entrega), nunca por la descripción del producto.
 */

export type ObservationOrigin =
  | "ENTREGA_PRODUCCION" // renglón de entrega (work_item_delivery_lines), parcial o total
  | "ENTREGA_CODIFICADO" // entrega parcial de Envasado a Codificado (work_item_codificado_transfers.note)
  | "ENTREGA_HISTORICA" // entrega anterior a los renglones (work_item_deliveries.observations, sin renglones)
  | "ENVIO_ENVASADO" // Elaboración → Envasado
  | "ENVIO_CODIFICADO" // envío completo Envasado → Codificado (circuito anterior)
  | "SOBRANTE_GRANEL"; // observación del sobrante de granel registrado en Depósito

export const ORIGIN_LABEL: Record<ObservationOrigin, string> = {
  ENTREGA_PRODUCCION: "Entrega a Producción",
  ENTREGA_CODIFICADO: "Entrega a Codificado",
  ENTREGA_HISTORICA: "Entrega (registro histórico)",
  ENVIO_ENVASADO: "Envío a Envasado",
  ENVIO_CODIFICADO: "Envío a Codificado",
  SOBRANTE_GRANEL: "Sobrante de granel",
};

export const SECTOR_LABEL: Record<string, string> = {
  ELABORACION: "Elaboración",
  ENVASADO_MASIVO: "Envasado Masivo",
  ENVASADO_PREMIUM: "Envasado Premium",
  CODIFICADO: "Codificado",
  PRODUCCION: "Producción",
  DIRECCION: "Dirección",
};
export const sectorLabel = (s: string | null | undefined) => SECTOR_LABEL[String(s ?? "").toUpperCase()] ?? String(s ?? "—");

/** Sectores productivos que originan observaciones. */
export const PRODUCTIVE_SECTORS = ["ELABORACION", "ENVASADO_MASIVO", "ENVASADO_PREMIUM", "CODIFICADO"] as const;
const PRODUCTIVE = new Set<string>(PRODUCTIVE_SECTORS);

export interface ProductionObservation {
  /** Estable y único: `${origin}:${idDeLaFuente}`. */
  id: string;
  origin: ObservationOrigin;
  originLabel: string;
  /** Id de la entrega (renglón / transferencia / entrega agregada) o del trabajo para los envíos. */
  deliveryId: string;
  /** Orden de la entrega dentro del trabajo (#1, #2…). */
  sequence: number | null;
  /** Sector de ORIGEN (el que entregó). */
  sector: string;
  sectorLabel: string;
  deliveredBy: string;
  /** Sector de la persona que registró (puede ser Producción registrando por otro sector). */
  deliveredBySector: string | null;
  /** ISO. */
  at: string;
  tipo: "PARCIAL" | "TOTAL" | null;
  quantity: number | null;
  unit: string | null;
  text: string;
  /** Entrega anulada/cancelada: se muestra marcada, no desaparece. */
  anulada: boolean;
  /** El texto fue corregido después de cargarse (el historial vive en internal_delivery_changes). */
  edited: boolean;
  workItemId: string;
  /** Sector actual del trabajo al que pertenece la entrega. */
  workItemSector: string;
  workItemDeleted: boolean;
  pedidoId: string | null;
  pedidoOp: string | null;
  client: string;
  product: string;
  /** OE/OA del trabajo. */
  orderNumber: string | null;
  lote: string | null;
  /** Calculado según el ámbito (FEED o trabajo) y el último «visto» del usuario. */
  isNew: boolean;
}

/** Fuente sin el indicador de nuevas (lo calcula la capa de lectura). */
export type ObservationCandidate = Omit<ProductionObservation, "isNew">;

// ───────────────────────── Texto ─────────────────────────

const SYNC_MARK_RE = /\[sync-from:[0-9a-f-]{36}\]/i;

/** Texto de la observación o null si está vacío. Las entregas sincronizadas (otra aparición del mismo trabajo) no son observaciones propias. */
export function cleanObservationText(raw: string | null | undefined): string | null {
  if (raw == null) return null;
  const t = String(raw).replace(/\r\n/g, "\n").trim();
  if (!t) return null;
  if (SYNC_MARK_RE.test(t)) return null;
  return t;
}

// ───────────────────────── Tipo ─────────────────────────

const EPS = 1e-6;
/** PARCIAL = quedaba saldo; TOTAL = cerró; null = dato histórico sin saldo (no se inventa). */
export function tipoFromPending(pending: number | null | undefined): "PARCIAL" | "TOTAL" | null {
  if (pending == null || !Number.isFinite(Number(pending))) return null;
  return Number(pending) > EPS ? "PARCIAL" : "TOTAL";
}

// ───────────────────────── Orden y deduplicación ─────────────────────────

/** Una observación por id (la primera gana). Nunca por texto: dos entregas con el mismo texto son dos observaciones. */
export function dedupeObservations<T extends { id: string }>(list: readonly T[]): T[] {
  const seen = new Set<string>();
  const out: T[] = [];
  for (const o of list) {
    if (seen.has(o.id)) continue;
    seen.add(o.id);
    out.push(o);
  }
  return out;
}

/** Más recientes primero (listado). Desempate estable por id. */
export function sortNewestFirst<T extends { at: string; id: string }>(list: readonly T[]): T[] {
  return [...list].sort((a, b) => b.at.localeCompare(a.at) || b.id.localeCompare(a.id));
}
/** Cronológico ascendente (historial dentro del trabajo). */
export function sortChronological<T extends { at: string; id: string }>(list: readonly T[]): T[] {
  return [...list].sort((a, b) => a.at.localeCompare(b.at) || a.id.localeCompare(b.id));
}

// ───────────────────────── Cadena del trabajo ─────────────────────────

export interface ChainNode {
  id: string;
  sector: string;
  productionPedidoId: string | null;
  orderId: string | null;
  scheduleRootId: string | null;
  parentWorkItemId: string | null;
  deleted: boolean;
}
/** Relación Elaboración → Envasado (evento RECEIVED_FROM_ELABORACION): `to` recibió de `from`. */
export interface ChainLink {
  from: string;
  to: string;
}

const pedidosCompatible = (a: ChainNode, b: ChainNode) => !(a.productionPedidoId && b.productionPedidoId && a.productionPedidoId !== b.productionPedidoId);

/**
 * Agrupa los trabajos en cadenas (mismo trabajo a través de sus etapas y programaciones). Dos trabajos son de la misma cadena solo si
 * hay una relación REAL: padre/hijo (entrega parcial a Codificado), mismo pedido, misma programación raíz, misma orden o el envío
 * Elaboración → Envasado. Dos pedidos distintos NUNCA se mezclan (ni por orden ni por programación), aunque coincidan cliente/producto.
 */
export function buildChains(nodes: readonly ChainNode[], links: readonly ChainLink[] = []): Map<string, string[]> {
  const parent = new Map<string, string>();
  const find = (x: string): string => {
    let r = x;
    while (parent.get(r) !== r) r = parent.get(r)!;
    let c = x;
    while (parent.get(c) !== r) {
      const n = parent.get(c)!;
      parent.set(c, r);
      c = n;
    }
    return r;
  };
  const union = (a: string, b: string) => {
    const ra = find(a);
    const rb = find(b);
    if (ra !== rb) parent.set(ra < rb ? rb : ra, ra < rb ? ra : rb);
  };
  const byId = new Map(nodes.map((n) => [n.id, n]));
  for (const n of nodes) parent.set(n.id, n.id);

  const group = (keyOf: (n: ChainNode) => string | null) => {
    const m = new Map<string, ChainNode[]>();
    for (const n of nodes) {
      const k = keyOf(n);
      if (k) m.set(k, [...(m.get(k) ?? []), n]);
    }
    for (const list of m.values()) for (let i = 1; i < list.length; i++) if (pedidosCompatible(list[0]!, list[i]!)) union(list[0]!.id, list[i]!.id);
  };
  // Mismo pedido (id real): un pedido es un producto; sus trabajos son las etapas y programaciones del mismo trabajo.
  const byPedido = new Map<string, ChainNode[]>();
  for (const n of nodes) if (n.productionPedidoId) byPedido.set(n.productionPedidoId, [...(byPedido.get(n.productionPedidoId) ?? []), n]);
  for (const list of byPedido.values()) for (let i = 1; i < list.length; i++) union(list[0]!.id, list[i]!.id);
  group((n) => (n.orderId ? `o:${n.orderId}` : null));
  group((n) => n.scheduleRootId ?? null);
  for (const n of nodes) {
    if (n.scheduleRootId && byId.has(n.scheduleRootId) && pedidosCompatible(n, byId.get(n.scheduleRootId)!)) union(n.id, n.scheduleRootId);
    if (n.parentWorkItemId && byId.has(n.parentWorkItemId)) union(n.id, n.parentWorkItemId);
  }
  for (const l of links) if (byId.has(l.from) && byId.has(l.to)) union(l.from, l.to);

  const out = new Map<string, string[]>();
  for (const n of nodes) {
    const r = find(n.id);
    out.set(r, [...(out.get(r) ?? []), n.id]);
  }
  for (const ids of out.values()) ids.sort();
  return out;
}

/** workItemId → ids de su cadena. */
export function chainIndex(chains: Map<string, string[]>): Map<string, string[]> {
  const idx = new Map<string, string[]>();
  for (const ids of chains.values()) for (const id of ids) idx.set(id, ids);
  return idx;
}

// ───────────────────────── Permisos ─────────────────────────

export const isAdminObservationSector = (s: string | null | undefined) => {
  const u = String(s ?? "").toUpperCase();
  return u === "PRODUCCION" || u === "DIRECCION";
};
/** Producción/Dirección (todo) y los sectores productivos (solo su cadena). */
export function canViewProductionObservations(s: string | null | undefined): boolean {
  const u = String(s ?? "").toUpperCase();
  return isAdminObservationSector(u) || PRODUCTIVE.has(u);
}
/**
 * ¿Ve este sector la cadena? Producción/Dirección siempre; un sector productivo solo si la cadena tiene un trabajo VIGENTE suyo
 * (así Codificado ve la observación de Envasado de SU trabajo, y Envasado ve la de Codificado, pero no los trabajos ajenos).
 */
export function canSeeChain(actorSector: string | null | undefined, chainNodes: readonly Pick<ChainNode, "sector" | "deleted">[]): boolean {
  const u = String(actorSector ?? "").toUpperCase();
  if (isAdminObservationSector(u)) return true;
  if (!PRODUCTIVE.has(u)) return false;
  return chainNodes.some((n) => !n.deleted && n.sector === u);
}

// ───────────────────────── Nuevas ─────────────────────────

/** Sin visita previa se consideran nuevas las de los últimos días (no todo el historial). */
export const NEW_WITHOUT_VISIT_DAYS = 7;

/** Una observación es NUEVA si es posterior a la última visita del usuario al ámbito (o, sin visita, de los últimos 7 días). Las anuladas nunca. */
export function isObservationNew(o: Pick<ObservationCandidate, "at" | "anulada">, seenAt: Date | null, now: Date = new Date()): boolean {
  if (o.anulada) return false;
  const at = new Date(o.at).getTime();
  if (!Number.isFinite(at)) return false;
  const floor = seenAt ? seenAt.getTime() : now.getTime() - NEW_WITHOUT_VISIT_DAYS * 86_400_000;
  return at > floor;
}

export function withNewFlag(list: readonly ObservationCandidate[], seenAt: Date | null, now: Date = new Date()): ProductionObservation[] {
  return list.map((o) => ({ ...o, isNew: isObservationNew(o, seenAt, now) }));
}

// ───────────────────────── Filtros del listado ─────────────────────────

export interface FeedFilters {
  sector?: string | null;
  /** Cliente, pedido (OP), OE/OA, producto, lote o texto. */
  q?: string | null;
  onlyNew?: boolean | null;
  /** Incluir anuladas (default true: se muestran marcadas). */
  includeAnuladas?: boolean | null;
}

const fold = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();

export function matchesQuery(o: ProductionObservation, q: string): boolean {
  const needle = fold(q.trim());
  if (!needle) return true;
  return fold([o.client, o.product, o.pedidoOp ?? "", o.orderNumber ?? "", o.lote ?? "", o.text, o.deliveredBy].join(" ")).includes(needle);
}

export function applyFeedFilters(list: readonly ProductionObservation[], f: FeedFilters): ProductionObservation[] {
  const sector = f.sector ? String(f.sector).toUpperCase() : null;
  return list.filter((o) => {
    if (sector && o.sector !== sector) return false;
    if (f.onlyNew && !o.isNew) return false;
    if (f.includeAnuladas === false && o.anulada) return false;
    if (f.q && !matchesQuery(o, f.q)) return false;
    return true;
  });
}

/** Cantidad que muestra «Observaciones (N)»: las vigentes (las anuladas se listan marcadas, pero no cuentan). */
export function countObservations(list: readonly Pick<ProductionObservation, "anulada" | "isNew">[]): { total: number; news: number; anuladas: number } {
  let total = 0;
  let news = 0;
  let anuladas = 0;
  for (const o of list) {
    if (o.anulada) anuladas++;
    else {
      total++;
      if (o.isNew) news++;
    }
  }
  return { total, news, anuladas };
}
