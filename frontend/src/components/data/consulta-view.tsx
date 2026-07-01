"use client";

import { useEffect, useMemo, useState } from "react";
import {
  Factory,
  Loader2,
  Package,
  ScanBarcode,
  Search,
  Truck,
} from "lucide-react";
import { EntityCard } from "@/components/cards/entity-card";
import { Alert } from "@/components/ui/alert";
import { Chip } from "@/components/ui/chip";
import { EmptyState } from "@/components/ui/empty-state";
import { FormField } from "@/components/forms/form-field";
import {
  fetchConsulta,
  OperationsApiError,
} from "@/lib/api/operations-client";
import { getClientDataMode } from "@/lib/config/data-mode";
import type {
  ConsultaEntityKind,
  ConsultaResultItem,
  ConsultaSearchResponse,
} from "@/types/consulta/consulta-result";
import { Status } from "@/types/ui/status";

const KIND_LABELS: Record<ConsultaEntityKind, string> = {
  oe: "Orden de elaboración",
  lote: "Lote",
  pedido: "Pedido",
};

const KIND_ICONS = {
  oe: Factory,
  lote: ScanBarcode,
  pedido: Truck,
} as const;

const ALL_SCOPES: ConsultaEntityKind[] = ["oe", "lote", "pedido"];

function SourceBanner({
  response,
  dataMode,
}: {
  response: ConsultaSearchResponse | null;
  dataMode: ReturnType<typeof getClientDataMode>;
}) {
  if (!response) return null;

  const isRealDrive =
    dataMode === "real" &&
    response.source === "drive" &&
    !response.message?.includes("fallback");

  return (
    <Alert
      variant={isRealDrive ? "ok" : response.source === "demo" ? "attention" : "info"}
      title={
        isRealDrive
          ? "Origen: Google Drive / Sheets (índice E7.1)"
          : response.source === "demo"
            ? "Origen: Mock demo"
            : "Origen: Drive con fallback"
      }
    >
      {response.message ??
        (isRealDrive
          ? "Resultados desde índices cacheados — no se abrieron Sheets masivamente."
          : "Datos de demostración para validación local.")}
      {response.indexSummary && (
        <p className="mt-2 text-xs">
          Índice disponible: {response.indexSummary.oes} OE ·{" "}
          {response.indexSummary.lotes} lotes · {response.indexSummary.pedidos}{" "}
          pedidos
        </p>
      )}
      {response.diagnostics && dataMode === "real" && (
        <div className="mt-3 space-y-2 text-xs">
          {response.diagnostics.lotes &&
            (response.diagnostics.lotes.rowsMapped === 0 ||
              response.diagnostics.lotes.rowsRead === 0) && (
              <p>
                Lotes: endpoint {response.diagnostics.lotes.rowsRead} filas leídas,{" "}
                {response.diagnostics.lotes.rowsMapped} mapeadas.
                {response.diagnostics.lotes.reason
                  ? ` ${response.diagnostics.lotes.reason}`
                  : ""}
                {response.diagnostics.lotes.sampleHeaders?.length
                  ? ` Headers: ${response.diagnostics.lotes.sampleHeaders.join(" · ")}`
                  : ""}
              </p>
            )}
          {response.diagnostics.pedidos &&
            (response.diagnostics.pedidos.rowsMapped === 0 ||
              response.diagnostics.pedidos.rowsRead === 0) && (
              <p>
                Pedidos: {response.diagnostics.pedidos.rowsRead} filas leídas,{" "}
                {response.diagnostics.pedidos.rowsMapped} mapeadas.
                {response.diagnostics.pedidos.readerUsed
                  ? ` Lector: ${response.diagnostics.pedidos.readerUsed}.`
                  : ""}
                {response.diagnostics.pedidos.fileMimeType
                  ? ` MIME: ${response.diagnostics.pedidos.fileMimeType}.`
                  : ""}
                {response.diagnostics.pedidos.reason
                  ? ` ${response.diagnostics.pedidos.reason}`
                  : ""}
                {response.diagnostics.pedidos.sampleHeaders?.length
                  ? ` Headers: ${response.diagnostics.pedidos.sampleHeaders.join(" · ")}`
                  : ""}
              </p>
            )}
        </div>
      )}
    </Alert>
  );
}

function ConsultaResultCard({ item }: { item: ConsultaResultItem }) {
  const Icon = KIND_ICONS[item.kind];

  return (
    <EntityCard
      entityId={item.id}
      title={item.title}
      subtitle={item.subtitle}
      status={Status.EN_CURSO}
      identityIcon={Icon}
      metadata={[
        { id: "tipo", label: "Tipo", value: KIND_LABELS[item.kind] },
        ...item.metadata,
        {
          id: "origen",
          label: "Origen",
          value: item.source === "drive" ? "Drive/Sheets" : "Mock demo",
        },
      ]}
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
  const [scopes, setScopes] = useState<ConsultaEntityKind[]>(ALL_SCOPES);
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
        const data = await fetchConsulta(debouncedQuery, scopes);
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
  }, [debouncedQuery, scopes]);

  const toggleScope = (scope: ConsultaEntityKind) => {
    setScopes((current) => {
      if (current.includes(scope)) {
        const next = current.filter((item) => item !== scope);
        return next.length > 0 ? next : current;
      }
      return [...current, scope];
    });
  };

  const groupedResults = useMemo(() => {
    if (!response) return [];
    return ALL_SCOPES.filter((scope) => scopes.includes(scope))
      .map((scope) => ({
        scope,
        items: response.results.filter((item) => item.kind === scope),
      }))
      .filter((group) => group.items.length > 0);
  }, [response, scopes]);

  const hasQuery = debouncedQuery.length > 0;
  const hasResults = (response?.results.length ?? 0) > 0;

  return (
    <div className="flex flex-col gap-6">
      <div className="rounded-lg border border-[var(--border)] bg-[var(--surface)] p-4">
        <FormField
          htmlFor="consulta-search"
          label="Buscar en datos operativos"
          description="OE por nombre de archivo, lote por código o ítem, pedido por cliente o ID."
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
              placeholder='Ej: "CREMA NIACINAMIDA", "ICONO", "LG-2026", "PED-2026"'
              className="h-11 w-full rounded-md border border-[var(--border)] bg-[var(--background)] py-2 pl-10 pr-3 text-sm text-[var(--foreground)] placeholder:text-[var(--muted-foreground)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ring)]"
              autoComplete="off"
            />
          </div>
        </FormField>

        <div className="mt-4 flex flex-wrap items-center gap-2">
          <span className="text-xs font-medium text-[var(--muted-foreground)]">
            Buscar en:
          </span>
          {ALL_SCOPES.map((scope) => (
            <Chip
              key={scope}
              variant={scopes.includes(scope) ? "selected" : "outline"}
              size="sm"
              interactive
              onClick={() => toggleScope(scope)}
            >
              {KIND_LABELS[scope]}
            </Chip>
          ))}
        </div>
      </div>

      <SourceBanner response={response} dataMode={dataMode} />

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

      {!loading && !error && !hasQuery && response?.diagnostics && dataMode === "real" && (
        <Alert variant="info" title="Diagnóstico de fuentes reales">
          {response.indexSummary && (
            <p className="text-sm">
              Índice: {response.indexSummary.oes} OE · {response.indexSummary.lotes}{" "}
              lotes · {response.indexSummary.pedidos} pedidos
            </p>
          )}
          {response.diagnostics.lotes &&
            response.diagnostics.lotes.rowsMapped === 0 && (
              <p className="mt-2 text-xs">
                Lotes: {response.diagnostics.lotes.rowsRead} filas leídas, 0 mapeadas.{" "}
                {response.diagnostics.lotes.reason}
              </p>
            )}
          {response.diagnostics.pedidos &&
            response.diagnostics.pedidos.rowsMapped === 0 && (
              <p className="mt-2 text-xs">
                Pedidos: {response.diagnostics.pedidos.rowsRead} filas leídas, 0 mapeadas.{" "}
                {response.diagnostics.pedidos.reason}
              </p>
            )}
        </Alert>
      )}

      {!loading && !error && !hasQuery && (
        <EmptyState
          icon={Search}
          title="Explorá datos reales del laboratorio"
          description="Ingresá un término para buscar OEs indexadas en ELABORACION, lotes en ASIGNACION DE LOTES 2026 o pedidos en PEDIDOS 2026."
          tone="positive"
        />
      )}

      {!loading && !error && hasQuery && !hasResults && (
        <EmptyState
          icon={Package}
          title="Sin coincidencias"
          description={`No encontramos resultados para "${debouncedQuery}" en ${scopes
            .map((scope) => KIND_LABELS[scope])
            .join(", ")}.`}
          tone="positive"
        />
      )}

      {!loading && !error && hasResults && (
        <div className="flex flex-col gap-6">
          <p className="text-sm text-[var(--muted-foreground)]">
            {response?.results.length} resultado(s)
            {response?.counts
              ? ` · ${response.counts.oe} OE · ${response.counts.lote} lotes · ${response.counts.pedido} pedidos`
              : ""}
          </p>

          {groupedResults.map((group) => (
            <section key={group.scope} className="flex flex-col gap-3">
              <h2 className="text-sm font-semibold text-[var(--foreground)]">
                {KIND_LABELS[group.scope]} ({group.items.length})
              </h2>
              <div className="flex flex-col gap-3">
                {group.items.map((item) => (
                  <ConsultaResultCard key={`${item.kind}-${item.id}`} item={item} />
                ))}
              </div>
            </section>
          ))}

          <p className="text-xs text-[var(--muted-foreground)]">
            Tip: las OE se indexan por nombre de archivo en Drive (ej.{" "}
            <span className="font-medium">CREMA NIACINAMIDA - ICONO</span>). Al
            abrir, la ficha resuelve fileSlug o fileId vía BFF.
          </p>
        </div>
      )}
    </div>
  );
}
