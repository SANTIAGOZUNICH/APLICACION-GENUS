"use client";

import { useCallback, useEffect, useState } from "react";
import {
  AlertTriangle,
  CheckCircle2,
  Database,
  Loader2,
  RefreshCw,
  XCircle,
} from "lucide-react";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Chip } from "@/components/ui/chip";
import {
  fetchDiscoverySummary,
  OperationsApiError,
} from "@/lib/api/operations-client";
import { getClientDataMode } from "@/lib/config/data-mode";
import type {
  DiscoveryConnectionStatus,
  DiscoverySummaryResponse,
} from "@/types/discovery/discovery.types";

function statusLabel(status: DiscoveryConnectionStatus): string {
  switch (status) {
    case "connected":
      return "Conectado";
    case "not_connected":
      return "No conectado";
    case "pending_mapper":
      return "Pendiente de mapper";
  }
}

function StatusIcon({ status }: { status: DiscoveryConnectionStatus }) {
  if (status === "connected") {
    return <CheckCircle2 className="size-4 text-[var(--color-ok)]" aria-hidden="true" />;
  }
  if (status === "pending_mapper") {
    return <AlertTriangle className="size-4 text-[var(--color-attention)]" aria-hidden="true" />;
  }
  return <XCircle className="size-4 text-[var(--color-problem)]" aria-hidden="true" />;
}

function SourceRow({
  label,
  status,
  detail,
}: {
  label: string;
  status: DiscoveryConnectionStatus;
  detail: string;
}) {
  return (
    <div className="flex items-start justify-between gap-4 rounded-md border border-[var(--border-subtle)] bg-[var(--background)] px-3 py-2.5">
      <div className="flex min-w-0 items-start gap-2">
        <StatusIcon status={status} />
        <div className="min-w-0">
          <p className="text-sm font-medium">{label}</p>
          <p className="text-xs text-[var(--muted-foreground)]">{detail}</p>
        </div>
      </div>
      <Chip variant="outline" size="sm">
        {statusLabel(status)}
      </Chip>
    </div>
  );
}

/** E7.2 — Data Discovery panel for /consulta. No UI mapping until schemas confirmed. */
export function DataDiscoveryPanel() {
  const dataMode = getClientDataMode();
  const [loading, setLoading] = useState(dataMode === "real");
  const [error, setError] = useState<string | null>(null);
  const [summary, setSummary] = useState<DiscoverySummaryResponse | null>(null);
  const [hasLoaded, setHasLoaded] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);

    try {
      const data = await fetchDiscoverySummary();
      setSummary(data);
      setHasLoaded(true);
    } catch (err) {
      setSummary(null);
      setError(
        err instanceof OperationsApiError
          ? err.message
          : "No se pudo ejecutar Data Discovery."
      );
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (dataMode !== "real" || hasLoaded) return;

    let active = true;

    async function runInitialDiscovery() {
      try {
        const data = await fetchDiscoverySummary();
        if (active) {
          setSummary(data);
          setHasLoaded(true);
        }
      } catch (err) {
        if (active) {
          setError(
            err instanceof OperationsApiError
              ? err.message
              : "No se pudo ejecutar Data Discovery."
          );
        }
      } finally {
        if (active) {
          setLoading(false);
        }
      }
    }

    void runInitialDiscovery();

    return () => {
      active = false;
    };
  }, [dataMode, hasLoaded]);

  if (dataMode !== "real") {
    return (
      <Alert variant="info" title="Data Discovery — modo demo">
        El diagnóstico de schemas reales requiere{" "}
        <code className="text-xs">GENUS_DATA_MODE=real</code> y credenciales Drive.
        En demo no se muestran datos ficticios de discovery.
      </Alert>
    );
  }

  return (
    <section
      className="rounded-lg border border-[var(--border)] bg-[var(--surface)] p-4"
      aria-labelledby="discovery-heading"
    >
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <Database className="size-4 text-[var(--muted-foreground)]" aria-hidden="true" />
          <div>
            <h2 id="discovery-heading" className="text-sm font-semibold">
              Diagnóstico de datos reales
            </h2>
            <p className="text-xs text-[var(--muted-foreground)]">
              Data Discovery E7.2 — validar schemas antes de mapear Workspaces.
            </p>
          </div>
        </div>
        <Button
          type="button"
          variant="secondary"
          size="sm"
          onClick={() => void load()}
          disabled={loading}
        >
          {loading ? (
            <Loader2 className="size-4 animate-spin" aria-hidden="true" />
          ) : (
            <RefreshCw className="size-4" aria-hidden="true" />
          )}
          {loading ? "Escaneando…" : "Re-escanear"}
        </Button>
      </div>

      {error && (
        <Alert variant="problem" title="Error de discovery" className="mb-4">
          {error}
        </Alert>
      )}

      {loading && !summary && (
        <div className="flex items-center gap-2 py-6 text-sm text-[var(--muted-foreground)]">
          <Loader2 className="size-4 animate-spin" aria-hidden="true" />
          Leyendo Drive, tabs, headers y muestras…
        </div>
      )}

      {summary && (
        <div className="flex flex-col gap-4">
          <SourceRow
            label="OEs — ELABORACION"
            status={summary.oes.status}
            detail={`${summary.oes.count} indexadas · campos obligatorios detectados: ${summary.oes.fieldsDetectedCount ?? "—"}/${summary.oes.fieldsMissingCount !== undefined ? (summary.oes.fieldsDetectedCount ?? 0) + summary.oes.fieldsMissingCount : "—"}`}
          />
          <SourceRow
            label="Lotes — ASIGNACION DE LOTES 2026"
            status={summary.lotes.status}
            detail={`${summary.lotes.rowsMappable} mapeables / ${summary.lotes.rowsRead} filas leídas`}
          />
          <SourceRow
            label="Pedidos — PEDIDOS 2026"
            status={summary.pedidos.status}
            detail={`${summary.pedidos.rowsMappable} mapeables / ${summary.pedidos.rowsRead} filas leídas`}
          />

          {summary.readyForUiMapping ? (
            <Alert variant="ok" title="Listo para definir mappers UI">
              Schemas mínimos confirmados. Podés avanzar a ajustar aliases con los outputs de
              discovery.
            </Alert>
          ) : (
            <Alert variant="attention" title="No mapear Workspaces todavía">
              Faltan condiciones para UI real. Blockers:{" "}
              {summary.blockers.length > 0
                ? summary.blockers.join(" · ")
                : "revisar warnings de schema."}
            </Alert>
          )}

          {summary.schemaWarnings.length > 0 && (
            <div className="rounded-md border border-[var(--border-subtle)] bg-[var(--background)] p-3">
              <p className="mb-2 text-xs font-medium uppercase tracking-wide text-[var(--muted-foreground)]">
                Warnings de schema
              </p>
              <ul className="flex flex-col gap-1 text-xs text-[var(--foreground)]">
                {summary.schemaWarnings.slice(0, 8).map((warning) => (
                  <li key={warning} className="flex gap-2">
                    <AlertTriangle
                      className="mt-0.5 size-3 shrink-0 text-[var(--color-attention)]"
                      aria-hidden="true"
                    />
                    <span>{warning}</span>
                  </li>
                ))}
              </ul>
              {summary.schemaWarnings.length > 8 && (
                <p className="mt-2 text-xs text-[var(--muted-foreground)]">
                  +{summary.schemaWarnings.length - 8} warnings más en los endpoints JSON.
                </p>
              )}
            </div>
          )}

          <details className="text-xs text-[var(--muted-foreground)]">
            <summary className="cursor-pointer font-medium text-[var(--foreground)]">
              Endpoints de discovery (JSON)
            </summary>
            <ul className="mt-2 flex flex-col gap-1 pl-2">
              <li>
                <code>/api/v1/discovery/drive-summary</code>
              </li>
              <li>
                <code>/api/v1/discovery/oe-schemas</code>
              </li>
              <li>
                <code>/api/v1/discovery/lotes-schema</code>
              </li>
              <li>
                <code>/api/v1/discovery/pedidos-schema</code>
              </li>
            </ul>
          </details>
        </div>
      )}
    </section>
  );
}
