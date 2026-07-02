import { defineWorkflowStage } from "@/lib/workflow-engine/workflow-definition";
import type { WorkflowStageDefinition, WorkflowStageId } from "@/lib/workflow-engine/types";

export const WORKFLOW_STAGE_DEFINITIONS: WorkflowStageDefinition[] = [
  defineWorkflowStage({
    id: "COMERCIAL",
    title: "Comercial",
    description: "Ingreso de pedidos, compromisos con clientes y ventana de entrega.",
    previousStages: [],
    nextStages: ["PLANIFICACION"],
    dependsOn: ["Pedido confirmado por cliente"],
    generates: ["Pedido comercial", "Compromiso de entrega"],
    completesWhen: ["Pedido registrado en PEDIDOS 2026"],
    blocks: ["PLANIFICACION"],
    unblocks: ["PLANIFICACION"],
    producedEntities: ["pedido"],
    sectorIds: ["COMERCIAL"],
  }),

  defineWorkflowStage({
    id: "DESARROLLO",
    title: "Desarrollo",
    description: "Formulación, muestras y validación previa a producción.",
    previousStages: ["COMERCIAL"],
    nextStages: ["PLANIFICACION", "ELABORACION"],
    dependsOn: ["Brief comercial", "Muestra aprobada"],
    generates: ["Fórmula", "Muestra", "Especificación"],
    completesWhen: ["Muestra aprobada por cliente", "Fórmula liberada a producción"],
    blocks: ["ELABORACION"],
    unblocks: ["PLANIFICACION", "ELABORACION"],
    producedEntities: ["muestra"],
    sectorIds: ["PRODUCCION"],
    originStages: ["DESARROLLO"],
  }),

  defineWorkflowStage({
    id: "PLANIFICACION",
    title: "Planificación",
    description: "Programación semanal en SEMANAS 2026 — asignación de líneas y días.",
    previousStages: ["COMERCIAL", "DESARROLLO"],
    nextStages: ["ELABORACION", "ENVASADO_MASIVO", "ENVASADO_PREMIUM"],
    dependsOn: ["Pedidos confirmados", "Capacidad de planta"],
    generates: ["Plan semanal", "Asignación por línea y día"],
    completesWhen: ["Bloque SEMANAS publicado para la semana"],
    blocks: ["ELABORACION", "ENVASADO_MASIVO", "ENVASADO_PREMIUM"],
    unblocks: ["ELABORACION", "ENVASADO_MASIVO", "ENVASADO_PREMIUM"],
    producedEntities: ["plan_semanal", "pedido"],
    sectorIds: ["PRODUCCION"],
    originStages: ["PLANIFICACION"],
  }),

  defineWorkflowStage({
    id: "ELABORACION",
    title: "Elaboración",
    description: "Producción de granel conforme OE — origen del flujo físico.",
    previousStages: ["PLANIFICACION", "DESARROLLO"],
    nextStages: ["ENVASADO_MASIVO", "ENVASADO_PREMIUM"],
    dependsOn: ["Granel planificado en SEMANAS", "Materias primas disponibles", "OE creada"],
    generates: ["OE", "Granel", "Lote de elaboración"],
    completesWhen: ["OE finalizada", "Granel liberado para acondicionamiento"],
    blocks: ["ENVASADO_MASIVO", "ENVASADO_PREMIUM"],
    unblocks: ["ENVASADO_MASIVO", "ENVASADO_PREMIUM"],
    producedEntities: ["oe", "granel", "lote"],
    sectorIds: ["ELABORACION"],
    originStages: ["ELABORACION"],
  }),

  defineWorkflowStage({
    id: "ENVASADO_MASIVO",
    title: "Envasado Masivo",
    description: "Acondicionamiento PT línea consumo masivo — genera OA.",
    previousStages: ["ELABORACION", "PLANIFICACION"],
    nextStages: ["CODIFICADO"],
    dependsOn: ["Granel elaborado", "Granel liberado", "OA creada o por crear"],
    generates: ["OA", "Producto terminado envasado"],
    completesWhen: ["OA finalizada", "Unidades registradas"],
    blocks: ["CODIFICADO"],
    unblocks: ["CODIFICADO"],
    producedEntities: ["oa"],
    sectorIds: ["ENVASADO_MASIVO"],
    originStages: ["ACONDICIONAMIENTO"],
  }),

  defineWorkflowStage({
    id: "ENVASADO_PREMIUM",
    title: "Envasado Premium",
    description: "Acondicionamiento PT línea premium — flujo aislado de Masivo.",
    previousStages: ["ELABORACION", "PLANIFICACION"],
    nextStages: ["CODIFICADO"],
    dependsOn: ["Granel elaborado", "Granel liberado", "OA premium creada"],
    generates: ["OA", "PT premium"],
    completesWhen: ["OA finalizada"],
    blocks: ["CODIFICADO"],
    unblocks: ["CODIFICADO"],
    producedEntities: ["oa"],
    sectorIds: ["ENVASADO_PREMIUM"],
    originStages: ["ACONDICIONAMIENTO"],
  }),

  defineWorkflowStage({
    id: "CODIFICADO",
    title: "Codificado",
    description: "Codificación, trazabilidad y preparación para liberación.",
    previousStages: ["ENVASADO_MASIVO", "ENVASADO_PREMIUM"],
    nextStages: ["CALIDAD"],
    dependsOn: ["OA finalizada", "Etiquetas disponibles"],
    generates: ["Código de trazabilidad", "Lote codificado"],
    completesWhen: ["Codificación completa"],
    blocks: ["CALIDAD"],
    unblocks: ["CALIDAD"],
    producedEntities: ["lote", "oa"],
    sectorIds: ["CODIFICADO"],
    originStages: ["CODIFICADO"],
  }),

  defineWorkflowStage({
    id: "CALIDAD",
    title: "Calidad",
    description: "Análisis, resultados y liberación de lote.",
    previousStages: ["CODIFICADO", "ELABORACION"],
    nextStages: ["DEPOSITO"],
    dependsOn: ["Lote asignado", "Muestra tomada", "OA vinculada"],
    generates: ["Resultado de análisis", "Liberación (RL)"],
    completesWhen: ["Lote conforme", "Liberación firmada"],
    blocks: ["DEPOSITO"],
    unblocks: ["DEPOSITO"],
    producedEntities: ["lote", "liberacion"],
    sectorIds: ["CALIDAD"],
    originStages: ["CALIDAD"],
  }),

  defineWorkflowStage({
    id: "DEPOSITO",
    title: "Depósito",
    description: "Preparación de insumos, despacho y entrega al cliente.",
    previousStages: ["CALIDAD", "ENVASADO_MASIVO", "ENVASADO_PREMIUM"],
    nextStages: [],
    dependsOn: ["PT liberado", "Insumos preparados", "Pedido despachable"],
    generates: ["Entrega", "Remito"],
    completesWhen: ["Entrega confirmada", "Pedido cerrado"],
    blocks: [],
    unblocks: [],
    producedEntities: ["entrega", "insumo", "pedido"],
    sectorIds: ["DEPOSITO"],
    originStages: ["DESPACHO"],
  }),

  defineWorkflowStage({
    id: "DIRECCION",
    title: "Dirección",
    description: "Supervisión transversal — observa el flujo sin operarlo.",
    previousStages: [],
    nextStages: [],
    dependsOn: [],
    generates: ["Señales ejecutivas", "Alertas de riesgo"],
    completesWhen: [],
    blocks: [],
    unblocks: [],
    producedEntities: ["pedido", "plan_semanal"],
    sectorIds: ["DIRECCION"],
  }),
];

export const WORKFLOW_REGISTRY: ReadonlyMap<WorkflowStageId, WorkflowStageDefinition> =
  new Map(WORKFLOW_STAGE_DEFINITIONS.map((d) => [d.id, d]));

export function getWorkflowStageDefinition(
  stageId: WorkflowStageId
): WorkflowStageDefinition | undefined {
  return WORKFLOW_REGISTRY.get(stageId);
}

export function getAllWorkflowStageDefinitions(): WorkflowStageDefinition[] {
  return [...WORKFLOW_STAGE_DEFINITIONS];
}

export function assertWorkflowStageDefinition(
  stageId: WorkflowStageId
): WorkflowStageDefinition {
  const definition = getWorkflowStageDefinition(stageId);
  if (!definition) {
    throw new Error(`Etapa no registrada en Workflow Engine: ${stageId}`);
  }
  return definition;
}

/** Flujo principal ordenado — cadena feliz de la planta. */
export const PRIMARY_WORKFLOW_CHAIN: WorkflowStageId[] = [
  "COMERCIAL",
  "DESARROLLO",
  "PLANIFICACION",
  "ELABORACION",
  "ENVASADO_MASIVO",
  "CODIFICADO",
  "CALIDAD",
  "DEPOSITO",
];
