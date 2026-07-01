import type { EntityStatusFlowStep } from "@/types/entity-page";

/** Shared OE/OA production order flow. */
export const PRODUCTION_ORDER_FLOW: readonly EntityStatusFlowStep[] = [
  { id: "planificada", label: "Planificada" },
  { id: "en-curso", label: "En curso" },
  { id: "cerrada", label: "Cerrada" },
  { id: "liberada", label: "Liberada" },
] as const;

/** Lote quality disposition flow. */
export const LOTE_FLOW: readonly EntityStatusFlowStep[] = [
  { id: "cuarentena", label: "Cuarentena" },
  { id: "analisis", label: "Análisis" },
  { id: "disposicion", label: "Disposición" },
  { id: "liberado", label: "Liberado" },
] as const;

/** Pedido fulfillment flow. */
export const PEDIDO_FLOW: readonly EntityStatusFlowStep[] = [
  { id: "pendiente", label: "Pendiente" },
  { id: "en-produccion", label: "En producción" },
  { id: "parcial", label: "Parcial" },
  { id: "completo", label: "Completo" },
] as const;

/** Liberación signature flow. */
export const LIBERACION_FLOW: readonly EntityStatusFlowStep[] = [
  { id: "borrador", label: "Borrador" },
  { id: "esperando-firma", label: "Esperando firma" },
  { id: "firmada", label: "Firmada" },
] as const;
