"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { Loader2 } from "lucide-react";
import { Alert } from "@/components/ui/alert";
import { Chip } from "@/components/ui/chip";
import {
  fetchWorkItemsDebug,
  OperationsApiError,
} from "@/lib/api/operations-client";
import { SECTOR_LABELS } from "@/types/operational/sector";
import type { WorkItemsDebugResponse } from "@/types/operational/work-items-preview.types";
import type { WorkItem } from "@/types/operational/work-item";

function MetricGrid({ data }: { data: Record<string, number | undefined> }) {
  const entries = Object.entries(data).filter(([, v]) => (v ?? 0) > 0);
  if (entries.length === 0) {
    return <p className="text-sm text-[var(--muted-foreground)]">Sin datos.</p>;
  }
  return (
    <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
      {entries.map(([key, value]) => (
        <div key={key} className="rounded-md border border-[var(--border-subtle)] px-3 py-2">
          <p className="text-xs text-[var(--muted-foreground)]">{key}</p>
          <p className="text-lg font-semibold">{value}</p>
        </div>
      ))}
    </div>
  );
}

function WorkItemsTable({ items }: { items: WorkItem[] }) {
  if (items.length === 0) {
    return <p className="text-sm text-[var(--muted-foreground)]">Sin WorkItems.</p>;
  }

  return (
    <div className="overflow-x-auto rounded-lg border border-[var(--border)]">
      <table className="min-w-full text-left text-xs">
        <thead className="bg-[var(--surface)] text-[var(--muted-foreground)]">
          <tr>
            <th className="px-3 py-2">sector</th>
            <th className="px-3 py-2">producto</th>
            <th className="px-3 py-2">origen</th>
            <th className="px-3 py-2">originStage</th>
            <th className="px-3 py-2">prioridad</th>
            <th className="px-3 py-2">dependsOn</th>
            <th className="px-3 py-2">blockedBy</th>
            <th className="px-3 py-2">confidence</th>
            <th className="px-3 py-2">createdFrom</th>
          </tr>
        </thead>
        <tbody>
          {items.map((item) => (
            <tr key={item.id} className="border-t border-[var(--border-subtle)]">
              <td className="px-3 py-2">{item.sector}</td>
              <td className="px-3 py-2">{item.product ?? "—"}</td>
              <td className="px-3 py-2">{item.source}</td>
              <td className="px-3 py-2">{item.originStage}</td>
              <td className="px-3 py-2">{item.priority ?? "null"}</td>
              <td className="px-3 py-2">{item.dependsOn?.length ? item.dependsOn.join(", ") : "null"}</td>
              <td className="px-3 py-2">{item.blockedBy?.length ? item.blockedBy.join(", ") : "null"}</td>
              <td className="px-3 py-2">{item.confidence}</td>
              <td className="max-w-xs truncate px-3 py-2" title={item.createdFrom}>
                {item.createdFrom}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/** Dev-only WorkItems diagnostic dashboard. */
export function WorkItemsDebugView() {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [data, setData] = useState<WorkItemsDebugResponse | null>(null);
  const [sectorFilter, setSectorFilter] = useState<string>("all");

  useEffect(() => {
    let active = true;

    async function load() {
      setLoading(true);
      setError(null);
      try {
        const snapshot = await fetchWorkItemsDebug();
        if (active) setData(snapshot);
      } catch (err) {
        if (active) {
          setData(null);
          setError(
            err instanceof OperationsApiError ? err.message : "Error al cargar debug."
          );
        }
      } finally {
        if (active) setLoading(false);
      }
    }

    void load();
    return () => {
      active = false;
    };
  }, []);

  const filteredItems = useMemo(() => {
    if (!data) return [];
    if (sectorFilter === "all") return data.workItems;
    return data.workItems.filter((item) => item.sector === sectorFilter);
  }, [data, sectorFilter]);

  if (loading) {
    return (
      <div className="flex items-center gap-2 py-12 text-sm text-[var(--muted-foreground)]">
        <Loader2 className="size-4 animate-spin" />
        Cargando diagnóstico…
      </div>
    );
  }

  if (error) {
    return (
      <Alert variant="problem" title="Error">
        {error}
      </Alert>
    );
  }

  if (!data) return null;

  return (
    <div className="flex flex-col gap-6">
      <Alert variant="info" title="Solo desarrollo">
        Diagnóstico técnico F8.1. Validación funcional en{" "}
        <Link href="/mi-trabajo" className="font-medium text-[var(--color-action)] hover:underline">
          /mi-trabajo
        </Link>
        .
      </Alert>

      {data.message && (
        <Alert variant="ok" title="Estado">
          {data.message}
        </Alert>
      )}

      <section className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <div className="rounded-lg border border-[var(--border)] p-4">
          <p className="text-xs text-[var(--muted-foreground)]">Total WorkItems</p>
          <p className="text-3xl font-bold">{data.totalCount}</p>
        </div>
        <div className="rounded-lg border border-[var(--border)] p-4">
          <p className="text-xs text-[var(--muted-foreground)]">dependsOn</p>
          <p className="text-3xl font-bold">{data.dependencies.withDependsOn}</p>
        </div>
        <div className="rounded-lg border border-[var(--border)] p-4">
          <p className="text-xs text-[var(--muted-foreground)]">blockedBy</p>
          <p className="text-3xl font-bold">{data.dependencies.withBlockedBy}</p>
        </div>
        <div className="rounded-lg border border-[var(--border)] p-4">
          <p className="text-xs text-[var(--muted-foreground)]">mapperWarnings</p>
          <p className="text-3xl font-bold">{data.mapperWarnings.length}</p>
        </div>
      </section>

      <section className="rounded-lg border border-[var(--border)] p-4">
        <h2 className="text-sm font-semibold">WorkItems por sector</h2>
        <div className="mt-3">
          <MetricGrid
            data={Object.fromEntries(
              Object.entries(data.bySector).map(([k, v]) => [
                SECTOR_LABELS[k as keyof typeof SECTOR_LABELS] ?? k,
                v,
              ])
            )}
          />
        </div>
      </section>

      <section className="grid gap-4 lg:grid-cols-2">
        <div className="rounded-lg border border-[var(--border)] p-4">
          <h2 className="text-sm font-semibold">WorkItems por origen</h2>
          <div className="mt-3">
            <MetricGrid data={data.bySource as Record<string, number>} />
          </div>
          <div className="mt-4 space-y-2 text-sm">
            <p>
              SEMANAS indexado:{" "}
              <Chip variant="outline" size="sm">
                {data.sourcesIndexed.semanas_2026 ? "sí" : "no"}
              </Chip>{" "}
              · mapeados: {data.sourcesMapped.semanas_2026}
            </p>
            <p>
              PEDIDOS indexado:{" "}
              <Chip variant="outline" size="sm">
                {data.sourcesIndexed.pedidos_2026 ? "sí" : "no"}
              </Chip>{" "}
              · mapeados: {data.sourcesMapped.pedidos_2026}
            </p>
            <p>
              LOTES indexado:{" "}
              <Chip variant="outline" size="sm">
                {data.sourcesIndexed.asignacion_lotes_2026 ? "sí" : "no"}
              </Chip>{" "}
              · mapeados: {data.sourcesMapped.asignacion_lotes_2026}
            </p>
          </div>
        </div>
        <div className="rounded-lg border border-[var(--border)] p-4">
          <h2 className="text-sm font-semibold">originStage · prioridad · confidence</h2>
          <div className="mt-3 space-y-4">
            <div>
              <p className="mb-2 text-xs font-medium text-[var(--muted-foreground)]">originStage</p>
              <MetricGrid data={data.byOriginStage as Record<string, number>} />
            </div>
            <div>
              <p className="mb-2 text-xs font-medium text-[var(--muted-foreground)]">prioridad</p>
              <MetricGrid data={data.byPriority} />
            </div>
            <div>
              <p className="mb-2 text-xs font-medium text-[var(--muted-foreground)]">confidence</p>
              <MetricGrid data={data.byConfidence as Record<string, number>} />
            </div>
          </div>
        </div>
      </section>

      {data.gaps.length > 0 && (
        <section className="rounded-lg border border-[var(--border)] p-4">
          <h2 className="text-sm font-semibold">Campos sin mapear (null)</h2>
          <div className="mt-3 overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b text-left text-xs text-[var(--muted-foreground)]">
                  <th className="py-2">campo</th>
                  <th className="py-2">faltante</th>
                  <th className="py-2">total</th>
                </tr>
              </thead>
              <tbody>
                {data.gaps.map((gap) => (
                  <tr key={gap.field} className="border-b border-[var(--border-subtle)]">
                    <td className="py-2">{gap.field}</td>
                    <td className="py-2">{gap.missingCount}</td>
                    <td className="py-2">{gap.totalCount}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}

      {data.mapperWarnings.length > 0 && (
        <section className="rounded-lg border border-[var(--border)] p-4">
          <h2 className="text-sm font-semibold">mapperWarnings</h2>
          <ul className="mt-3 max-h-48 space-y-1 overflow-y-auto text-sm">
            {data.mapperWarnings.map((warning) => (
              <li key={warning} className="text-[var(--muted-foreground)]">
                · {warning}
              </li>
            ))}
          </ul>
        </section>
      )}

      <section className="rounded-lg border border-[var(--border)] p-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h2 className="text-sm font-semibold">Todos los WorkItems ({filteredItems.length})</h2>
          <select
            value={sectorFilter}
            onChange={(e) => setSectorFilter(e.target.value)}
            className="h-9 rounded-md border border-[var(--border)] bg-[var(--background)] px-3 text-sm"
          >
            <option value="all">Todos los sectores</option>
            {Object.keys(data.bySector).map((sectorId) => (
              <option key={sectorId} value={sectorId}>
                {SECTOR_LABELS[sectorId as keyof typeof SECTOR_LABELS] ?? sectorId}
              </option>
            ))}
          </select>
        </div>
        <div className="mt-4">
          <WorkItemsTable items={filteredItems} />
        </div>
      </section>
    </div>
  );
}
