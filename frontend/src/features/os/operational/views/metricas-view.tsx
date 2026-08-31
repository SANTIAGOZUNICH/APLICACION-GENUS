"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { TwinShell } from "@/features/os/shell/twin-shell";
import { Button } from "@/components/ui/button";
import { LifecycleConfirmDialog } from "@/features/os/operational/components/lifecycle-confirm-dialog";
import { syntheticLifecycleItem } from "@/features/os/operational/components/lifecycle-synthetic";
import { SchemaPendingBanner } from "@/components/ui/schema-pending-banner";
import { usePreviewSession } from "@/features/os/session/preview-context";
import { fetchMetricasApi, metricasActionApi } from "@/lib/metricas/metricas-client";
import {
  canAccessMetricas,
  canAdminAllMetricas,
  type MetricsRankingEntry,
  type MetricsSector,
  type PackagingMetricRecord,
} from "@/lib/metricas/types";
import { SECTOR_LABELS } from "@/types/operational/sector";
import { SortSelect } from "@/features/os/operational/components/sort-select";
import { useSortPreference } from "@/features/os/operational/lib/use-sort-preference";
import { applySort, compareDates, compareNumbers, compareStrings, type SortOption } from "@/lib/sorting/sort-contract";

export const METRICAS_SORT_OPTIONS: SortOption<PackagingMetricRecord>[] = [
  { key: "fecha_desc", label: "Más recientes", compare: (a, b) => compareDates(a.metricDate, b.metricDate, "desc") },
  { key: "fecha_asc", label: "Más antiguos", compare: (a, b) => compareDates(a.metricDate, b.metricDate, "asc") },
  { key: "producto_asc", label: "Producto A-Z", compare: (a, b) => compareStrings(a.product, b.product, "asc") },
  { key: "unidades_desc", label: "Unidades mayor a menor", compare: (a, b) => compareNumbers(a.units, b.units, "desc") },
  { key: "unidades_asc", label: "Unidades menor a mayor", compare: (a, b) => compareNumbers(a.units, b.units, "asc") },
  { key: "responsable_asc", label: "Responsable A-Z", compare: (a, b) => compareStrings(a.responsibleDisplay, b.responsibleDisplay, "asc") },
];
const METRICAS_SORT_KEYS = METRICAS_SORT_OPTIONS.map((o) => o.key);

export function MetricasView() {
  const { email, sectorId } = usePreviewSession();
  const session = useMemo(
    () => ({ email: email ?? "", sector: sectorId }),
    [email, sectorId]
  );
  const isProdAdmin = canAdminAllMetricas(sectorId);

  const [metrics, setMetrics] = useState<PackagingMetricRecord[]>([]);
  const [ranking, setRanking] = useState<MetricsRankingEntry[]>([]);
  const [totals, setTotals] = useState({ totalUnits: 0, recordCount: 0 });
  const [schemaPending, setSchemaPending] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [metricDate, setMetricDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [product, setProduct] = useState("");
  const [units, setUnits] = useState("");
  const [responsible, setResponsible] = useState("");
  const [targetSector, setTargetSector] = useState<MetricsSector>("ENVASADO_MASIVO");

  const [filterDateFrom, setFilterDateFrom] = useState("");
  const [filterDateTo, setFilterDateTo] = useState("");
  const [filterProduct, setFilterProduct] = useState("");
  const [filterResponsible, setFilterResponsible] = useState("");
  const [filterSector, setFilterSector] = useState<"ALL" | MetricsSector>("ALL");

  const [editId, setEditId] = useState<string | null>(null);
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);
  const [confirmDeleteLabel, setConfirmDeleteLabel] = useState("");
  const [showArchived, setShowArchived] = useState(false);
  const [sort, setSort] = useSortPreference("metricas", "fecha_desc", METRICAS_SORT_KEYS);
  const sortedMetrics = useMemo(() => applySort(metrics, METRICAS_SORT_OPTIONS, sort), [metrics, sort]);

  const reload = useCallback(async () => {
    try {
      const data = await fetchMetricasApi(session, {
        dateFrom: filterDateFrom || undefined,
        dateTo: filterDateTo || undefined,
        product: filterProduct || undefined,
        responsible: filterResponsible || undefined,
        sector: isProdAdmin ? filterSector : undefined,
        onlyDeleted: showArchived,
      });
      setMetrics(data.metrics);
      setRanking(data.ranking);
      setTotals(data.totals);
      setSchemaPending(data.schemaPending);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Error al cargar métricas");
    }
  }, [
    session,
    filterDateFrom,
    filterDateTo,
    filterProduct,
    filterResponsible,
    filterSector,
    isProdAdmin,
    showArchived,
  ]);

  useEffect(() => {
    void reload();
  }, [reload]);

  if (!canAccessMetricas(sectorId)) {
    return (
      <TwinShell title="Métricas">
        <p className="text-sm text-muted-foreground">
          Métricas disponibles para Envasado Masivo, Premium y Producción.
        </p>
      </TwinShell>
    );
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    try {
      const payload: Record<string, unknown> = {
        metricDate,
        product: product.trim() || null,
        units: Number(units),
        responsibleDisplay: responsible.trim(),
      };
      if (isProdAdmin && !editId) {
        payload.targetSector = targetSector;
      }
      if (editId) {
        await metricasActionApi(session, "update", { id: editId, ...payload });
        setEditId(null);
      } else {
        await metricasActionApi(session, "create", payload);
      }
      setProduct("");
      setUnits("");
      setResponsible("");
      await reload();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Error al guardar");
    } finally {
      setBusy(false);
    }
  }

  function startEdit(m: PackagingMetricRecord) {
    setEditId(m.id);
    setMetricDate(m.metricDate);
    setProduct(m.product ?? "");
    setUnits(String(m.units));
    setResponsible(m.responsibleDisplay);
  }

  async function handleDelete() {
    if (!confirmDeleteId) return;
    setBusy(true);
    try {
      await metricasActionApi(session, "delete", { id: confirmDeleteId });
      setConfirmDeleteId(null);
      await reload();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Error al archivar");
    } finally {
      setBusy(false);
    }
  }

  async function handleRestore(id: string) {
    setBusy(true);
    try {
      await metricasActionApi(session, "restore", { id });
      await reload();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Error al restaurar");
    } finally {
      setBusy(false);
    }
  }

  return (
    <TwinShell title={`Métricas — ${SECTOR_LABELS[sectorId]}`}>
      <div className="space-y-6">
        <SchemaPendingBanner show={schemaPending} />
        {error && (
          <div className="rounded border border-red-300 bg-red-50 px-3 py-2 text-sm text-red-900">
            {error}
          </div>
        )}

        <form onSubmit={(e) => void handleSubmit(e)} className="grid gap-3 rounded border p-4 sm:grid-cols-2 lg:grid-cols-5">
          <label className="text-sm">
            Fecha
            <input
              type="date"
              value={metricDate}
              onChange={(e) => setMetricDate(e.target.value)}
              className="mt-1 block w-full rounded border px-2 py-1"
              required
              data-testid="metricas-fecha"
            />
          </label>
          <label className="text-sm">
            Producto
            <input
              value={product}
              onChange={(e) => setProduct(e.target.value)}
              className="mt-1 block w-full rounded border px-2 py-1"
              placeholder="Opcional"
            />
          </label>
          <label className="text-sm">
            Unidades
            <input
              type="number"
              min={0}
              value={units}
              onChange={(e) => setUnits(e.target.value)}
              className="mt-1 block w-full rounded border px-2 py-1"
              required
              data-testid="metricas-unidades"
            />
          </label>
          <label className="text-sm">
            Responsable
            <input
              value={responsible}
              onChange={(e) => setResponsible(e.target.value)}
              className="mt-1 block w-full rounded border px-2 py-1"
              required
              data-testid="metricas-responsable"
            />
          </label>
          {isProdAdmin && !editId ? (
            <label className="text-sm">
              Sector
              <select
                className="mt-1 block w-full rounded border px-2 py-1"
                value={targetSector}
                onChange={(e) => setTargetSector(e.target.value as MetricsSector)}
                data-testid="metricas-target-sector"
              >
                <option value="ENVASADO_MASIVO">Envasado Masivo</option>
                <option value="ENVASADO_PREMIUM">Envasado Premium</option>
              </select>
            </label>
          ) : null}
          <div className="flex items-end gap-2">
            <Button type="submit" disabled={busy || schemaPending} data-testid="metricas-agregar">
              {editId ? "Guardar" : "Agregar registro"}
            </Button>
            {editId && (
              <Button type="button" variant="secondary" onClick={() => setEditId(null)}>
                Cancelar
              </Button>
            )}
          </div>
        </form>

        <div className="flex flex-wrap gap-2">
          <Button
            type="button"
            size="sm"
            variant={showArchived ? "secondary" : "tertiary"}
            onClick={() => setShowArchived(false)}
          >
            Activos
          </Button>
          <Button
            type="button"
            size="sm"
            variant={showArchived ? "tertiary" : "secondary"}
            onClick={() => setShowArchived(true)}
            data-testid="metricas-tab-archived"
          >
            Archivados
          </Button>
          {isProdAdmin ? (
            <select
              value={filterSector}
              onChange={(e) =>
                setFilterSector(e.target.value as "ALL" | MetricsSector)
              }
              className="rounded border px-2 py-1 text-sm"
              data-testid="metricas-filter-sector"
            >
              <option value="ALL">Todos</option>
              <option value="ENVASADO_MASIVO">Envasado Masivo</option>
              <option value="ENVASADO_PREMIUM">Envasado Premium</option>
            </select>
          ) : null}
          <input
            type="date"
            value={filterDateFrom}
            onChange={(e) => setFilterDateFrom(e.target.value)}
            className="rounded border px-2 py-1 text-sm"
            placeholder="Desde"
          />
          <input
            type="date"
            value={filterDateTo}
            onChange={(e) => setFilterDateTo(e.target.value)}
            className="rounded border px-2 py-1 text-sm"
            placeholder="Hasta"
          />
          <input
            value={filterProduct}
            onChange={(e) => setFilterProduct(e.target.value)}
            placeholder="Producto"
            className="rounded border px-2 py-1 text-sm"
          />
          <input
            value={filterResponsible}
            onChange={(e) => setFilterResponsible(e.target.value)}
            placeholder="Responsable"
            className="rounded border px-2 py-1 text-sm"
          />
          <SortSelect value={sort} onChange={setSort} options={METRICAS_SORT_OPTIONS} testId="metricas-sort" />
        </div>

        <div className="os-table-wrap overflow-x-clip rounded border">
          <table className="os-table w-full max-w-full table-fixed text-[length:var(--os-table-font,13px)]" data-testid="metricas-table">
            <thead className="bg-muted/50">
              <tr>
                <th className="px-3 py-2 text-left">Fecha</th>
                {isProdAdmin ? (
                  <th className="hidden px-3 py-2 text-left md:table-cell">Sector</th>
                ) : null}
                <th className="px-3 py-2 text-left">Producto</th>
                <th className="px-3 py-2 text-right">Unidades</th>
                <th className="hidden px-3 py-2 text-left md:table-cell">Responsable</th>
                <th className="px-3 py-2" />
              </tr>
            </thead>
            <tbody>
              {sortedMetrics.map((m) => (
                <tr key={m.id} className="border-t">
                  <td className="px-3 py-2">{m.metricDate}</td>
                  {isProdAdmin ? (
                    <td className="hidden px-3 py-2 text-xs md:table-cell">
                      {SECTOR_LABELS[m.sector] ?? m.sector}
                    </td>
                  ) : null}
                  <td className="px-3 py-2">
                    <span className="os-break">{m.product ?? "—"}</span>
                  </td>
                  <td className="px-3 py-2 text-right">{m.units.toLocaleString()}</td>
                  <td className="hidden px-3 py-2 md:table-cell">
                    <span className="os-break">{m.responsibleDisplay}</span>
                  </td>
                  <td className="px-3 py-2 text-right">
                    {showArchived ? (
                      <Button
                        size="sm"
                        variant="tertiary"
                        disabled={busy || schemaPending}
                        onClick={() => void handleRestore(m.id)}
                      >
                        Restaurar
                      </Button>
                    ) : (
                      <>
                        <Button size="sm" variant="tertiary" disabled={busy || schemaPending} onClick={() => startEdit(m)}>
                          Editar
                        </Button>
                        <Button
                          size="sm"
                          variant="tertiary"
                          disabled={busy || schemaPending}
                          onClick={() => {
                            setConfirmDeleteId(m.id);
                            setConfirmDeleteLabel(m.product ?? m.responsibleDisplay ?? m.id);
                          }}
                        >
                          Borrar
                        </Button>
                      </>
                    )}
                  </td>
                </tr>
              ))}
              {metrics.length === 0 && (
                <tr>
                  <td colSpan={isProdAdmin ? 6 : 5} className="px-3 py-6 text-center text-muted-foreground">
                    Sin registros
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>

        <section>
          <h3 className="mb-2 font-medium">Ranking por responsable</h3>
          <p className="mb-2 text-sm text-muted-foreground">
            Total: {totals.totalUnits.toLocaleString()} unidades en {totals.recordCount} registros
          </p>
          <ul className="space-y-1" data-testid="metricas-ranking">
            {ranking.map((r, i) => {
              const pct =
                totals.totalUnits > 0
                  ? Math.round((r.totalUnits / totals.totalUnits) * 1000) / 10
                  : 0;
              return (
                <li
                  key={`${r.responsibleKey}-${r.sector ?? "all"}`}
                  className="flex justify-between gap-2 rounded border px-3 py-2 text-sm"
                >
                  <span>
                    {i + 1}. {r.responsibleDisplay}
                    {r.sector ? (
                      <span className="ml-2 text-xs text-muted-foreground">
                        ({SECTOR_LABELS[r.sector] ?? r.sector})
                      </span>
                    ) : null}
                    {r.sectorBreakdown && !r.sector ? (
                      <span className="ml-2 text-xs text-muted-foreground">
                        {[
                          r.sectorBreakdown.ENVASADO_MASIVO
                            ? `Masivo ${r.sectorBreakdown.ENVASADO_MASIVO}`
                            : null,
                          r.sectorBreakdown.ENVASADO_PREMIUM
                            ? `Premium ${r.sectorBreakdown.ENVASADO_PREMIUM}`
                            : null,
                        ]
                          .filter(Boolean)
                          .join(" · ")}
                      </span>
                    ) : null}
                  </span>
                  <span className="shrink-0 font-medium">
                    {r.totalUnits.toLocaleString()} u. · {r.recordCount} reg. · {pct}%
                  </span>
                </li>
              );
            })}
            {ranking.length === 0 && (
              <li className="text-sm text-muted-foreground">Sin datos para ranking</li>
            )}
          </ul>
        </section>

        <LifecycleConfirmDialog
          pending={
            confirmDeleteId
              ? syntheticLifecycleItem(
                  "archivar",
                  "Archivar métrica",
                  "¿Archivar este registro? Podés restaurarlo desde la pestaña Archivados."
                )
              : null
          }
          forceReason
          entityLabel={confirmDeleteLabel}
          onClose={() => {
            setConfirmDeleteId(null);
            setConfirmDeleteLabel("");
          }}
          onConfirm={async () => {
            await handleDelete();
          }}
        />
      </div>
    </TwinShell>
  );
}
