"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { CheckCircle2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { displayField } from "@/lib/operational/display-fields";
import { TwinShell } from "@/features/os/shell/twin-shell";
import { useRequiredWorkspace } from "@/features/os/workspace/workspace-provider";
import { useOperationalPlan } from "../hooks/use-operational-plan";
import { getFormulaForProduct } from "../adapters/formula-repository";
import { getTotalStockByCodigo } from "../adapters/materia-prima-repository";
import {
  confirmPreparation,
  getConfirmation,
  isCodePrepared,
  setCodePrepared,
} from "../adapters/mp-preparation-store";
import { pushNotification } from "@/features/os/feedback/notifications-store";

/** Control de Materias Primas — compara fórmula requerida contra stock por OE. */
export function MateriaPrimaControlView() {
  const workspace = useRequiredWorkspace();
  const { data, loading } = useOperationalPlan("ELABORACION");
  const [selectedOeOverride, setSelectedOeOverride] = useState<string | null>(null);
  const [tick, setTick] = useState(0);
  const notifiedRefsRef = useRef<Set<string>>(new Set());

  const pendingWorks = useMemo(() => {
    const items = data?.workItems ?? [];
    const byRef = new Map<string, (typeof items)[number]>();
    for (const item of items) {
      if (!item.oeRef) continue;
      if (item.status === "completo" || item.status === "revision" || item.status === "cancelado") continue;
      if (!byRef.has(item.oeRef)) byRef.set(item.oeRef, item);
    }
    return [...byRef.values()];
  }, [data?.workItems]);

  const selectedOe = selectedOeOverride ?? pendingWorks[0]?.oeRef ?? "";
  const setSelectedOe = setSelectedOeOverride;

  const selectedWork = pendingWorks.find((w) => w.oeRef === selectedOe) ?? null;
  const formula = getFormulaForProduct(selectedWork?.product);

  const lines = useMemo(
    () =>
      (formula?.lines ?? []).map((line) => {
        const stock = getTotalStockByCodigo(line.codigo);
        const faltante = stock < line.cantidadRequerida;
        const prepared = selectedOe ? isCodePrepared(selectedOe, line.codigo) : false;
        return { ...line, stock, faltante, prepared };
      }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [formula, selectedOe, tick]
  );

  useEffect(() => {
    if (!selectedOe || lines.length === 0) return;
    const hasFaltante = lines.some((l) => l.faltante);
    if (hasFaltante && !notifiedRefsRef.current.has(selectedOe)) {
      notifiedRefsRef.current.add(selectedOe);
      pushNotification({
        kind: "mp_faltante",
        title: "Faltante de materia prima",
        sectors: ["MATERIA_PRIMA", "PRODUCCION", "ELABORACION"],
        message: `${selectedWork?.product ?? "Producto"} (${selectedOe}) tiene materias primas faltantes.`,
      });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedOe, lines]);

  const preparedCount = lines.filter((l) => l.prepared).length;
  const allPrepared = lines.length > 0 && preparedCount === lines.length;
  const confirmation = selectedOe ? getConfirmation(selectedOe) : null;

  const toggleLine = (codigo: string, faltante: boolean, currentlyPrepared: boolean) => {
    if (faltante || !selectedOe) return;
    setCodePrepared(selectedOe, codigo, !currentlyPrepared, workspace.context.displayName);
    setTick((v) => v + 1);
  };

  const handleConfirm = () => {
    if (!selectedOe || !allPrepared) return;
    confirmPreparation(selectedOe, workspace.context.displayName);
    setTick((v) => v + 1);
  };

  return (
    <TwinShell title="Control de Materias Primas">
    <div className="space-y-4">
      <header className="space-y-2">
        <h2 className="text-2xl font-semibold tracking-tight">Control de Materias Primas</h2>
        <p className="text-sm text-[var(--os-text-muted)]">
          {workspace.sectorLabel} · preparación de MP para Elaboración
        </p>
      </header>

      <div className="max-w-md space-y-1.5">
        <label htmlFor="oe-select" className="text-sm font-medium text-[var(--os-text)]">
          Orden de Elaboración
        </label>
        <select
          id="oe-select"
          value={selectedOe}
          onChange={(e) => setSelectedOe(e.target.value)}
          className="w-full rounded-[var(--os-radius-sm)] border border-[var(--os-border)] bg-[var(--os-surface)] px-3 py-2 text-sm"
        >
          {pendingWorks.length === 0 && <option value="">Sin OE pendientes</option>}
          {pendingWorks.map((w) => (
            <option key={w.oeRef} value={w.oeRef ?? ""}>
              {w.oeRef} · {w.product} · {w.client}
            </option>
          ))}
        </select>
      </div>

      {loading && <div className="os-skeleton h-32 rounded-[var(--os-radius-sm)]" />}

      {!loading && selectedWork && formula && (
        <div className="rounded-[var(--os-radius)] border border-[var(--os-border)] bg-[var(--os-surface)] p-5">
          <div className="grid grid-cols-2 gap-4 border-b border-[var(--os-border-subtle)] pb-4 sm:grid-cols-4">
            <div>
              <p className="text-xs uppercase text-[var(--os-text-muted)]">Producto</p>
              <p className="font-medium">{displayField(selectedWork.product)}</p>
            </div>
            <div>
              <p className="text-xs uppercase text-[var(--os-text-muted)]">Cliente</p>
              <p className="font-medium">{displayField(selectedWork.client)}</p>
            </div>
            <div>
              <p className="text-xs uppercase text-[var(--os-text-muted)]">Cantidad</p>
              <p className="font-medium">
                {selectedWork.quantity} {selectedWork.unit ?? "kg"}
              </p>
            </div>
            <div>
              <p className="text-xs uppercase text-[var(--os-text-muted)]">Responsable</p>
              <p className="font-medium">{displayField(selectedWork.ownerPerson)}</p>
            </div>
          </div>

          {formula.estimated && (
            <p className="mt-3 rounded border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-900">
              Fórmula estimada (demo) — todavía no hay BOM cargado para este producto.
            </p>
          )}

          <ul className="mt-4 divide-y divide-[var(--os-border-subtle)]">
            {lines.map((line) => (
              <li key={line.codigo} className="flex items-center justify-between gap-4 py-3">
                <label className="flex flex-1 items-start gap-3">
                  <input
                    type="checkbox"
                    checked={line.prepared}
                    disabled={line.faltante}
                    onChange={() => toggleLine(line.codigo, line.faltante, line.prepared)}
                    className="mt-0.5 size-4 accent-[var(--os-teal)] disabled:opacity-40"
                    aria-label={`Marcar ${line.nombre} como preparada`}
                  />
                  <span>
                    <span className="block font-medium">{line.nombre}</span>
                    <span className="block text-xs text-[var(--os-text-muted)]">
                      Requiere {line.cantidadRequerida.toFixed(2)} {line.unidad} · Stock{" "}
                      {line.stock.toFixed(2)} {line.unidad}
                    </span>
                  </span>
                </label>
                <span
                  className={`rounded px-2 py-0.5 text-xs font-medium ${
                    line.faltante ? "bg-rose-50 text-rose-800" : "bg-emerald-50 text-emerald-800"
                  }`}
                >
                  {line.faltante ? "Faltante" : "Disponible"}
                </span>
              </li>
            ))}
          </ul>

          <div className="mt-5 flex flex-wrap items-center justify-between gap-3 border-t border-[var(--os-border-subtle)] pt-4">
            <p className="text-sm font-medium text-[var(--os-text)]">
              {preparedCount} de {lines.length} materias primas preparadas
            </p>
            {confirmation ? (
              <span className="inline-flex items-center gap-1.5 text-sm font-medium text-emerald-700">
                <CheckCircle2 className="size-4" aria-hidden="true" />
                Preparación confirmada por {confirmation.confirmedBy}
              </span>
            ) : (
              <Button variant="primary" disabled={!allPrepared} onClick={handleConfirm}>
                Confirmar preparación
              </Button>
            )}
          </div>
        </div>
      )}

      {!loading && pendingWorks.length === 0 && (
        <p className="rounded-[var(--os-radius-sm)] border border-dashed border-[var(--os-border)] px-4 py-8 text-center text-sm text-[var(--os-text-muted)]">
          No hay órdenes de Elaboración pendientes para controlar.
        </p>
      )}
    </div>
    </TwinShell>
  );
}
