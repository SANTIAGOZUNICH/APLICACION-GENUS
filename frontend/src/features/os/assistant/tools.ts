import "server-only";

import { isStepCount, jsonSchema, tool, type ToolSet } from "ai";
import { OPERATIONAL_SECTOR_IDS, SECTOR_LABELS, type SectorId } from "@/types/operational/sector";
import type {
  CreamyLocalSnapshot,
  CreamyOrderSummary,
  CreamyQualityPendingSummary,
  CreamyRawMaterialSummary,
  CreamyWorkItemSummary,
  SourceCitation,
} from "./types";
import {
  canCreamyAccessDomain,
  isOwnWorkOnlySector,
  type CreamyAccessDomain,
} from "./permissions";

export { isStepCount };

const MAX_TOOL_RESULTS = 10;
const HELP_CATALOG = [
  {
    id: "help-trabajos",
    label: "Ayuda · Trabajos",
    keywords: ["trabajo", "pendiente", "avance", "terminar", "produccion", "elaboracion", "envasado"],
    text:
      "Para consultar trabajos, abrí Mi trabajo o Producción. Creamy puede buscar y resumir trabajos, pero no cambia estados ni aprueba decisiones.",
  },
  {
    id: "help-lotes",
    label: "Ayuda · Asignación de lotes",
    keywords: ["lote", "codificado", "asignacion", "vencimiento", "vto"],
    text:
      "Asignación de lotes permite consultar lote, producto, código, cantidades, vencimiento y análisis. Creamy solo lee el snapshot local.",
  },
  {
    id: "help-mp",
    label: "Ayuda · Materia prima",
    keywords: ["materia prima", "mp", "stock", "disponibilidad", "vencimiento"],
    text:
      "Stock de Materias Primas muestra código, lote, cantidad, unidad, ubicación y vencimiento. Solo Materia Prima y Producción pueden consultar este dominio desde Creamy.",
  },
  {
    id: "help-ordenes",
    label: "Ayuda · OE/OA",
    keywords: ["oe", "oa", "orden", "documento", "archivo"],
    text:
      "Las OE y OA se listan desde trabajos y documentos locales. Creamy muestra metadata de archivos, nunca contenido binario ni enlaces de data URL.",
  },
  {
    id: "help-calidad",
    label: "Ayuda · Calidad",
    keywords: ["calidad", "aprobar", "rechazar", "decision", "gmp", "liberar"],
    text:
      "Calidad recibe trabajos terminados y registra decisiones. Creamy puede listar pendientes; decisiones GMP deben derivarse a Calidad, Producción o DT.",
  },
] as const;

export interface CreamyToolResult<T = unknown> {
  results: T[];
  localOnly: boolean;
  sources: SourceCitation[];
  message?: string;
}

interface RuntimeInput {
  actorSectorId: SectorId;
  snapshot?: CreamyLocalSnapshot;
}

interface SearchInput {
  query?: string;
  limit?: number;
}

interface WorkSearchInput extends SearchInput {
  sector?: string;
  status?: string;
  fromDate?: string;
  toDate?: string;
}

interface SectorInput {
  sector: string;
  limit?: number;
}

interface OverdueInput {
  beforeDate?: string;
  limit?: number;
}

interface ExpiringInput {
  days?: number;
  limit?: number;
}

interface RawMaterialAvailabilityInput {
  codigo?: string;
  nombre?: string;
  cantidadNecesaria?: number;
  unidad?: string;
}

interface OrderSearchInput extends SearchInput {
  kind?: "OE" | "OA";
  ref?: string;
}

function emptyResult<T>(message: string): CreamyToolResult<T> {
  return { results: [], localOnly: true, sources: [], message };
}

function denied<T>(domain: CreamyAccessDomain): CreamyToolResult<T> {
  return emptyResult<T>(`Tu sector no tiene permiso para consultar ${domain} desde Creamy.`);
}

function clampLimit(limit: unknown): number {
  if (typeof limit !== "number" || !Number.isFinite(limit)) return MAX_TOOL_RESULTS;
  return Math.max(1, Math.min(MAX_TOOL_RESULTS, Math.trunc(limit)));
}

function normalizeText(value: unknown): string {
  return String(value ?? "")
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toLowerCase()
    .trim();
}

function includesQuery(fields: unknown[], query: unknown): boolean {
  const q = normalizeText(query);
  if (!q) return true;
  return fields.some((field) => normalizeText(field).includes(q));
}

function parseSector(value: unknown): SectorId | null {
  if (typeof value !== "string") return null;
  const normalized = value.trim().toUpperCase();
  return OPERATIONAL_SECTOR_IDS.includes(normalized as SectorId) ? (normalized as SectorId) : null;
}

function dateMs(value: string | null | undefined): number | null {
  if (!value) return null;
  const ms = new Date(`${value.slice(0, 10)}T00:00:00`).getTime();
  return Number.isFinite(ms) ? ms : null;
}

function formatDate(value: string | null | undefined): string | null {
  if (!value) return null;
  const iso = value.slice(0, 10);
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
  if (!match) return value;
  return `${match[3]}/${match[2]}/${match[1]}`;
}

function formatQuantity(quantity: string | null, unit: string | null): string | null {
  if (!quantity && !unit) return null;
  return [quantity, unit].filter(Boolean).join(" ");
}

function sourceUnique(sources: SourceCitation[]): SourceCitation[] {
  const seen = new Set<string>();
  return sources.filter((source) => {
    const key = `${source.type}:${source.id}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function canSeeWorkItem(actorSectorId: SectorId, item: CreamyWorkItemSummary): boolean {
  if (!canCreamyAccessDomain(actorSectorId, "works")) return false;
  if (actorSectorId === "PRODUCCION" || actorSectorId === "CALIDAD") return true;
  if (isOwnWorkOnlySector(actorSectorId)) {
    return item.sector === actorSectorId || item.ownerSector === actorSectorId;
  }
  return false;
}

function canSeeOrder(actorSectorId: SectorId, order: CreamyOrderSummary): boolean {
  const domain = order.kind === "OE" ? "orders_oe" : "orders_oa";
  if (!canCreamyAccessDomain(actorSectorId, domain)) return false;
  if (actorSectorId === "PRODUCCION" || actorSectorId === "CALIDAD") return true;
  if (order.kind === "OE") return actorSectorId === "ELABORACION" || actorSectorId === "MATERIA_PRIMA";
  if (order.kind === "OA") {
    return (
      actorSectorId === "ENVASADO_MASIVO" ||
      actorSectorId === "ENVASADO_PREMIUM"
    );
  }
  return false;
}

function workSource(item: CreamyWorkItemSummary): SourceCitation {
  return {
    type: "work",
    id: item.id,
    label: `${SECTOR_LABELS[item.sector]} · ${item.product ?? item.client ?? item.id}`,
  };
}

function lotSource(lot: { id: string; lote: string; producto: string }): SourceCitation {
  return { type: "lot", id: lot.id, label: `${lot.lote} · ${lot.producto}` };
}

function rawMaterialSource(mp: CreamyRawMaterialSummary): SourceCitation {
  return { type: "raw_material", id: mp.id, label: `${mp.codigo} · ${mp.nombre} · ${mp.lote}` };
}

function orderSource(order: CreamyOrderSummary): SourceCitation {
  return { type: "order", id: order.id, label: `${order.kind} ${order.ref}` };
}

function qualitySource(item: CreamyQualityPendingSummary): SourceCitation {
  return { type: "quality", id: item.id, label: `Calidad · ${item.product}` };
}

function workResult(item: CreamyWorkItemSummary) {
  return {
    ...item,
    plannedDateLabel: formatDate(item.plannedDate),
    deliveryDateLabel: formatDate(item.deliveryDate),
    quantityLabel: formatQuantity(item.quantity, item.unit),
    notesData: item.notes,
  };
}

function orderResult(order: CreamyOrderSummary) {
  return {
    ...order,
    fechaLabel: formatDate(order.fecha),
    deliveryDateLabel: formatDate(order.deliveryDate),
    documents: order.documents.map((doc) => ({
      ...doc,
      fechaLabel: formatDate(doc.fecha),
      uploadedAtLabel: formatDate(doc.uploadedAt),
      fileDataUrl: undefined,
    })),
  };
}

export function createCreamyToolRuntime({ actorSectorId, snapshot }: RuntimeInput) {
  const workItems = snapshot?.workItems ?? [];
  const lots = snapshot?.lots ?? [];
  const rawMaterials = snapshot?.rawMaterials ?? [];
  const orders = snapshot?.orders ?? [];
  const qualityPending = snapshot?.qualityPending ?? [];

  return {
    searchWorkItems(input: WorkSearchInput = {}): CreamyToolResult {
      if (!canCreamyAccessDomain(actorSectorId, "works")) return denied("works");
      const sector = input.sector ? parseSector(input.sector) : null;
      const from = dateMs(input.fromDate);
      const to = dateMs(input.toDate);
      const limit = clampLimit(input.limit);
      const results = workItems
        .filter((item) => canSeeWorkItem(actorSectorId, item))
        .filter((item) => !sector || item.sector === sector || item.ownerSector === sector)
        .filter((item) => !input.status || item.status === input.status)
        .filter((item) =>
          includesQuery(
            [
              item.id,
              item.client,
              item.product,
              item.quantity,
              item.line,
              item.pedidoRef,
              item.oeRef,
              item.oaRef,
              item.loteRef,
              item.notes,
            ],
            input.query
          )
        )
        .filter((item) => {
          const itemDate = dateMs(item.deliveryDate ?? item.plannedDate);
          if (from != null && (itemDate == null || itemDate < from)) return false;
          if (to != null && (itemDate == null || itemDate > to)) return false;
          return true;
        })
        .slice(0, limit);
      return {
        results: results.map(workResult),
        localOnly: true,
        sources: sourceUnique(results.map(workSource)),
        message: results.length ? undefined : "No encontré trabajos con esos filtros en el snapshot local.",
      };
    },

    getOverdueWork(input: OverdueInput = {}): CreamyToolResult {
      if (!canCreamyAccessDomain(actorSectorId, "works")) return denied("works");
      const before = dateMs(input.beforeDate) ?? dateMs(new Date().toISOString())!;
      const limit = clampLimit(input.limit);
      const results = workItems
        .filter((item) => canSeeWorkItem(actorSectorId, item))
        .filter((item) => item.status !== "completo" && item.status !== "cancelado")
        .filter((item) => {
          const due = dateMs(item.deliveryDate ?? item.plannedDate);
          return due != null && due < before;
        })
        .sort((a, b) => (dateMs(a.deliveryDate ?? a.plannedDate) ?? 0) - (dateMs(b.deliveryDate ?? b.plannedDate) ?? 0))
        .slice(0, limit);
      return {
        results: results.map(workResult),
        localOnly: true,
        sources: sourceUnique(results.map(workSource)),
        message: results.length ? undefined : "No encontré trabajos vencidos en el snapshot local.",
      };
    },

    getWorkBySector(input: SectorInput): CreamyToolResult {
      if (!canCreamyAccessDomain(actorSectorId, "works")) return denied("works");
      const sector = parseSector(input.sector);
      if (!sector) return emptyResult("Sector inválido.");
      const limit = clampLimit(input.limit);
      const results = workItems
        .filter((item) => canSeeWorkItem(actorSectorId, item))
        .filter((item) => item.sector === sector || item.ownerSector === sector)
        .slice(0, limit);
      return {
        results: results.map(workResult),
        localOnly: true,
        sources: sourceUnique(results.map(workSource)),
        message: results.length
          ? undefined
          : `No encontré trabajos visibles para ${SECTOR_LABELS[sector]} en el snapshot local.`,
      };
    },

    searchLots(input: SearchInput = {}): CreamyToolResult {
      if (!canCreamyAccessDomain(actorSectorId, "lots")) return denied("lots");
      const limit = clampLimit(input.limit);
      const results = lots
        .filter((lot) =>
          includesQuery(
            [lot.id, lot.lote, lot.producto, lot.codigo, lot.marca, lot.observaciones],
            input.query
          )
        )
        .slice(0, limit);
      return {
        results: results.map((lot) => ({
          ...lot,
          fechaLabel: formatDate(lot.fecha),
          vtoLabel: formatDate(lot.vto),
          fechaAnalisisLabel: formatDate(lot.fechaAnalisis),
        })),
        localOnly: true,
        sources: sourceUnique(results.map(lotSource)),
        message: results.length ? undefined : "No encontré lotes con esa búsqueda en el snapshot local.",
      };
    },

    getExpiringLots(input: ExpiringInput = {}): CreamyToolResult {
      if (!canCreamyAccessDomain(actorSectorId, "lots")) return denied("lots");
      const days = typeof input.days === "number" && Number.isFinite(input.days) ? Math.max(1, input.days) : 90;
      const limit = clampLimit(input.limit);
      const now = dateMs(new Date().toISOString())!;
      const until = now + days * 24 * 60 * 60 * 1000;
      const results = lots
        .filter((lot) => {
          const vto = dateMs(lot.vto);
          return vto != null && vto >= now && vto <= until;
        })
        .sort((a, b) => (dateMs(a.vto) ?? 0) - (dateMs(b.vto) ?? 0))
        .slice(0, limit);
      return {
        results: results.map((lot) => ({ ...lot, vtoLabel: formatDate(lot.vto) })),
        localOnly: true,
        sources: sourceUnique(results.map(lotSource)),
        message: results.length ? undefined : `No encontré lotes que venzan en los próximos ${days} días.`,
      };
    },

    searchRawMaterials(input: SearchInput = {}): CreamyToolResult {
      if (!canCreamyAccessDomain(actorSectorId, "rawMaterials")) return denied("rawMaterials");
      const limit = clampLimit(input.limit);
      const results = rawMaterials
        .filter((mp) =>
          includesQuery(
            [mp.id, mp.codigo, mp.nombre, mp.lote, mp.proveedor, mp.ubicacion, mp.observaciones, mp.estado],
            input.query
          )
        )
        .slice(0, limit);
      return {
        results: results.map((mp) => ({ ...mp, vencimientoLabel: formatDate(mp.vencimiento) })),
        localOnly: true,
        sources: sourceUnique(results.map(rawMaterialSource)),
        message: results.length ? undefined : "No encontré materias primas con esa búsqueda en el snapshot local.",
      };
    },

    checkRawMaterialAvailability(input: RawMaterialAvailabilityInput = {}): CreamyToolResult {
      if (!canCreamyAccessDomain(actorSectorId, "rawMaterials")) return denied("rawMaterials");
      if (!input.codigo && !input.nombre) {
        return emptyResult("Indicá código o nombre de materia prima para revisar disponibilidad.");
      }
      const required = typeof input.cantidadNecesaria === "number" && Number.isFinite(input.cantidadNecesaria)
        ? Math.max(0, input.cantidadNecesaria)
        : null;
      const matches = rawMaterials.filter((mp) =>
        includesQuery([mp.codigo], input.codigo) && includesQuery([mp.nombre], input.nombre)
      );
      const total = matches.reduce((sum, mp) => sum + mp.cantidad, 0);
      const results = matches.slice(0, MAX_TOOL_RESULTS).map((mp) => ({
        ...mp,
        vencimientoLabel: formatDate(mp.vencimiento),
      }));
      return {
        results: [
          {
            codigo: input.codigo ?? null,
            nombre: input.nombre ?? null,
            totalDisponible: total,
            unidad: input.unidad ?? matches[0]?.unidad ?? null,
            cantidadNecesaria: required,
            suficiente: required == null ? null : total >= required,
            lotes: results,
          },
        ],
        localOnly: true,
        sources: sourceUnique(matches.slice(0, MAX_TOOL_RESULTS).map(rawMaterialSource)),
        message: matches.length ? undefined : "No encontré stock local para esa materia prima.",
      };
    },

    searchOrders(input: OrderSearchInput = {}): CreamyToolResult {
      const requestedKind = input.kind;
      if (requestedKind === "OE" && !canCreamyAccessDomain(actorSectorId, "orders_oe")) {
        return denied("orders_oe");
      }
      if (requestedKind === "OA" && !canCreamyAccessDomain(actorSectorId, "orders_oa")) {
        return denied("orders_oa");
      }
      const limit = clampLimit(input.limit);
      const results = orders
        .filter((order) => !requestedKind || order.kind === requestedKind)
        .filter((order) => canSeeOrder(actorSectorId, order))
        .filter((order) => !input.ref || normalizeText(order.ref) === normalizeText(input.ref))
        .filter((order) =>
          includesQuery(
            [
              order.id,
              order.kind,
              order.ref,
              order.cliente,
              order.producto,
              order.cantidad,
              ...order.documents.flatMap((doc) => [
                doc.fileName,
                doc.producto,
                doc.codigo,
                doc.cliente,
                doc.lote,
                doc.observaciones,
              ]),
            ],
            input.query
          )
        )
        .slice(0, limit);
      return {
        results: results.map(orderResult),
        localOnly: true,
        sources: sourceUnique(results.map(orderSource)),
        message: results.length ? undefined : "No encontré órdenes visibles con esos filtros.",
      };
    },

    getPendingQualityDecisions(input: SearchInput = {}): CreamyToolResult {
      if (!canCreamyAccessDomain(actorSectorId, "quality")) return denied("quality");
      const limit = clampLimit(input.limit);
      const results = qualityPending
        .filter((item) => item.status === "pendiente")
        .filter((item) =>
          includesQuery(
            [item.id, item.product, item.client, item.lote, item.oe, item.oa, item.line, item.observation],
            input.query
          )
        )
        .slice(0, limit);
      return {
        results: results.map((item) => ({
          ...item,
          deliveryDateLabel: formatDate(item.deliveryDate),
          completedAtLabel: formatDate(item.completedAt),
        })),
        localOnly: true,
        sources: sourceUnique(results.map(qualitySource)),
        message: results.length ? undefined : "No encontré decisiones pendientes de Calidad en el snapshot local.",
      };
    },

    getApplicationHelp(input: SearchInput = {}): CreamyToolResult {
      if (!canCreamyAccessDomain(actorSectorId, "help")) return denied("help");
      const limit = clampLimit(input.limit);
      const results = HELP_CATALOG.filter((entry) =>
        includesQuery([entry.label, entry.text, ...entry.keywords], input.query)
      ).slice(0, limit);
      return {
        results,
        localOnly: true,
        sources: results.map((entry) => ({ type: "help", id: entry.id, label: entry.label })),
        message: results.length ? undefined : "No encontré una guía para esa consulta.",
      };
    },
  };
}

export function createCreamyTools(input: RuntimeInput): ToolSet {
  const runtime = createCreamyToolRuntime(input);
  return {
    searchWorkItems: tool({
      description: "Busca trabajos operativos visibles por texto, sector, estado o rango de fechas.",
      inputSchema: jsonSchema<WorkSearchInput>({
        type: "object",
        properties: {
          query: { type: "string" },
          sector: { type: "string" },
          status: { type: "string" },
          fromDate: { type: "string", description: "YYYY-MM-DD" },
          toDate: { type: "string", description: "YYYY-MM-DD" },
          limit: { type: "number", maximum: MAX_TOOL_RESULTS },
        },
        additionalProperties: false,
      }),
      execute: (toolInput) => runtime.searchWorkItems(toolInput),
    }),
    getOverdueWork: tool({
      description: "Devuelve trabajos visibles no completados con fecha vencida.",
      inputSchema: jsonSchema<OverdueInput>({
        type: "object",
        properties: {
          beforeDate: { type: "string", description: "YYYY-MM-DD; default hoy" },
          limit: { type: "number", maximum: MAX_TOOL_RESULTS },
        },
        additionalProperties: false,
      }),
      execute: (toolInput) => runtime.getOverdueWork(toolInput),
    }),
    getWorkBySector: tool({
      description: "Lista trabajos visibles para un sector operativo.",
      inputSchema: jsonSchema<SectorInput>({
        type: "object",
        required: ["sector"],
        properties: {
          sector: { type: "string" },
          limit: { type: "number", maximum: MAX_TOOL_RESULTS },
        },
        additionalProperties: false,
      }),
      execute: (toolInput) => runtime.getWorkBySector(toolInput),
    }),
    searchLots: tool({
      description: "Busca lotes visibles por lote, producto, código, marca u observaciones.",
      inputSchema: jsonSchema<SearchInput>({
        type: "object",
        properties: {
          query: { type: "string" },
          limit: { type: "number", maximum: MAX_TOOL_RESULTS },
        },
        additionalProperties: false,
      }),
      execute: (toolInput) => runtime.searchLots(toolInput),
    }),
    getExpiringLots: tool({
      description: "Devuelve lotes visibles que vencen dentro de una cantidad de días.",
      inputSchema: jsonSchema<ExpiringInput>({
        type: "object",
        properties: {
          days: { type: "number" },
          limit: { type: "number", maximum: MAX_TOOL_RESULTS },
        },
        additionalProperties: false,
      }),
      execute: (toolInput) => runtime.getExpiringLots(toolInput),
    }),
    searchRawMaterials: tool({
      description: "Busca materias primas visibles por código, nombre, lote, proveedor o estado.",
      inputSchema: jsonSchema<SearchInput>({
        type: "object",
        properties: {
          query: { type: "string" },
          limit: { type: "number", maximum: MAX_TOOL_RESULTS },
        },
        additionalProperties: false,
      }),
      execute: (toolInput) => runtime.searchRawMaterials(toolInput),
    }),
    checkRawMaterialAvailability: tool({
      description: "Calcula disponibilidad local de una materia prima por código o nombre.",
      inputSchema: jsonSchema<RawMaterialAvailabilityInput>({
        type: "object",
        properties: {
          codigo: { type: "string" },
          nombre: { type: "string" },
          cantidadNecesaria: { type: "number" },
          unidad: { type: "string" },
        },
        additionalProperties: false,
      }),
      execute: (toolInput) => runtime.checkRawMaterialAvailability(toolInput),
    }),
    searchOrders: tool({
      description: "Busca órdenes OE/OA visibles y metadata de documentos locales sin binarios.",
      inputSchema: jsonSchema<OrderSearchInput>({
        type: "object",
        properties: {
          kind: { type: "string", enum: ["OE", "OA"] },
          ref: { type: "string" },
          query: { type: "string" },
          limit: { type: "number", maximum: MAX_TOOL_RESULTS },
        },
        additionalProperties: false,
      }),
      execute: (toolInput) => runtime.searchOrders(toolInput),
    }),
    getPendingQualityDecisions: tool({
      description: "Lista decisiones pendientes de Calidad visibles.",
      inputSchema: jsonSchema<SearchInput>({
        type: "object",
        properties: {
          query: { type: "string" },
          limit: { type: "number", maximum: MAX_TOOL_RESULTS },
        },
        additionalProperties: false,
      }),
      execute: (toolInput) => runtime.getPendingQualityDecisions(toolInput),
    }),
    getApplicationHelp: tool({
      description: "Devuelve ayuda estática de uso de Genus OS.",
      inputSchema: jsonSchema<SearchInput>({
        type: "object",
        properties: {
          query: { type: "string" },
          limit: { type: "number", maximum: MAX_TOOL_RESULTS },
        },
        additionalProperties: false,
      }),
      execute: (toolInput) => runtime.getApplicationHelp(toolInput),
    }),
  };
}
