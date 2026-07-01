"use client";

import { Alert } from "@/components/ui/alert";
import type { OperationsDataSource } from "@/lib/operations/operations-store";
import type { OperationsDiagnostics } from "@/types/operations/operations-diagnostics";

interface RealDataSourceBannerProps {
  dataMode: "demo" | "real";
  dataSource: OperationsDataSource;
  diagnostics: OperationsDiagnostics | null;
  loading?: boolean;
}

export function RealDataSourceBanner({
  dataMode,
  dataSource,
  diagnostics,
  loading = false,
}: RealDataSourceBannerProps) {
  if (dataMode === "demo") {
    return (
      <Alert variant="info" title="Modo demo">
        Datos ficticios de desarrollo. Activá{" "}
        <code className="text-xs">GENUS_DATA_MODE=real</code> para conectar Drive.
      </Alert>
    );
  }

  if (loading) {
    return (
      <Alert variant="info" title="Cargando datos reales">
        Consultando índices Drive/Sheets vía BFF…
      </Alert>
    );
  }

  const fallbackActive = Boolean(
    diagnostics?.fallbackUsed.bandeja ||
      diagnostics?.fallbackUsed.workspaces ||
      diagnostics?.fallbackUsed.entityPages
  );

  if (fallbackActive) {
    return (
      <Alert variant="attention" title="Demo / fallback activo">
        {diagnostics?.message ??
          "No se pudieron leer datos reales. Lo visible está etiquetado como demo/fallback."}
      </Alert>
    );
  }

  if (dataSource === "drive" || diagnostics?.source === "drive") {
    const counts = diagnostics?.counts;
    return (
      <Alert variant="ok" title="Datos reales — Google Drive / Sheets">
        {diagnostics?.message ?? "Información desde índices cacheados de Drive."}
        {counts && (
          <p className="mt-2 text-xs">
            Disponibles: {counts.oe} OE · {counts.lotes} lotes · {counts.pedidos}{" "}
            pedidos · {counts.oa} OA · {counts.liberaciones} liberaciones
          </p>
        )}
      </Alert>
    );
  }

  return (
    <Alert variant="attention" title="Sin datos reales disponibles todavía">
      {diagnostics?.message ??
        "Modo real activo pero no hay índice Drive cargado. Ejecutá /api/v1/drive/refresh o revisá credenciales."}
    </Alert>
  );
}
