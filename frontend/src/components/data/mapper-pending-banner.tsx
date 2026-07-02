"use client";

import { Alert } from "@/components/ui/alert";
import type { WorkspaceId } from "@/types/actions";
import type { OperationsDiagnostics } from "@/types/operations/operations-diagnostics";
import { getMapperPendingMessage } from "@/lib/mappers/real-data-empty-state";

interface MapperPendingBannerProps {
  workspaceId: WorkspaceId;
  diagnostics: OperationsDiagnostics | null;
  dataMode: "demo" | "real";
}

export function MapperPendingBanner({
  workspaceId,
  diagnostics,
  dataMode,
}: MapperPendingBannerProps) {
  if (dataMode !== "real") return null;

  const message = getMapperPendingMessage(workspaceId, diagnostics);
  if (!message) return null;

  const warning = diagnostics?.mapperWarnings?.find((item) =>
    workspaceId === "calidad"
      ? item.entity === "lote"
      : item.entity === "pedido"
  );

  return (
    <Alert variant="attention" title="Mapper pendiente">
      {message}
      {warning?.sampleHeaders && warning.sampleHeaders.length > 0 && (
        <p className="mt-2 text-xs">
          Headers detectados: {warning.sampleHeaders.join(" · ")}
        </p>
      )}
    </Alert>
  );
}
