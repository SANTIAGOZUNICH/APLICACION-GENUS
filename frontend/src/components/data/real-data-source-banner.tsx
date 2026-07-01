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
  const realSources = diagnostics?.realSources;
  const hasRealData = Boolean(
    (counts?.oe ?? 0) > 0 ||
      (counts?.lotes ?? 0) > 0 ||
      (counts?.pedidos ?? 0) > 0 ||
      (realSources?.elaboracionIndexCount ?? 0) > 0
  );

  const driveLike =
    dataSource === "drive" ||
    isDriveLikeSource(diagnostics?.source) ||
    diagnostics?.source === "drive-partial";

  if (driveLike && hasRealData) {
    const isPartial =
      diagnostics?.source === "drive-partial" ||
      (diagnostics?.mapperWarnings?.length ?? 0) > 0;

    return (
      <Alert variant={isPartial ? "attention" : "ok"} title={isPartial ? "Datos reales parciales" : "Datos reales — Google Drive / Sheets"}>
        {diagnostics?.message ??
          (isPartial
            ? "Algunas fuentes reales están conectadas; otras requieren mapeo adicional."
            : "Información desde índices cacheados de Drive.")}
        {counts && (
          <p className="mt-2 text-xs">
            Disponibles: {counts.oe} OE · {counts.lotes} lotes · {counts.pedidos}{" "}
            pedidos · {counts.oa} OA · {counts.liberaciones} liberaciones
          </p>
        )}
        {realSources && (
          <p className="mt-1 text-xs">
            Índice ELABORACION: {realSources.elaboracionIndexCount} · Lotes{" "}
            {realSources.lotesRowsMapped}/{realSources.lotesRowsRead} · Pedidos{" "}
            {realSources.pedidosRowsMapped}/{realSources.pedidosRowsRead}
            {realSources.pedidosReaderUsed
              ? ` · Lector pedidos: ${realSources.pedidosReaderUsed}`
              : ""}
            {realSources.pedidosFileMimeType
              ? ` · MIME: ${realSources.pedidosFileMimeType}`
              : ""}
          </p>
        )}
        {realSources?.pedidosWarning && (
          <p className="mt-2 text-xs">{realSources.pedidosWarning}</p>
        )}
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
