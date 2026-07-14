import type { SectorId } from "@/types/operational/sector";
import type { AttributeSource } from "@/lib/domain/work-item/attribute-sources";
import type {
  OriginStage,
  WorkItemConfidence,
  WorkItemPriority,
  WorkItemStatus,
} from "@/types/operational/work-item";

/** Entidad de dominio — independiente de Google Sheets. */
export interface DomainWorkItem {
  internalId: string;

  op: string | null;
  loteRef: string | null;

  sector: SectorId | null;
  ownerSector: SectorId | null;
  line: string | null;
  /** True si el bloque del sheet define L1–L4 entre sector y la fila del slot. */
  lineExpectedInSheet: boolean | null;
  branchOwner: string | null;
  sectorLead: string | null;

  dayLabel: string | null;
  dayOfWeek: string | null;
  weekLabel: string | null;
  weekStart: string | null;
  weekId: string | null;
  date: string | null;
  plannedDate: string | null;
  /** Rango A1 del encabezado de fecha (ej. ELABORACION!D585). */
  dateHeaderSourceRange: string | null;
  /** Cómo se resolvió plannedDate desde el planner. */
  dateResolutionMethod:
    | "native_date"
    | "full_human_header"
    | "split_header"
    | "inherited_week_context"
    | null;

  plannedClient: string | null;
  plannedProduct: string | null;
  plannedQuantity: string | null;
  notes: string | null;

  client: string | null;
  product: string | null;
  quantity: string | null;
  unit: string | null;
  estado: string | null;
  responsable: string | null;
  sectorComercial: "M" | "P" | null;

  oeRef: string | null;
  oaRef: string | null;
  rl: string | null;
  estadoCalidad: string | null;
  fechaAnalisis: string | null;
  numeroAnalisis: string | null;
  observacionCalidad: string | null;

  originStage: OriginStage | null;
  status: WorkItemStatus;
  priority: WorkItemPriority | null;
  deliveryDate: string | null;

  confidence: WorkItemConfidence;
  enrichmentSources: AttributeSource[];
  sourceFileIds: Partial<Record<AttributeSource, string>>;
  /** Fila de cierre del slot columnar (no asumir = cantidad). */
  sourceRanges: Partial<Record<AttributeSource, string>>;
  sourceProductRanges: Partial<Record<AttributeSource, string>>;
  sourceQuantityRanges: Partial<Record<AttributeSource, string>>;
}

export function createEmptyDomainWorkItem(internalId: string): DomainWorkItem {
  return {
    internalId,
    op: null,
    loteRef: null,
    sector: null,
    ownerSector: null,
    line: null,
    lineExpectedInSheet: null,
    branchOwner: null,
    sectorLead: null,
    dayLabel: null,
    dayOfWeek: null,
    weekLabel: null,
    weekStart: null,
    weekId: null,
    date: null,
    plannedDate: null,
    dateHeaderSourceRange: null,
    dateResolutionMethod: null,
    plannedClient: null,
    plannedProduct: null,
    plannedQuantity: null,
    notes: null,
    client: null,
    product: null,
    quantity: null,
    unit: null,
    estado: null,
    responsable: null,
    sectorComercial: null,
    oeRef: null,
    oaRef: null,
    rl: null,
    estadoCalidad: null,
    fechaAnalisis: null,
    numeroAnalisis: null,
    observacionCalidad: null,
    originStage: null,
    status: "pendiente",
    priority: null,
    deliveryDate: null,
    confidence: "low",
    enrichmentSources: [],
    sourceFileIds: {},
    sourceRanges: {},
    sourceProductRanges: {},
    sourceQuantityRanges: {},
  };
}
