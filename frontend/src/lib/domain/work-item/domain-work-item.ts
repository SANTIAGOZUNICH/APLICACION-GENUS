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
  branchOwner: string | null;
  sectorLead: string | null;

  dayLabel: string | null;
  weekLabel: string | null;
  date: string | null;

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
  sourceRanges: Partial<Record<AttributeSource, string>>;
}

export function createEmptyDomainWorkItem(internalId: string): DomainWorkItem {
  return {
    internalId,
    op: null,
    loteRef: null,
    sector: null,
    ownerSector: null,
    line: null,
    branchOwner: null,
    sectorLead: null,
    dayLabel: null,
    weekLabel: null,
    date: null,
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
  };
}
