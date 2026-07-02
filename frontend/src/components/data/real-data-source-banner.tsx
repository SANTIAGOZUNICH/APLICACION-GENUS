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

function isDriveLikeSource(source: OperationsDiagnostics["source"] | undefined): boolean {
  return source === "drive" || source === "drive-partial";
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

  const counts = diagnostics?.counts;
  const oeCount = counts?.oe ?? 0;
  const hasRealData = oeCount > 0 || (diagnostics?.realSources?.elaboracionIndexCount ?? 0) > 0;

  const driveLike =
    dataSource === "drive" ||
    isDriveLikeSource(diagnostics?.source) ||
    diagnostics?.source === "drive-partial";

  if (driveLike && hasRealData) {
    return (
      <Alert variant="ok" title="Datos reales — ELABORACION (E7.2)">
        {diagnostics?.message ??
          "OEs indexadas desde Google Drive. Consulta, Producción y fichas /oe/[id] conectadas."}
        <p className="mt-2 text-xs">
          {oeCount} OE(s) indexada(s) en ELABORACION
        </p>
      </Alert>
    );
  }

  if (driveLike && !hasRealData) {
    return (
      <Alert variant="attention" title="Drive conectado — sin datos indexados">
        {diagnostics?.message ??
          "Modo real activo pero el índice está vacío. Ejecutá /api/v1/drive/refresh."}
      </Alert>
    );
  }

  return (
    <Alert variant="attention" title="Error de conexión">
      {diagnostics?.message ??
        "No se pudo confirmar el origen de datos. Revisá credenciales e índice Drive."}
    </Alert>
  );
}
