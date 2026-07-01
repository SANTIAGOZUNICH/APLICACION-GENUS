import type { WorkspaceId } from "@/types/actions";
import type { OperationsDiagnostics } from "@/types/operations/operations-diagnostics";

export function getMapperPendingMessage(
  workspaceId: WorkspaceId,
  diagnostics: OperationsDiagnostics | null
): string | null {
  if (!diagnostics?.mapperWarnings?.length) {
    return null;
  }

  const warning = diagnostics.mapperWarnings.find((item) => {
    if (workspaceId === "calidad") return item.entity === "lote";
    if (workspaceId === "comercial" || workspaceId === "deposito") {
      return item.entity === "pedido";
    }
    return false;
  });

  if (!warning) return null;

  if (warning.entity === "lote") {
    return "ASIGNACION DE LOTES 2026 conectada, pero falta mapear columnas.";
  }

  return "PEDIDOS 2026 conectado, pero falta mapear columnas.";
}

export function getUnmappedRealDataMessage(
  workspaceId: WorkspaceId,
  diagnostics: OperationsDiagnostics | null,
  taskCount: number
): string | null {
  if (!diagnostics || diagnostics.dataMode !== "real") {
    return null;
  }

  const counts = diagnostics.counts;
  const realSources = diagnostics.realSources;

  if (taskCount > 0) {
    return null;
  }

  if (workspaceId === "produccion" && (counts?.oe ?? 0) > 0) {
    return "Hay datos reales conectados, pero todavía falta mapear esta vista.";
  }

  if (
    workspaceId === "calidad" &&
    (realSources?.lotesRowsRead ?? counts?.lotes ?? 0) > 0 &&
    (realSources?.lotesRowsMapped ?? counts?.lotes ?? 0) === 0
  ) {
    return "ASIGNACION DE LOTES 2026 conectada, pero falta mapear columnas.";
  }

  if (
    (workspaceId === "comercial" || workspaceId === "deposito") &&
    (realSources?.pedidosRowsRead ?? 0) > 0 &&
    (realSources?.pedidosRowsMapped ?? counts?.pedidos ?? 0) === 0
  ) {
    return workspaceId === "comercial"
      ? "PEDIDOS 2026 conectado, pero falta mapear columnas."
      : "PEDIDOS 2026 conectado, pero falta mapear columnas para Depósito.";
  }

  return null;
}

export function getSectionEmptyState(input: {
  dataMode: "demo" | "real";
  diagnostics: OperationsDiagnostics | null;
  workspaceId?: WorkspaceId;
  sectionId: string;
  sectionTaskCount: number;
  totalTaskCount: number;
}) {
  const unmapped = input.workspaceId
    ? getUnmappedRealDataMessage(
        input.workspaceId,
        input.diagnostics,
        input.totalTaskCount
      )
    : null;

  if (unmapped && input.sectionTaskCount === 0) {
    return {
      title: "Datos reales pendientes de mapeo",
      description: unmapped,
      tone: "neutral" as const,
    };
  }

  if (input.sectionId === "finalizados" || input.sectionId === "cerrados") {
    return {
      title: "Nada finalizado todavía hoy",
      description: "Cuando completes tareas, aparecerán acá.",
      tone: "neutral" as const,
    };
  }

  if (input.sectionId === "problemas") {
    return {
      title: "Sin problemas pendientes",
      description: "Todo en orden. Seguí con tu trabajo.",
      tone: "positive" as const,
    };
  }

  return {
    title: "Sección al día",
    description: "No hay ítems en esta sección por ahora.",
    tone: "positive" as const,
  };
}
