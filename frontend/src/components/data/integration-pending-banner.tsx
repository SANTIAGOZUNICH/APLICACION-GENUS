"use client";

import { Alert } from "@/components/ui/alert";
import type { WorkspaceId } from "@/types/actions";

const PENDING_AREAS: Partial<Record<WorkspaceId, string>> = {
  calidad: "Lotes y liberaciones",
  comercial: "Pedidos comerciales",
  deposito: "Pedidos y movimientos de depósito",
  direccion: "Excepciones y panorama ejecutivo",
  dt: "Firmas y disposiciones técnicas",
};

interface IntegrationPendingBannerProps {
  workspaceId: WorkspaceId;
  dataMode: "demo" | "real";
}

export function IntegrationPendingBanner({
  workspaceId,
  dataMode,
}: IntegrationPendingBannerProps) {
  if (dataMode !== "real") return null;

  const area = PENDING_AREAS[workspaceId];
  if (!area) return null;

  return (
    <Alert variant="info" title="Pendiente de integración real">
      {area} no forma parte del slice E7.2. Se conectará en una entrega posterior
      (E7.3+). Mientras tanto, usá Consulta y Producción para trabajar con OEs de
      ELABORACION.
    </Alert>
  );
}

interface BandejaPendingBannerProps {
  dataMode: "demo" | "real";
  oeCount?: number;
}

export function BandejaPendingBanner({ dataMode, oeCount = 0 }: BandejaPendingBannerProps) {
  if (dataMode !== "real") return null;

  return (
    <Alert variant="info" title="Bandeja operativa — E7.3">
      Datos reales conectados{oeCount > 0 ? ` (${oeCount} OEs indexadas)` : ""}. La
      bandeja operativa se activará cuando existan reglas de priorización sobre datos
      reales. Por ahora, usá{" "}
      <span className="font-medium">Consulta</span> o{" "}
      <span className="font-medium">Producción</span> para abrir OEs.
    </Alert>
  );
}
