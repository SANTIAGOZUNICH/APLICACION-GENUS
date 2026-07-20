import type { SectorId } from "@/types/operational/sector";
import type { WorkItemPriority, WorkItemStatus } from "@/types/operational/work-item";
import type { QualityDecisionStatus, QualityItemKind } from "@/features/os/operational/types";
import type { MateriaPrimaEstado } from "@/features/os/operational/adapters/materia-prima-repository";
import type { OrderDocumentKind } from "@/features/os/operational/lib/order-documents-rbac";

export type CreamyChatRole = "user" | "assistant";

export interface CreamyChatMessage {
  id: string;
  role: CreamyChatRole;
  content: string;
  createdAt: string;
  sources?: SourceCitation[];
  usedTools?: string[];
}

export type SourceCitationType =
  | "work"
  | "lot"
  | "raw_material"
  | "order"
  | "quality"
  | "delivery"
  | "help";

export interface SourceCitation {
  type: SourceCitationType;
  id: string;
  label: string;
}

export interface CreamyWorkItemSummary {
  id: string;
  sector: SectorId;
  ownerSector: SectorId;
  ownerPerson: string | null;
  client: string | null;
  product: string | null;
  quantity: string | null;
  unit: string | null;
  line: string | null;
  plannedDate: string | null;
  deliveryDate: string | null;
  status: WorkItemStatus;
  priority: WorkItemPriority | null;
  pedidoRef: string | null;
  oeRef: string | null;
  oaRef: string | null;
  loteRef: string | null;
  notes: string | null;
  finishedQty?: string | null;
  operationalObservation?: string | null;
}

export interface CreamyLotSummary {
  id: string;
  lote: string;
  fecha: string;
  producto: string;
  codigo: string;
  marca: string;
  cantidades: number;
  vto: string | null;
  muestras: string;
  cjMuestra: string;
  fechaAnalisis: string | null;
  observaciones: string;
}

export interface CreamyRawMaterialSummary {
  id: string;
  codigo: string;
  nombre: string;
  lote: string;
  proveedor: string;
  cantidad: number;
  unidad: string;
  vencimiento: string | null;
  ubicacion: string;
  observaciones: string;
  estado: MateriaPrimaEstado;
}

export interface CreamyOrderDocumentSummary {
  id: string;
  kind: OrderDocumentKind;
  ref: string;
  producto?: string;
  codigo?: string;
  cliente?: string;
  lote?: string;
  fecha?: string;
  observaciones?: string;
  fileName: string;
  fileType: string;
  uploadedBy: string;
  uploadedAt: string;
  version: number;
  sectorUploaded?: string;
  linkedWorkItemId?: string | null;
}

export interface CreamyOrderSummary {
  id: string;
  kind: OrderDocumentKind;
  ref: string;
  fecha: string | null;
  deliveryDate: string | null;
  cliente: string | null;
  producto: string | null;
  cantidad: string | null;
  sectorIds: SectorId[];
  workItemIds: string[];
  documents: CreamyOrderDocumentSummary[];
}

export interface CreamyQualityPendingSummary {
  id: string;
  kind: QualityItemKind;
  lote: string | null;
  product: string;
  client: string;
  oe: string | null;
  oa: string | null;
  line: string | null;
  quantity: string | null;
  dayLabel: string;
  deliveryDate: string | null;
  status: QualityDecisionStatus;
  relatedWorkItemId: string | null;
  receivedFrom: SectorId | null;
  completedAt: string | null;
  completedBy: string | null;
  observation: string | null;
}

export interface CreamyDeliverySummary {
  id: string;
  workItemId: string;
  qualityItemId: string | null;
  product: string;
  codigo: string | null;
  client: string | null;
  lote: string | null;
  sourceSector: SectorId;
  quantity: string | null;
  unit: string | null;
  plannedDeliveryDate: string | null;
  actualDeliveredAt: string;
  remito: string | null;
  receivedBy: string | null;
  observations: string | null;
  status: "ENTREGADO" | "ANULADO" | "REGISTRO_ELIMINADO";
  archived: boolean;
}

export interface CreamyFormulaLineSummary {
  codigo: string;
  nombre: string;
  cantidadRequerida: number;
  unidad: string;
}

export interface CreamyFormulaSummary {
  product: string;
  estimated: boolean;
  lines: CreamyFormulaLineSummary[];
}

export interface CreamySubstitutionSummary {
  id: string;
  originalCodigo: string;
  originalNombre: string;
  substituteCodigo: string;
  substituteNombre: string;
  products: string[];
  motivo: string;
  approvedBy: string;
  approvedAt: string;
  expiresAt: string | null;
  notes: string | null;
}

export interface CreamyLocalSnapshot {
  capturedAt: string;
  source: "local_browser";
  actorSectorId: SectorId;
  limits: {
    workItems: number;
    lots: number;
    rawMaterials: number;
    orders: number;
    qualityPending: number;
    deliveries: number;
  };
  workItems: CreamyWorkItemSummary[];
  lots: CreamyLotSummary[];
  rawMaterials: CreamyRawMaterialSummary[];
  orders: CreamyOrderSummary[];
  qualityPending: CreamyQualityPendingSummary[];
  deliveries: CreamyDeliverySummary[];
  /** Formula/BOM summaries for elaboration work products. */
  formulas?: CreamyFormulaSummary[];
  /** Active approved MP substitutions visible to actor sector. */
  substitutions?: CreamySubstitutionSummary[];
  notes: string[];
}

export interface AssistantApiMessage {
  role: CreamyChatRole;
  content: string;
}

export interface AssistantChatRequest {
  messages: AssistantApiMessage[];
  actorSectorId: SectorId;
  snapshot?: CreamyLocalSnapshot;
}

export interface AssistantChatResponse {
  reply: string;
  sources: SourceCitation[];
  usedTools: string[];
  /** Non-secret provider info for diagnostics. */
  provider?: string;
  model?: string;
}
