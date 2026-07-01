"use client";

import { useEffect, useMemo, useState } from "react";
import { Factory, Loader2, Package, Search } from "lucide-react";
import { EntityCard } from "@/components/cards/entity-card";
import { Alert } from "@/components/ui/alert";
import { EmptyState } from "@/components/ui/empty-state";
import { FormField } from "@/components/forms/form-field";
import {
  fetchConsulta,
  OperationsApiError,
} from "@/lib/api/operations-client";
import { getClientDataMode } from "@/lib/config/data-mode";
import type {
  ConsultaResultItem,
  ConsultaSearchResponse,
} from "@/types/consulta/consulta-result";
import { Status } from "@/types/ui/status";

function SourceBanner({
  response,
  dataMode,
}: {
  response: ConsultaSearchResponse | null;
  dataMode: ReturnType<typeof getClientDataMode>;
}) {
  if (!response) return null;

  const isRealDrive = dataMode === "real" && response.source === "drive";

  return (
    <Alert
      variant={isRealDrive ? "ok" : "attention"}
      title={isRealDrive ? "Ordenes de elaboración — Google Drive" : "Modo demo"}
    >
      {response.message ??
        (isRealDrive
          ? "Búsqueda sobre el índice ELABORACION (sin abrir todos los Sheets)."
          : "Datos de demostración.")}
      {response.indexSummary && (
        <p className="mt-2 text-xs">
          {response.indexSummary.oes} OE indexadas en ELABORACION
        </p>
      )}
      {response.integrationPending && dataMode === "real" && (
        <p className="mt-2 text-xs text-[var(--muted-foreground)]">
          {response.integrationPending.lotes} · {response.integrationPending.pedidos}
        </p>
      )}
    </Alert>
  );
}

function ConsultaOeResultCard({ item }: { item: ConsultaResultItem }) {
  return (
    <EntityCard
      entityId={item.id}
      title={item.title}
      subtitle={item.subtitle}
      status={Status.PENDIENTE}
      statusLabel="Indexada"
      identityIcon={Factory}
      metadata={item.metadata}
      primaryAction={{
        label: "Abrir ficha",
        href: item.href,
      }}
      href={item.href}
    />
  );
}

export function ConsultaView() {
  const dataMode = getClientDataMode();
  const [query, setQuery] = useState("");
  const [debouncedQuery, setDebouncedQuery] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [response, setResponse] = useState<ConsultaSearchResponse | null>(null);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      setDebouncedQuery(query.trim());
    }, 300);
    return () => window.clearTimeout(timer);
  }, [query]);

  useEffect(() => {
    let active = true;

    async function runSearch() {
      setLoading(true);
      setError(null);

      try {
        const data = await fetchConsulta(debouncedQuery, ["oe"]);
        if (active) {
          setResponse(data);
        }
      } catch (err) {
        if (active) {
          setResponse(null);
          setError(
            err instanceof OperationsApiError
              ? err.message
              : "No se pudo conectar con el BFF de consulta."
          );
        }
      } finally {
        if (active) {
          setLoading(false);
        }
      }
    }

    void runSearch();

    return () => {
      active = false;
    };
  }, [debouncedQuery]);

  const oeResults = useMemo(
    () => response?.results.filter((item) => item.kind === "oe") ?? [],
    [response]
  );

  const hasQuery = debouncedQuery.length > 0;
  const hasResults = oeResults.length > 0;

  return (
    <div className="flex flex-col gap-6">
      <div className="rounded-lg border border-[var(--border)] bg-[var(--surface)] p-4">
        <FormField
          htmlFor="consulta-search"
          label="Buscar órdenes de elaboración"
          description="Por producto, cliente o nombre de archivo en ELABORACION."
        >
          <div className="relative">
            <Search
              className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-[var(--muted-foreground)]"
              aria-hidden="true"
            />
            <input
              id="consulta-search"
              type="search"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder='Ej: "CREMA NIACINAMIDA", "ICONO", "JULIO"'
              className="h-11 w-full rounded-md border border-[var(--border)] bg-[var(--background)] py-2 pl-10 pr-3 text-sm text-[var(--foreground)] placeholder:text-[var(--muted-foreground)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ring)]"
              autoComplete="off"
            />
          </div>
        </FormField>
      </div>

      <SourceBanner response={response} dataMode={dataMode} />

      {dataMode === "real" && (
        <Alert variant="info" title="Fuera de alcance E7.2">
          Lotes y Pedidos están pendientes de integración (E7.3). Esta consulta
          cubre solo OEs de ELABORACION.
        </Alert>
      )}

      {loading && (
        <div
          className="flex items-center justify-center gap-2 rounded-lg border border-[var(--border-subtle)] bg-[var(--surface)] px-4 py-10 text-sm text-[var(--muted-foreground)]"
          aria-live="polite"
        >
          <Loader2 className="size-4 animate-spin" aria-hidden="true" />
          Consultando índice {dataMode === "real" ? "Drive" : "demo"}…
        </div>
      )}

      {error && !loading && (
        <Alert variant="problem" title="Error de conexión">
          {error}
        </Alert>
      )}

      {!loading && !error && !hasQuery && (
        <EmptyState
          icon={Search}
          title="Explorá OEs de ELABORACION"
          description={
            dataMode === "real"
              ? `Hay ${response?.indexSummary?.oes ?? "—"} OEs indexadas. Ingresá producto, cliente o archivo.`
              : "Ingresá un término para buscar en demo."
          }
          tone="positive"
        />
      )}

      {!loading && !error && hasQuery && !hasResults && (
        <EmptyState
          icon={Package}
          title="Sin coincidencias"
          description={`No encontramos OEs para "${debouncedQuery}" en ELABORACION.`}
          tone="neutral"
        />
      )}

      {!loading && !error && hasResults && (
        <div className="flex flex-col gap-3">
          <p className="text-sm text-[var(--muted-foreground)]">
            {oeResults.length} OE(s) encontrada(s)
          </p>
          {oeResults.map((item) => (
            <ConsultaOeResultCard key={item.id} item={item} />
          ))}
        </div>
      )}
    </div>
  );
}
