import "server-only";

import { isStepCount, jsonSchema, tool, type ToolSet } from "ai";
import { OPERATIONAL_SECTOR_IDS, SECTOR_LABELS, type SectorId } from "@/types/operational/sector";
import type {
  CreamyDeliverySummary,
  CreamyLocalSnapshot,
  CreamyNavAction,
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
import {
  searchSubstitutions,
  type SubstitutionSearchInput,
} from "@/features/os/operational/adapters/mp-substitutions-repository";
import {
  getFormulaForProduct,
} from "@/features/os/operational/adapters/formula-repository";
import { getOrdersService } from "@/lib/orders/get-orders-service";
import {
  OrdersForbiddenError,
  OrdersNotFoundError,
  OrdersUnavailableError,
  type OaContent,
  type OeContent,
  type OrdersActor,
} from "@/lib/orders/types";
import { getCreamyMemoryService } from "@/lib/creamy-memory/get-creamy-memory-service";
import { isTestLikeValue } from "@/lib/creamy-memory/sanitize";
import type { CreateOperationalMemoryInput } from "@/lib/creamy-memory/types";

export { isStepCount };

const MAX_TOOL_RESULTS = 10;
const HELP_CATALOG = [
  {
    id: "help-trabajos",
    label: "Ayuda · Trabajos",
    keywords: ["trabajo", "pendiente", "avance", "terminar", "produccion", "elaboracion", "envasado", "tarea", "estado"],
    text:
      "Para consultar trabajos, abrí Mi trabajo o Producción → pestaña Trabajos. " +
      "Creamy puede buscar y resumir trabajos, pero no cambia estados ni aprueba decisiones. " +
      "Estados posibles: pendiente (aún no iniciado), en_curso (en ejecución), completo (terminado), revision (esperando Calidad), cancelado.",
    navHint: "Menú lateral → Mi trabajo (tu sector) o Producción (global)",
    sidebarId: "mi_trabajo" as const,
    navActionLabel: "IR A MI TRABAJO",
  },
  {
    id: "help-eliminar-trabajo",
    label: "Ayuda · Eliminar trabajo",
    keywords: ["eliminar", "borrar", "trabajo", "cancelar trabajo", "remover tarea"],
    text:
      "Para eliminar un trabajo: 1) Abrí el trabajo desde Mi trabajo. 2) Presioná el ícono de tres puntos (⋮) o el botón Opciones. " +
      "3) Seleccioná Eliminar y confirmá. Solo el sector propietario o Producción pueden eliminar trabajos.",
    navHint: "Mi trabajo → abrir trabajo → opciones → Eliminar",
  },
  {
    id: "help-lotes",
    label: "Ayuda · Asignación de lotes",
    keywords: ["lote", "codificado", "asignacion", "vencimiento", "vto", "codigo"],
    text:
      "Asignación de lotes permite consultar lote, producto, código, cantidades, vencimiento y análisis. " +
      "Creamy solo lee el snapshot local. Para actualizar los datos, recargá la vista de Asignación de Lotes.",
    navHint: "Menú lateral → Asignación de Lotes",
    hrefView: "/asignacion-lotes",
  },
  {
    id: "help-mp",
    label: "Ayuda · Materia prima",
    keywords: ["materia prima", "mp", "stock", "disponibilidad", "vencimiento", "insumo", "ingrediente"],
    text:
      "Stock de Materias Primas muestra código, lote, cantidad, unidad, ubicación y vencimiento. " +
      "Solo Materia Prima, Elaboración y Producción pueden consultar este dominio desde Creamy. " +
      "Para ingresar nueva MP, usá la vista Materia Prima → Registrar ingreso.",
    navHint: "Menú lateral → Materia Prima",
    hrefView: "/materia-prima",
  },
  {
    id: "help-sustituciones",
    label: "Ayuda · Sustituciones de Materias Primas",
    keywords: ["sustitucion", "sustituto", "reemplazo", "mp alternativa", "cambio insumo", "sustituir"],
    text:
      "Las sustituciones aprobadas permiten reemplazar una MP por otra en casos de quiebre de stock o equivalencia validada. " +
      "Creamy solo informa sustituciones aprobadas y vigentes; nunca inventa alternativas. " +
      "Para consultar: pedile a Creamy 'buscar sustituciones para MP-035' o 'sustituciones aprobadas para Glicerina'. " +
      "Las aprobaciones las gestiona Calidad o Producción.",
    navHint: "Consultá a Creamy con la tool searchApprovedSubstitutions",
  },
  {
    id: "help-ordenes",
    label: "Ayuda · OE/OA — Órdenes",
    keywords: ["oe", "oa", "orden", "documento", "archivo", "orden elaboracion", "orden acondicionamiento"],
    text:
      "Las OE (Órdenes de Elaboración) y OA (Órdenes de Acondicionamiento) se listan en el módulo de Órdenes. " +
      "Creamy muestra metadata de archivos, nunca contenido binario ni enlaces de datos URL. " +
      "Para buscar una OE específica: pedí 'buscá la OE-123'.",
    navHint: "Menú lateral → Órdenes (OE) o Acondicionamiento (OA)",
    hrefView: "/ordenes",
  },
  {
    id: "help-oe-elaboracion",
    label: "Ayuda · OE — Elaboración",
    keywords: ["orden elaboracion", "oe elaboracion", "elaborar producto", "batch"],
    text:
      "Las OE de Elaboración están vinculadas a trabajos del sector ELABORACION. " +
      "Pasos para consultar una OE: 1) Pedile a Creamy 'buscá OE-XXX'. 2) O abrí el trabajo en Mi Trabajo y buscá la referencia OE. " +
      "Para cargar una OE nueva, contactá a Producción.",
    navHint: "Mi trabajo (ELABORACION) → trabajo → ver OE vinculada",
  },
  {
    id: "help-calidad",
    label: "Ayuda · Calidad",
    keywords: ["calidad", "aprobar", "rechazar", "decision", "gmp", "liberar", "pendiente calidad"],
    text:
      "Calidad recibe trabajos terminados y registra decisiones (aprobar/rechazar). " +
      "Creamy puede listar pendientes de Calidad; las decisiones GMP deben derivarse a Calidad, Producción o DT. " +
      "Para ver pendientes: pedí a Creamy 'trabajos pendientes de Calidad'.",
    navHint: "Menú lateral → Calidad",
    hrefView: "/calidad",
  },
  {
    id: "help-entregas",
    label: "Ayuda · Entregas",
    keywords: ["entrega", "remito", "despacho", "cliente", "entregar", "historial entregas"],
    text:
      "El módulo de Entregas registra lo que fue despachado a clientes. " +
      "Podés consultar: historial por cliente, entregas fuera de fecha, o pendientes de entrega (aprobados sin entregar). " +
      "Para archivar una entrega: 1) Abrí Entregas. 2) Buscá la entrega. 3) Usá Archivar en opciones.",
    navHint: "Menú lateral → Entregas",
    hrefView: "/entregas",
  },
  {
    id: "help-archivar-entrega",
    label: "Ayuda · Archivar entrega",
    keywords: ["archivar entrega", "ocultar entrega", "entrega archivada"],
    text:
      "Para archivar una entrega: 1) Abrí la vista Entregas. 2) Buscá la entrega por remito, cliente o producto. " +
      "3) En opciones (⋮) seleccioná Archivar. Las entregas archivadas no aparecen por defecto pero se pueden ver con 'Mostrar archivadas'.",
    navHint: "Entregas → buscar entrega → opciones → Archivar",
  },
  {
    id: "help-elaboracion-operadores",
    label: "Ayuda · Operadores de Elaboración",
    keywords: ["operador", "elaboracion persona", "responsable elaboracion", "asignar operador", "turno"],
    text:
      "Cada trabajo de Elaboración puede tener un operador (ownerPerson) asignado. " +
      "Para consultar qué está haciendo un operador, pedile a Creamy 'trabajos de Ana en Elaboración'. " +
      "Para asignar o cambiar el operador, usá la vista de edición del trabajo en Producción.",
    navHint: "Producción → trabajo → Editar → Operador",
  },
  {
    id: "help-asignacion-lotes",
    label: "Ayuda · Asignación de lotes a trabajos",
    keywords: ["asignar lote", "lote trabajo", "loteRef", "relacionar lote", "numero lote"],
    text:
      "Un trabajo puede tener un lote asignado (loteRef). " +
      "Para consultar el lote de un trabajo específico: pedile a Creamy 'lote del trabajo OE-123' o buscá el trabajo. " +
      "La asignación de lotes se registra en la vista Asignación de Lotes.",
    navHint: "Asignación de Lotes → buscar por producto o código",
    sidebarId: "asignacion_lotes" as const,
    navActionLabel: "IR A ASIGNACIÓN DE LOTES",
  },
  {
    id: "help-crear-oe",
    label: "Ayuda · Crear OE",
    keywords: ["crear oe", "nueva oe", "orden elaboracion", "cargar oe", "orden de elaboracion"],
    text:
      "Para crear una OE (Orden de Elaboración): 1) Andá a Producción o al módulo Órdenes de Elaboración. " +
      "2) Usá el botón para crear/cargar una nueva OE. 3) Completá cliente, producto, cantidad y fechas. " +
      "Solo Producción y sectores autorizados pueden cargar OE. Creamy no crea órdenes.",
    navHint: "Menú lateral → Órdenes de Elaboración (Producción / Elaboración)",
    sidebarId: "ordenes_elaboracion" as const,
    navActionLabel: "IR A ÓRDENES DE ELABORACIÓN",
  },
  {
    id: "help-enviar-codificado",
    label: "Ayuda · Enviar a Codificado",
    keywords: ["codificado", "enviar codificado", "envasado codificado", "pasar a codificado", "terminar envasado"],
    text:
      "Desde Envasado (Masivo o Premium), al terminar un trabajo podés enviarlo a Codificado marcándolo como completo. " +
      "1) Abrí el trabajo en Mi Trabajo. 2) Completá los datos requeridos. 3) Marcá como terminado. " +
      "Codificado verá el trabajo en su cola para codificar/asignar lotes.",
    navHint: "Mi Trabajo (Envasado) → abrir trabajo → marcar terminado",
    sidebarId: "mi_trabajo" as const,
    navActionLabel: "IR A MI TRABAJO",
  },
  {
    id: "help-remitos",
    label: "Ayuda · Remitos",
    keywords: ["remito", "remitos", "despacho", "guia", "entrega cliente", "armar remito"],
    text:
      "El módulo Remitos permite armar, revisar y gestionar remitos de despacho a clientes. " +
      "Desde Calidad/Producción podés ver aprobados listos para remito. Creamy solo orienta; no genera remitos.",
    navHint: "Menú lateral → Remitos",
    sidebarId: "remitos" as const,
    navActionLabel: "IR A REMITOS",
  },
  {
    id: "help-ingresos-mp",
    label: "Ayuda · Ingresos MP",
    keywords: ["ingreso mp", "ingresos mp", "registrar mp", "materia prima ingreso", "recepcion mp"],
    text:
      "Ingresos MP registra la recepción de materias primas: código, lote, proveedor, cantidad, vencimiento y estado. " +
      "Flujo: registrar ingreso → control/revisión → APROBADO. Solo Materia Prima y sectores autorizados.",
    navHint: "Menú lateral → Ingresos MP (Materia Prima / Depósito)",
    sidebarId: "mp_ingresos" as const,
    navActionLabel: "IR A INGRESOS MP",
  },
  {
    id: "help-etiqueta-mp",
    label: "Ayuda · Etiqueta MP / HereLabel",
    keywords: ["etiqueta mp", "herelabel", "here label", "label mp", "imprimir etiqueta", "aprobado mp"],
    text:
      "Después de que un ingreso MP queda APROBADO, podés generar/imprimir la etiqueta térmica (HereLabel) desde Ingresos MP. " +
      "1) Abrí Ingresos MP. 2) Buscá el ingreso con estado APROBADO. 3) Usá la acción de etiqueta/PDF. Creamy no imprime etiquetas.",
    navHint: "Ingresos MP → ingreso APROBADO → Etiqueta / HereLabel",
    sidebarId: "mp_ingresos" as const,
    navActionLabel: "IR A INGRESOS MP",
  },
  {
    id: "help-sector-nav",
    label: "Ayuda · Qué puede hacer mi sector",
    keywords: ["mi sector", "que puedo hacer", "modulos", "navegacion", "menu", "permisos sector"],
    text:
      "Cada sector ve módulos distintos en el menú lateral según su rol (RBAC). " +
      "Pedile a Creamy qué módulos tenés disponibles en availableNav o consultá '¿a dónde voy para…?' " +
      "Creamy solo recomienda módulos que aparecen en tu navegación autorizada.",
    navHint: "Revisá el menú lateral de tu sector",
  },
  {
    id: "help-sobrante-granel",
    label: "Ayuda · Sobrante de granel",
    keywords: ["sobrante", "granel", "sobrante granel", "deposito graneles", "devolucion granel", "me granel"],
    text:
      "El sobrante de granel se registra en Depósito Graneles o Ingresos ME según el tipo de material y flujo interno. " +
      "1) Identificá el producto/lote y cantidad sobrante. 2) Registralo en Depósito Graneles o Ingresos ME. " +
      "Consultá con Producción/Depósito si no estás seguro del módulo correcto.",
    navHint: "Depósito Graneles o Ingresos ME",
    sidebarId: "deposito_graneles" as const,
    navActionLabel: "IR A DEPÓSITO GRANELES",
  },
  {
    id: "help-estados-trabajo",
    label: "Ayuda · Estados de trabajo",
    keywords: ["estado trabajo", "pendiente", "en curso", "completo", "revision", "cancelado", "status"],
    text:
      "Estados de trabajo en Genus OS: pendiente (sin iniciar), en_curso (en ejecución), completo (sector terminó), " +
      "revision (esperando decisión de Calidad), cancelado (anulado). Creamy puede listar por estado pero no lo cambia.",
    navHint: "Mi Trabajo o Producción → filtrar por estado",
    sidebarId: "mi_trabajo" as const,
    navActionLabel: "IR A MI TRABAJO",
  },
] as const;

type HelpCatalogEntry = (typeof HELP_CATALOG)[number];

export function buildNavActionsFromHelp(
  results: Array<{ sidebarId?: string; navActionLabel?: string; label?: string }>,
  availableNav?: string[]
): CreamyNavAction[] {
  const actions: CreamyNavAction[] = [];
  const seen = new Set<string>();
  for (const entry of results) {
    const sidebarId = entry.sidebarId?.trim();
    if (!sidebarId) continue;
    if (availableNav?.length && !availableNav.includes(sidebarId)) continue;
    if (seen.has(sidebarId)) continue;
    seen.add(sidebarId);
    const fallbackLabel = entry.label?.replace(/^Ayuda · /, "").toUpperCase() ?? sidebarId.toUpperCase();
    actions.push({
      sidebarId,
      label: entry.navActionLabel ?? `IR A ${fallbackLabel}`,
    });
  }
  return actions;
}

export interface CreamyToolResult<T = unknown> {
  results: T[];
  localOnly: boolean;
  sources: SourceCitation[];
  message?: string;
  navActions?: CreamyNavAction[];
}

interface RuntimeInput {
  actorSectorId: SectorId;
  snapshot?: CreamyLocalSnapshot;
  availableNav?: string[];
  /** Email del actor autenticado (uiContext.email). Requerido por tools que tocan Neon (órdenes/memoria). */
  actorEmail?: string;
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

interface DeliverySearchInput extends SearchInput {
  customer?: string;
  product?: string;
  lote?: string;
  codigo?: string;
  fromDate?: string;
  toDate?: string;
  includeArchived?: boolean;
}

interface CustomerInput {
  customer?: string;
  limit?: number;
}

interface DateRangeInput {
  fromDate?: string;
  toDate?: string;
  limit?: number;
}

interface ElaborationWorkInput {
  status?: string;
  onlyToday?: boolean;
  onlyPlanned?: boolean;
  limit?: number;
}

interface ElaborationWorkByOperatorInput {
  ownerPerson: string;
  status?: string;
  limit?: number;
}

interface FormulaInput {
  product: string;
}

interface FormulaAvailabilityInput {
  product: string;
}

interface ElaborationObservationsInput {
  product?: string;
  ownerPerson?: string;
  limit?: number;
}

interface SubstitutionSearchToolInput {
  originalCodigo?: string;
  product?: string;
  query?: string;
  limit?: number;
}

interface ElaborationOrderInput {
  ref?: string;
  query?: string;
  limit?: number;
}

interface RememberOperationalFactInput {
  client: string;
  product: string;
  productCode?: string;
  materiaPrimaOriginal: string;
  materiaPrimaUtilizada: string;
  codigoMpOriginal?: string;
  codigoMpUtilizado?: string;
  motivo: string;
  observacion?: string;
  cantidadOProporcion?: string;
  relatedOrderRef?: string;
  relatedOrderId?: string;
  fecha?: string;
}

interface SearchOperationalMemoriesInput {
  client?: string;
  product?: string;
  productCode?: string;
  limit?: number;
}

interface SearchOrdersForCreamyInput {
  query?: string;
  client?: string;
  product?: string;
  type?: "OE" | "OA";
  limit?: number;
}

interface GetOrderSummaryForCreamyInput {
  id?: string;
  ref?: string;
  includeAnnulled?: boolean;
}

const MAX_ORDER_TOOL_RESULTS = 5;

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

function deliverySource(item: CreamyDeliverySummary): SourceCitation {
  return {
    type: "delivery",
    id: item.id,
    label: `Entrega · ${item.product}${item.client ? ` · ${item.client}` : ""}`,
  };
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

function deliveryResult(item: CreamyDeliverySummary) {
  return {
    ...item,
    plannedDeliveryDateLabel: formatDate(item.plannedDeliveryDate),
    actualDeliveredAtLabel: formatDate(item.actualDeliveredAt),
    quantityLabel: formatQuantity(item.quantity, item.unit),
    late:
      item.plannedDeliveryDate != null &&
      dateMs(item.actualDeliveredAt) != null &&
      dateMs(item.plannedDeliveryDate) != null
        ? dateMs(item.actualDeliveredAt)! > dateMs(item.plannedDeliveryDate)!
        : null,
  };
}

export function createCreamyToolRuntime({ actorSectorId, snapshot, availableNav, actorEmail }: RuntimeInput) {
  const workItems = snapshot?.workItems ?? [];
  const lots = snapshot?.lots ?? [];
  const rawMaterials = snapshot?.rawMaterials ?? [];
  const orders = snapshot?.orders ?? [];
  const qualityPending = snapshot?.qualityPending ?? [];
  const deliveries = snapshot?.deliveries ?? [];

  const searchDeliveriesRuntime = (
    input: DeliverySearchInput = {}
  ): CreamyToolResult<ReturnType<typeof deliveryResult>> => {
    if (!canCreamyAccessDomain(actorSectorId, "deliveries")) return denied("deliveries");
    const limit = clampLimit(input.limit);
    const from = dateMs(input.fromDate);
    const to = dateMs(input.toDate);
    const results = deliveries
      .filter((item) => item.status === "ENTREGADO")
      .filter((item) => input.includeArchived || !item.archived)
      .filter((item) =>
        includesQuery(
          [
            item.id,
            item.workItemId,
            item.product,
            item.codigo,
            item.client,
            item.lote,
            item.remito,
            item.receivedBy,
            item.observations,
          ],
          input.query
        )
      )
      .filter((item) => includesQuery([item.client], input.customer))
      .filter((item) => includesQuery([item.product], input.product))
      .filter((item) => includesQuery([item.lote], input.lote))
      .filter((item) => includesQuery([item.codigo], input.codigo))
      .filter((item) => {
        const actual = dateMs(item.actualDeliveredAt);
        if (from != null && (actual == null || actual < from)) return false;
        if (to != null && (actual == null || actual > to)) return false;
        return true;
      })
      .slice(0, limit);
    return {
      results: results.map(deliveryResult),
      localOnly: true,
      sources: sourceUnique(results.map(deliverySource)),
      message: results.length ? undefined : "No encontré entregas con esos filtros en el snapshot local.",
    };
  };

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

    searchDeliveries: searchDeliveriesRuntime,

    getPendingDeliveries(input: SearchInput = {}): CreamyToolResult {
      if (!canCreamyAccessDomain(actorSectorId, "deliveries")) return denied("deliveries");
      const deliveredWorkIds = new Set(
        deliveries.filter((item) => item.status === "ENTREGADO").map((item) => item.workItemId)
      );
      const limit = clampLimit(input.limit);
      const results = qualityPending
        .filter((item) => item.status === "aprobado")
        .filter((item) => item.relatedWorkItemId && !deliveredWorkIds.has(item.relatedWorkItemId))
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
        message: results.length ? undefined : "No encontré trabajos aprobados pendientes de entrega.",
      };
    },

    getLateDeliveries(input: DateRangeInput = {}): CreamyToolResult {
      if (!canCreamyAccessDomain(actorSectorId, "deliveries")) return denied("deliveries");
      const limit = clampLimit(input.limit);
      const from = dateMs(input.fromDate);
      const to = dateMs(input.toDate);
      const results = deliveries
        .filter((item) => item.status === "ENTREGADO")
        .filter((item) => !item.archived)
        .filter((item) => {
          const actual = dateMs(item.actualDeliveredAt);
          const planned = dateMs(item.plannedDeliveryDate);
          if (actual == null || planned == null || actual <= planned) return false;
          if (from != null && actual < from) return false;
          if (to != null && actual > to) return false;
          return true;
        })
        .slice(0, limit);
      return {
        results: results.map(deliveryResult),
        localOnly: true,
        sources: sourceUnique(results.map(deliverySource)),
        message: results.length ? undefined : "No encontré entregas fuera de fecha.",
      };
    },

    getDeliveriesByCustomer(input: CustomerInput = {}): CreamyToolResult {
      if (!canCreamyAccessDomain(actorSectorId, "deliveries")) return denied("deliveries");
      const customer = input.customer;
      if (!customer) return emptyResult("Indicá un cliente para buscar entregas.");
      return searchDeliveriesRuntime({ customer, limit: input.limit });
    },

    getDeliveriesByDateRange(input: DateRangeInput = {}): CreamyToolResult {
      if (!canCreamyAccessDomain(actorSectorId, "deliveries")) return denied("deliveries");
      return searchDeliveriesRuntime(input);
    },

    getApplicationHelp(input: SearchInput = {}): CreamyToolResult<HelpCatalogEntry> {
      if (!canCreamyAccessDomain(actorSectorId, "help")) return denied("help");
      const limit = clampLimit(input.limit);
      const results = HELP_CATALOG.filter((entry) =>
        includesQuery([entry.label, entry.text, ...entry.keywords], input.query)
      ).slice(0, limit);
      const navActions = buildNavActionsFromHelp(results, availableNav);
      return {
        results,
        localOnly: true,
        sources: results.map((entry) => ({ type: "help", id: entry.id, label: entry.label })),
        navActions: navActions.length ? navActions : undefined,
        message: results.length ? undefined : "No encontré una guía para esa consulta.",
      };
    },

    getElaborationWork(input: ElaborationWorkInput = {}): CreamyToolResult {
      if (!canCreamyAccessDomain(actorSectorId, "works")) return denied("works");
      const now = new Date().toISOString().slice(0, 10);
      const limit = clampLimit(input.limit);
      const results = workItems
        .filter((item) => canSeeWorkItem(actorSectorId, item))
        .filter((item) => item.sector === "ELABORACION" || item.ownerSector === "ELABORACION")
        .filter((item) => !input.status || item.status === input.status)
        .filter((item) => {
          if (input.onlyToday) {
            return item.plannedDate?.slice(0, 10) === now || item.deliveryDate?.slice(0, 10) === now;
          }
          if (input.onlyPlanned) {
            const d = item.plannedDate ?? item.deliveryDate;
            return d != null && d.slice(0, 10) >= now;
          }
          return true;
        })
        .slice(0, limit);
      return {
        results: results.map(workResult),
        localOnly: true,
        sources: sourceUnique(results.map(workSource)),
        message: results.length ? undefined : "No encontré trabajos de Elaboración con esos filtros en el snapshot local.",
      };
    },

    getElaborationWorkByOperator(input: ElaborationWorkByOperatorInput): CreamyToolResult {
      if (!canCreamyAccessDomain(actorSectorId, "works")) return denied("works");
      if (!input.ownerPerson?.trim()) {
        return emptyResult("Indicá el nombre del operador para buscar sus trabajos.");
      }
      const limit = clampLimit(input.limit);
      const results = workItems
        .filter((item) => canSeeWorkItem(actorSectorId, item))
        .filter((item) => item.sector === "ELABORACION" || item.ownerSector === "ELABORACION")
        .filter((item) => includesQuery([item.ownerPerson], input.ownerPerson))
        .filter((item) => !input.status || item.status === input.status)
        .slice(0, limit);
      return {
        results: results.map(workResult),
        localOnly: true,
        sources: sourceUnique(results.map(workSource)),
        message: results.length
          ? undefined
          : `No encontré trabajos de Elaboración para el operador "${input.ownerPerson}" en el snapshot local.`,
      };
    },

    getProductFormulaOrBOM(input: FormulaInput): CreamyToolResult {
      if (!canCreamyAccessDomain(actorSectorId, "works") && !canCreamyAccessDomain(actorSectorId, "rawMaterials")) {
        return denied("rawMaterials");
      }
      if (!input.product?.trim()) {
        return emptyResult("Indicá el nombre del producto para buscar su fórmula.");
      }
      // Prefer snapshot formulas first
      const snapshotFormula = snapshot?.formulas?.find((f) =>
        normalizeText(f.product).includes(normalizeText(input.product))
      );
      const formula = snapshotFormula ?? getFormulaForProduct(input.product);
      if (!formula) {
        return emptyResult(`No se encontró fórmula para "${input.product}" en los datos locales.`);
      }
      return {
        results: [
          {
            product: formula.product,
            estimated: formula.estimated,
            lines: formula.lines,
            localOnly: true,
            warning: formula.estimated
              ? "Fórmula estimada automáticamente — no es una BOM oficial cargada."
              : undefined,
          },
        ],
        localOnly: true,
        sources: [{ type: "work", id: `formula:${formula.product}`, label: `Fórmula · ${formula.product}` }],
        message: undefined,
      };
    },

    checkProductFormulaAvailability(input: FormulaAvailabilityInput): CreamyToolResult {
      if (!canCreamyAccessDomain(actorSectorId, "rawMaterials")) return denied("rawMaterials");
      if (!input.product?.trim()) {
        return emptyResult("Indicá el producto para verificar disponibilidad de su fórmula.");
      }
      const snapshotFormula = snapshot?.formulas?.find((f) =>
        normalizeText(f.product).includes(normalizeText(input.product))
      );
      const formula = snapshotFormula ?? getFormulaForProduct(input.product);
      if (!formula) {
        return emptyResult(`No se encontró fórmula para "${input.product}".`);
      }
      const lines = formula.lines.map((line) => {
        const matches = rawMaterials.filter((mp) =>
          normalizeText(mp.codigo).includes(normalizeText(line.codigo)) ||
          normalizeText(mp.nombre).includes(normalizeText(line.nombre))
        );
        const totalDisponible = matches.reduce((sum, mp) => sum + mp.cantidad, 0);
        return {
          codigo: line.codigo,
          nombre: line.nombre,
          cantidadRequerida: line.cantidadRequerida,
          unidad: line.unidad,
          totalDisponible,
          suficiente: totalDisponible >= line.cantidadRequerida,
          lotes: matches.slice(0, 3).map((mp) => ({
            id: mp.id,
            lote: mp.lote,
            cantidad: mp.cantidad,
            unidad: mp.unidad,
            vencimientoLabel: formatDate(mp.vencimiento),
          })),
        };
      });
      const allSufficient = lines.every((l) => l.suficiente);
      const sources = sourceUnique(
        rawMaterials
          .filter((mp) =>
            formula.lines.some(
              (l) =>
                normalizeText(mp.codigo).includes(normalizeText(l.codigo)) ||
                normalizeText(mp.nombre).includes(normalizeText(l.nombre))
            )
          )
          .slice(0, MAX_TOOL_RESULTS)
          .map(rawMaterialSource)
      );
      return {
        results: [
          {
            product: formula.product,
            estimated: formula.estimated,
            allSufficient,
            lines,
            warning: formula.estimated ? "Fórmula estimada — verificar con BOM oficial." : undefined,
          },
        ],
        localOnly: true,
        sources,
        message: allSufficient
          ? `Stock local aparentemente suficiente para ${formula.product}.`
          : `Hay ingredientes con stock insuficiente para ${formula.product}. Revisá con Materia Prima.`,
      };
    },

    getPreviousElaborationObservations(input: ElaborationObservationsInput = {}): CreamyToolResult {
      if (!canCreamyAccessDomain(actorSectorId, "works")) return denied("works");
      const limit = clampLimit(input.limit);
      const results = workItems
        .filter((item) => canSeeWorkItem(actorSectorId, item))
        .filter((item) => item.sector === "ELABORACION" || item.ownerSector === "ELABORACION")
        .filter((item) => item.status === "completo" || item.status === "revision")
        .filter((item) => !input.product || includesQuery([item.product], input.product))
        .filter((item) => !input.ownerPerson || includesQuery([item.ownerPerson], input.ownerPerson))
        .filter((item) => item.operationalObservation || item.notes)
        .slice(0, limit);
      return {
        results: results.map((item) => ({
          id: item.id,
          product: item.product,
          ownerPerson: item.ownerPerson,
          plannedDateLabel: formatDate(item.plannedDate),
          status: item.status,
          operationalObservation: item.operationalObservation,
          notes: item.notes,
        })),
        localOnly: true,
        sources: sourceUnique(results.map(workSource)),
        message: results.length
          ? undefined
          : "No encontré observaciones anteriores de Elaboración con esos filtros.",
      };
    },

    searchApprovedSubstitutions(input: SubstitutionSearchToolInput = {}): CreamyToolResult {
      if (!canCreamyAccessDomain(actorSectorId, "substitutions")) return denied("substitutions");
      // Prefer snapshot substitutions, fall back to live repository
      const sourceData = snapshot?.substitutions;
      let results;
      if (sourceData) {
        const q = normalizeText(input.query);
        const product = normalizeText(input.product);
        const codigo = normalizeText(input.originalCodigo);
        results = sourceData.filter((s) => {
          if (product && s.products.length > 0 && !s.products.some((p) => normalizeText(p).includes(product))) return false;
          if (codigo && !normalizeText(s.originalCodigo).includes(codigo)) return false;
          if (q && !includesQuery([s.originalCodigo, s.originalNombre, s.substituteCodigo, s.substituteNombre, s.motivo, s.notes, ...s.products], q)) return false;
          return true;
        });
      } else {
        results = searchSubstitutions({
          originalCodigo: input.originalCodigo,
          product: input.product,
          query: input.query,
        });
      }
      const limited = results.slice(0, clampLimit(input.limit));
      return {
        results: limited,
        localOnly: true,
        sources: limited.map((s) => ({
          type: "raw_material" as const,
          id: s.id,
          label: `Sustitución: ${s.originalCodigo} → ${s.substituteCodigo}`,
        })),
        message: limited.length
          ? undefined
          : "No se encontraron sustituciones aprobadas y vigentes para esa búsqueda. No uses alternativas no listadas.",
      };
    },

    getElaborationOrder(input: ElaborationOrderInput = {}): CreamyToolResult {
      if (!canCreamyAccessDomain(actorSectorId, "orders_oe")) return denied("orders_oe");
      const limit = clampLimit(input.limit);
      const results = orders
        .filter((order) => order.kind === "OE")
        .filter((order) => canSeeOrder(actorSectorId, order))
        .filter((order) => !input.ref || normalizeText(order.ref) === normalizeText(input.ref))
        .filter((order) =>
          includesQuery(
            [
              order.id,
              order.ref,
              order.cliente,
              order.producto,
              ...order.documents.flatMap((doc) => [doc.fileName, doc.producto, doc.cliente, doc.lote]),
            ],
            input.query
          )
        )
        .slice(0, limit);
      return {
        results: results.map(orderResult),
        localOnly: true,
        sources: sourceUnique(results.map(orderSource)),
        message: results.length ? undefined : "No encontré OEs visibles con esos filtros.",
      };
    },

    async rememberOperationalFact(input: RememberOperationalFactInput): Promise<CreamyToolResult> {
      if (!actorEmail) {
        return emptyResult("Falta el email del actor de sesión para registrar un dato operativo.");
      }
      const candidates = [input.client, input.product, input.productCode, input.materiaPrimaOriginal, input.materiaPrimaUtilizada];
      if (candidates.some(isTestLikeValue)) {
        return emptyResult("No se registran datos operativos con valores de prueba (TEST_).");
      }
      try {
        const service = getCreamyMemoryService();
        const payload: CreateOperationalMemoryInput = {
          client: input.client,
          product: input.product,
          productCode: input.productCode,
          materiaPrimaOriginal: input.materiaPrimaOriginal,
          materiaPrimaUtilizada: input.materiaPrimaUtilizada,
          codigoMpOriginal: input.codigoMpOriginal,
          codigoMpUtilizado: input.codigoMpUtilizado,
          motivo: input.motivo,
          observacion: input.observacion,
          cantidadOProporcion: input.cantidadOProporcion,
          relatedOrderRef: input.relatedOrderRef,
          relatedOrderId: input.relatedOrderId,
          fecha: input.fecha,
        };
        const { memory, deduped } = await service.createOperationalMemory(
          { email: actorEmail, sector: actorSectorId },
          payload
        );
        return {
          results: [{ id: memory.id, estado: memory.estado, deduped }],
          localOnly: false,
          sources: [{ type: "help", id: memory.id, label: `Memoria operativa · ${memory.product}` }],
          message: deduped
            ? `Ya existía un reporte para esta combinación; actualicé el motivo/observación (estado ${memory.estado}, id ${memory.id}).`
            : `Registrado como REPORTADA — pendiente de validación por Calidad, Producción o Dirección (id ${memory.id}).`,
        };
      } catch (err) {
        return emptyResult(
          err instanceof Error ? err.message : "No se pudo registrar el dato operativo en este momento."
        );
      }
    },

    async searchOperationalMemories(input: SearchOperationalMemoriesInput = {}): Promise<CreamyToolResult> {
      try {
        const service = getCreamyMemoryService();
        const limit = clampLimit(input.limit);
        const memories = await service.searchOperationalMemories(
          { email: actorEmail ?? "", sector: actorSectorId },
          { client: input.client, product: input.product, productCode: input.productCode, limit }
        );
        const contradictions = service.detectContradictions(memories);
        const results = memories.map((memory) => ({
          id: memory.id,
          client: memory.client,
          product: memory.product,
          productCode: memory.productCode,
          materiaPrimaOriginal: memory.materiaPrimaOriginal,
          materiaPrimaUtilizada: memory.materiaPrimaUtilizada,
          motivo: memory.motivo,
          observacion: memory.observacion,
          estado: memory.estado,
          fuente: memory.fuente,
          informadoPor: memory.informadoPor,
          fechaLabel: formatDate(memory.fecha),
        }));
        return {
          results,
          localOnly: false,
          sources: results.map((r) => ({ type: "help" as const, id: r.id, label: `Memoria operativa · ${r.product}` })),
          message: results.length
            ? contradictions.length
              ? "Hay reportes contradictorios para este cliente/producto (distinta MP utilizada) — verificá con Calidad antes de asumir cuál aplica."
              : undefined
            : "No encontré memoria operativa registrada para esos filtros.",
        };
      } catch (err) {
        return emptyResult(
          err instanceof Error ? err.message : "No se pudo consultar la memoria operativa en este momento."
        );
      }
    },

    async searchOrdersForCreamy(input: SearchOrdersForCreamyInput = {}): Promise<CreamyToolResult> {
      if (!actorEmail) {
        return emptyResult("Falta el email del actor de sesión para buscar órdenes.");
      }
      try {
        const ordersService = getOrdersService();
        const actor: OrdersActor = { email: actorEmail, sector: actorSectorId, displayName: actorEmail };
        const limit = Math.min(MAX_ORDER_TOOL_RESULTS, clampLimit(input.limit));
        const { items } = await ordersService.listOrders(
          {
            type: input.type,
            search: input.query,
            product: input.product,
            client: input.client,
            sort: "updated_desc",
            pageSize: limit,
          },
          actor
        );
        const filtered = items
          .filter(
            (order) =>
              !isTestLikeValue(order.client) &&
              !isTestLikeValue(order.product) &&
              !isTestLikeValue(order.code) &&
              !isTestLikeValue(order.orderNumber)
          )
          .slice(0, limit)
          .map((order) => ({
            orderNumber: order.orderNumber,
            client: order.client,
            product: order.product,
            code: order.code,
            lot: order.lot,
            status: order.status,
            dateLabel: formatDate(order.createdAt),
          }));
        return {
          results: filtered,
          localOnly: false,
          sources: filtered.map((order) => ({
            type: "order" as const,
            id: order.orderNumber,
            label: `${order.orderNumber} · ${order.product}`,
          })),
          message: filtered.length ? undefined : "No encontré órdenes visibles con esos filtros.",
        };
      } catch (err) {
        if (err instanceof OrdersUnavailableError) {
          return emptyResult("Órdenes no disponibles en este entorno (falta base de datos).");
        }
        return emptyResult(err instanceof Error ? err.message : "No pude consultar órdenes en este momento.");
      }
    },

    async getOrderSummaryForCreamy(input: GetOrderSummaryForCreamyInput = {}): Promise<CreamyToolResult> {
      if (!actorEmail) {
        return emptyResult("Falta el email del actor de sesión para buscar la orden.");
      }
      if (!input.id && !input.ref?.trim()) {
        return emptyResult("Indicá el id o la referencia (ej: OE-123) de la orden.");
      }
      try {
        const ordersService = getOrdersService();
        const actor: OrdersActor = { email: actorEmail, sector: actorSectorId, displayName: actorEmail };
        let order = input.id ? await ordersService.getOrder(input.id, actor) : null;
        if (!order && input.ref?.trim()) {
          const { items } = await ordersService.listOrders({ search: input.ref.trim(), pageSize: 5 }, actor);
          order =
            items.find((o) => normalizeText(o.orderNumber) === normalizeText(input.ref)) ?? items[0] ?? null;
        }
        if (!order) return emptyResult("No encontré esa orden o no tenés acceso.");
        if (
          isTestLikeValue(order.client) ||
          isTestLikeValue(order.product) ||
          isTestLikeValue(order.code) ||
          isTestLikeValue(order.orderNumber)
        ) {
          return emptyResult("Esa orden es de datos de prueba y no está disponible para Creamy.");
        }
        if (order.status === "ANULADA" && !input.includeAnnulled) {
          return emptyResult("Esa orden está anulada. Pedí explícitamente incluir anuladas si la necesitás igual.");
        }
        const materials =
          order.type === "OE"
            ? ((order.formData as OeContent).materials ?? []).map((m) => ({
                codigo: m.codigo,
                materiaPrima: m.materiaPrima,
              }))
            : ((order.formData as OaContent).materials ?? []).map((m) => ({
                codigo: m.codigo,
                nombreInsumo: m.nombreInsumo,
              }));
        const observacion =
          order.type === "OA" ? (order.formData as OaContent).observaciones?.slice(0, 300) || null : null;
        return {
          results: [
            {
              orderNumber: order.orderNumber,
              type: order.type,
              client: order.client,
              product: order.product,
              code: order.code,
              lot: order.lot,
              status: order.status,
              materials: materials.slice(0, 20),
              observacion,
            },
          ],
          localOnly: false,
          sources: [{ type: "order", id: order.orderNumber, label: `${order.type} ${order.orderNumber}` }],
        };
      } catch (err) {
        if (err instanceof OrdersUnavailableError) {
          return emptyResult("Órdenes no disponibles en este entorno (falta base de datos).");
        }
        if (err instanceof OrdersNotFoundError) return emptyResult("No encontré esa orden.");
        if (err instanceof OrdersForbiddenError) return emptyResult("No tenés acceso a esa orden.");
        return emptyResult(err instanceof Error ? err.message : "No pude consultar la orden en este momento.");
      }
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
    searchDeliveries: tool({
      description: "Busca entregas por texto, cliente, producto, lote, código o rango de fechas.",
      inputSchema: jsonSchema<DeliverySearchInput>({
        type: "object",
        properties: {
          query: { type: "string" },
          customer: { type: "string" },
          product: { type: "string" },
          lote: { type: "string" },
          codigo: { type: "string" },
          fromDate: { type: "string", description: "YYYY-MM-DD" },
          toDate: { type: "string", description: "YYYY-MM-DD" },
          includeArchived: { type: "boolean" },
          limit: { type: "number", maximum: MAX_TOOL_RESULTS },
        },
        additionalProperties: false,
      }),
      execute: (toolInput) => runtime.searchDeliveries(toolInput),
    }),
    getPendingDeliveries: tool({
      description: "Lista trabajos aprobados por Calidad que todavía no fueron entregados.",
      inputSchema: jsonSchema<SearchInput>({
        type: "object",
        properties: {
          query: { type: "string" },
          limit: { type: "number", maximum: MAX_TOOL_RESULTS },
        },
        additionalProperties: false,
      }),
      execute: (toolInput) => runtime.getPendingDeliveries(toolInput),
    }),
    getLateDeliveries: tool({
      description: "Devuelve entregas realizadas fuera de fecha, opcionalmente por rango.",
      inputSchema: jsonSchema<DateRangeInput>({
        type: "object",
        properties: {
          fromDate: { type: "string", description: "YYYY-MM-DD" },
          toDate: { type: "string", description: "YYYY-MM-DD" },
          limit: { type: "number", maximum: MAX_TOOL_RESULTS },
        },
        additionalProperties: false,
      }),
      execute: (toolInput) => runtime.getLateDeliveries(toolInput),
    }),
    getDeliveriesByCustomer: tool({
      description: "Lista entregas de un cliente.",
      inputSchema: jsonSchema<CustomerInput>({
        type: "object",
        properties: {
          customer: { type: "string" },
          limit: { type: "number", maximum: MAX_TOOL_RESULTS },
        },
        additionalProperties: false,
      }),
      execute: (toolInput) => runtime.getDeliveriesByCustomer(toolInput),
    }),
    getDeliveriesByDateRange: tool({
      description: "Lista entregas dentro de un rango de fechas.",
      inputSchema: jsonSchema<DateRangeInput>({
        type: "object",
        properties: {
          fromDate: { type: "string", description: "YYYY-MM-DD" },
          toDate: { type: "string", description: "YYYY-MM-DD" },
          limit: { type: "number", maximum: MAX_TOOL_RESULTS },
        },
        additionalProperties: false,
      }),
      execute: (toolInput) => runtime.getDeliveriesByDateRange(toolInput),
    }),
    getApplicationHelp: tool({
      description: "Devuelve ayuda estática de uso de Genus OS, con instrucciones paso a paso.",
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
    getElaborationWork: tool({
      description:
        "Lista trabajos visibles del sector Elaboración. Soporta filtro por estado, solo hoy o solo planificados.",
      inputSchema: jsonSchema<ElaborationWorkInput>({
        type: "object",
        properties: {
          status: { type: "string", description: "pendiente | en_curso | completo | revision | cancelado" },
          onlyToday: { type: "boolean" },
          onlyPlanned: { type: "boolean" },
          limit: { type: "number", maximum: MAX_TOOL_RESULTS },
        },
        additionalProperties: false,
      }),
      execute: (toolInput) => runtime.getElaborationWork(toolInput),
    }),
    getElaborationWorkByOperator: tool({
      description: "Lista trabajos de Elaboración asignados a un operador (ownerPerson).",
      inputSchema: jsonSchema<ElaborationWorkByOperatorInput>({
        type: "object",
        required: ["ownerPerson"],
        properties: {
          ownerPerson: { type: "string" },
          status: { type: "string" },
          limit: { type: "number", maximum: MAX_TOOL_RESULTS },
        },
        additionalProperties: false,
      }),
      execute: (toolInput) => runtime.getElaborationWorkByOperator(toolInput),
    }),
    getProductFormulaOrBOM: tool({
      description:
        "Devuelve la fórmula/BOM (lista de materias primas) para un producto. Puede ser estimada si no hay BOM oficial cargada.",
      inputSchema: jsonSchema<FormulaInput>({
        type: "object",
        required: ["product"],
        properties: {
          product: { type: "string" },
        },
        additionalProperties: false,
      }),
      execute: (toolInput) => runtime.getProductFormulaOrBOM(toolInput),
    }),
    checkProductFormulaAvailability: tool({
      description:
        "Verifica si hay stock local suficiente de todas las materias primas de la fórmula de un producto.",
      inputSchema: jsonSchema<FormulaAvailabilityInput>({
        type: "object",
        required: ["product"],
        properties: {
          product: { type: "string" },
        },
        additionalProperties: false,
      }),
      execute: (toolInput) => runtime.checkProductFormulaAvailability(toolInput),
    }),
    getPreviousElaborationObservations: tool({
      description:
        "Devuelve observaciones y notas de trabajos completados/en revisión de Elaboración, filtrable por producto u operador.",
      inputSchema: jsonSchema<ElaborationObservationsInput>({
        type: "object",
        properties: {
          product: { type: "string" },
          ownerPerson: { type: "string" },
          limit: { type: "number", maximum: MAX_TOOL_RESULTS },
        },
        additionalProperties: false,
      }),
      execute: (toolInput) => runtime.getPreviousElaborationObservations(toolInput),
    }),
    searchApprovedSubstitutions: tool({
      description:
        "Busca sustituciones de materias primas aprobadas y vigentes. Solo retorna datos autorizados; nunca inventa alternativas.",
      inputSchema: jsonSchema<SubstitutionSearchToolInput>({
        type: "object",
        properties: {
          originalCodigo: { type: "string", description: "Código MP original ej: MP-035" },
          product: { type: "string", description: "Producto al que aplica la sustitución" },
          query: { type: "string", description: "Texto libre" },
          limit: { type: "number", maximum: MAX_TOOL_RESULTS },
        },
        additionalProperties: false,
      }),
      execute: (toolInput) => runtime.searchApprovedSubstitutions(toolInput),
    }),
    getElaborationOrder: tool({
      description: "Busca Órdenes de Elaboración (OE) visibles por referencia o texto.",
      inputSchema: jsonSchema<ElaborationOrderInput>({
        type: "object",
        properties: {
          ref: { type: "string", description: "Número de OE ej: OE-123" },
          query: { type: "string" },
          limit: { type: "number", maximum: MAX_TOOL_RESULTS },
        },
        additionalProperties: false,
      }),
      execute: (toolInput) => runtime.getElaborationOrder(toolInput),
    }),
    rememberOperationalFact: tool({
      description:
        "Registra un hecho operativo (ej: sustitución de MP usada en la práctica) como REPORTADA, pendiente de validación por Calidad/Producción/Dirección. Nunca queda auto-validado.",
      inputSchema: jsonSchema<RememberOperationalFactInput>({
        type: "object",
        required: ["client", "product", "materiaPrimaOriginal", "materiaPrimaUtilizada", "motivo"],
        properties: {
          client: { type: "string" },
          product: { type: "string" },
          productCode: { type: "string" },
          materiaPrimaOriginal: { type: "string", description: "MP que indica la fórmula/orden original" },
          materiaPrimaUtilizada: { type: "string", description: "MP realmente utilizada" },
          codigoMpOriginal: { type: "string" },
          codigoMpUtilizado: { type: "string" },
          motivo: { type: "string" },
          observacion: { type: "string" },
          cantidadOProporcion: { type: "string" },
          relatedOrderRef: { type: "string", description: "Ej: OE-123" },
          relatedOrderId: { type: "string" },
          fecha: { type: "string", description: "YYYY-MM-DD" },
        },
        additionalProperties: false,
      }),
      execute: (toolInput) => runtime.rememberOperationalFact(toolInput),
    }),
    searchOperationalMemories: tool({
      description:
        "Busca memoria operativa compartida (hechos reportados por cualquier sector) por cliente, producto o código. Excluye REVOCADA por default y avisa si hay reportes contradictorios.",
      inputSchema: jsonSchema<SearchOperationalMemoriesInput>({
        type: "object",
        properties: {
          client: { type: "string" },
          product: { type: "string" },
          productCode: { type: "string" },
          limit: { type: "number", maximum: MAX_TOOL_RESULTS },
        },
        additionalProperties: false,
      }),
      execute: (toolInput) => runtime.searchOperationalMemories(toolInput),
    }),
    searchOrdersForCreamy: tool({
      description:
        "Busca órdenes OE/OA persistidas (Neon) por texto, cliente o producto. Devuelve resúmenes cortos (sin fórmulas), máximo 5.",
      inputSchema: jsonSchema<SearchOrdersForCreamyInput>({
        type: "object",
        properties: {
          query: { type: "string" },
          client: { type: "string" },
          product: { type: "string" },
          type: { type: "string", enum: ["OE", "OA"] },
          limit: { type: "number", maximum: MAX_ORDER_TOOL_RESULTS },
        },
        additionalProperties: false,
      }),
      execute: (toolInput) => runtime.searchOrdersForCreamy(toolInput),
    }),
    getOrderSummaryForCreamy: tool({
      description:
        "Devuelve el resumen de una orden OE/OA persistida por id o referencia (ej: OE-123): materiales (código/nombre, sin porcentajes ni cantidades de fórmula) y una observación corta.",
      inputSchema: jsonSchema<GetOrderSummaryForCreamyInput>({
        type: "object",
        properties: {
          id: { type: "string" },
          ref: { type: "string", description: "Ej: OE-123 u OA-45" },
          includeAnnulled: { type: "boolean" },
        },
        additionalProperties: false,
      }),
      execute: (toolInput) => runtime.getOrderSummaryForCreamy(toolInput),
    }),
  };
}
