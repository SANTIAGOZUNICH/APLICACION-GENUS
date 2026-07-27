"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { TwinShell } from "@/features/os/shell/twin-shell";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/dialog";
import { SchemaPendingBanner } from "@/components/ui/schema-pending-banner";
import { usePreviewSession } from "@/features/os/session/preview-context";
import { fetchMetricasApi, metricasActionApi } from "@/lib/metricas/metricas-client";
import {
  canAccessMetricas,
  type MetricsRankingEntry,
  type PackagingMetricRecord,
} from "@/lib/metricas/types";
import { SECTOR_LABELS } from "@/types/operational/sector";

export function MetricasView() {
  const { email, sectorId } = usePreviewSession();
  const session = useMemo(
    () => ({ email: email ?? "", sector: sectorId }),
    [email, sectorId]
  );

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

  const [filterDateFrom, setFilterDateFrom] = useState("");
  const [filterDateTo, setFilterDateTo] = useState("");
  const [filterProduct, setFilterProduct] = useState("");
  const [filterResponsible, setFilterResponsible] = useState("");

  const [editId, setEditId] = useState<string | null>(null);
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);

  const reload = useCallback(async () => {
    try {
      const data = await fetchMetricasApi(session, {
        dateFrom: filterDateFrom || undefined,
        dateTo: filterDateTo || undefined,
        product: filterProduct || undefined,
        responsible: filterResponsible || undefined,
      });
      setMetrics(data.metrics);
      setRanking(data.ranking);
      setTotals(data.totals);
      setSchemaPending(data.schemaPending);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Error al cargar métricas");
    }
  }, [session, filterDateFrom, filterDateTo, filterProduct, filterResponsible]);

  useEffect(() => {
    void reload();
  }, [reload]);

  if (!canAccessMetricas(sectorId)) {
    return (
      <TwinShell title="Métricas">
        <p className="text-sm text-muted-foreground">
          Métricas disponibles solo para Envasado Masivo y Premium.
        </p>
      </TwinShell>
    );
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    try {
      const payload = {
        metricDate,
        product: product.trim() || null,
        units: Number(units),
        responsibleDisplay: responsible.trim(),
      };
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
      setError(err instanceof Error ? err.message : "Error al eliminar");
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
        </div>

        <div className="overflow-x-auto rounded border">
          <table className="w-full text-sm" data-testid="metricas-table">
            <thead className="bg-muted/50">
              <tr>
                <th className="px-3 py-2 text-left">Fecha</th>
                <th className="px-3 py-2 text-left">Producto</th>
                <th className="px-3 py-2 text-right">Unidades</th>
                <th className="px-3 py-2 text-left">Responsable</th>
                <th className="px-3 py-2" />
              </tr>
            </thead>
            <tbody>
              {metrics.map((m) => (
                <tr key={m.id} className="border-t">
                  <td className="px-3 py-2">{m.metricDate}</td>
                  <td className="px-3 py-2">{m.product ?? "—"}</td>
                  <td className="px-3 py-2 text-right">{m.units.toLocaleString()}</td>
                  <td className="px-3 py-2">{m.responsibleDisplay}</td>
                  <td className="px-3 py-2 text-right">
                    <Button size="sm" variant="tertiary" disabled={busy || schemaPending} onClick={() => startEdit(m)}>
                      Editar
                    </Button>
                    <Button
                      size="sm"
                      variant="tertiary"
                      disabled={busy || schemaPending}
                      onClick={() => setConfirmDeleteId(m.id)}
                    >
                      Eliminar
                    </Button>
                  </td>
                </tr>
              ))}
              {metrics.length === 0 && (
                <tr>
                  <td colSpan={5} className="px-3 py-6 text-center text-muted-foreground">
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
            {ranking.map((r, i) => (
              <li key={r.responsibleKey} className="flex justify-between rounded border px-3 py-2 text-sm">
                <span>
                  {i + 1}. {r.responsibleDisplay}
                </span>
                <span className="font-medium">{r.totalUnits.toLocaleString()} u.</span>
              </li>
            ))}
            {ranking.length === 0 && (
              <li className="text-sm text-muted-foreground">Sin datos para ranking</li>
            )}
          </ul>
        </section>

        <ConfirmDialog
          open={Boolean(confirmDeleteId)}
          onOpenChange={(open) => {
            if (!open) setConfirmDeleteId(null);
          }}
          title="Confirmar eliminación"
          description="¿Eliminar este registro de métricas?"
          confirmLabel="Eliminar"
          onConfirm={() => void handleDelete()}
          onCancel={() => setConfirmDeleteId(null)}
        />
      </div>
    </TwinShell>
  );
}
