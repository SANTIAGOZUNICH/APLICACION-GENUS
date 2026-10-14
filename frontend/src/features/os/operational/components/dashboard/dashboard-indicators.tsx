"use client";

import { Pencil } from "lucide-react";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { fmtDays, fmtInt, fmtPercent } from "@/lib/dashboard/format";
import type { DashboardIndicatorRow, DashboardUnit } from "@/lib/dashboard/types";
import { DashboardSemaforo } from "./dashboard-semaforo";

export function formatByUnit(value: number, unit: DashboardUnit): string {
  if (unit === "percent") return fmtPercent(value);
  if (unit === "days") return fmtDays(value);
  return fmtInt(value);
}

function targetText(row: DashboardIndicatorRow): string {
  if (!row.target) return "Sin objetivo definido";
  return `${row.target.direction === "min" ? "≥" : "≤"} ${formatByUnit(row.target.targetValue, row.unit)}`;
}

type EditorProps = {
  row: DashboardIndicatorRow;
  busy: boolean;
  onSave: (input: { key: string; value: number; direction: "min" | "max" }) => Promise<void>;
  onClear: (key: string) => Promise<void>;
  onCancel: () => void;
};

function TargetEditor({ row, busy, onSave, onClear, onCancel }: EditorProps) {
  const [value, setValue] = useState(row.target ? String(row.target.targetValue).replace(".", ",") : "");
  const [direction, setDirection] = useState<"min" | "max">(row.target?.direction ?? row.defaultDirection);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    const n = Number(value.trim().replace(",", "."));
    if (value.trim() === "" || !Number.isFinite(n)) {
      setError("Ingresá un número.");
      return;
    }
    setError(null);
    try {
      await onSave({ key: row.key, value: n, direction });
    } catch (err) {
      setError(err instanceof Error ? err.message : "No se pudo guardar.");
    }
  }

  return (
    <form
      onSubmit={(e) => void submit(e)}
      className="mt-2 grid gap-2 rounded-[var(--os-radius-sm)] bg-black/20 p-3 sm:grid-cols-[minmax(0,1fr)_minmax(0,1.4fr)_auto]"
      data-testid={`target-editor-${row.key}`}
    >
      <label className="min-w-0 text-xs text-[var(--os-text-muted)]">
        Objetivo ({row.unit === "percent" ? "%" : row.unit === "days" ? "días" : "unidades"})
        <input
          inputMode="decimal"
          value={value}
          onChange={(e) => setValue(e.target.value)}
          className="mt-1 block h-9 w-full min-w-0 rounded border border-[var(--os-border)] bg-[var(--os-bg)] px-2 text-sm text-[var(--os-text)]"
          data-testid={`target-input-${row.key}`}
          aria-invalid={error ? true : undefined}
        />
      </label>
      <label className="min-w-0 text-xs text-[var(--os-text-muted)]">
        Sentido
        <select
          value={direction}
          onChange={(e) => setDirection(e.target.value as "min" | "max")}
          className="mt-1 block h-9 w-full min-w-0 rounded border border-[var(--os-border)] bg-[var(--os-bg)] px-2 text-sm text-[var(--os-text)]"
          data-testid={`target-direction-${row.key}`}
        >
          <option value="min">Más alto es mejor (cumple si ≥ objetivo)</option>
          <option value="max">Más bajo es mejor (cumple si ≤ objetivo)</option>
        </select>
      </label>
      <div className="flex flex-wrap items-end gap-2">
        <Button type="submit" size="sm" disabled={busy} data-testid={`target-save-${row.key}`}>
          Guardar
        </Button>
        {row.target ? (
          <Button type="button" size="sm" variant="secondary" disabled={busy} onClick={() => void onClear(row.key)} data-testid={`target-clear-${row.key}`}>
            Quitar
          </Button>
        ) : null}
        <Button type="button" size="sm" variant="tertiary" onClick={onCancel}>
          Cancelar
        </Button>
      </div>
      {error ? (
        <p className="text-xs text-red-300 sm:col-span-3" role="alert">
          {error}
        </p>
      ) : null}
      <p className="text-[11px] leading-snug text-[var(--os-text-muted)] sm:col-span-3">
        Semáforo: verde si cumple el objetivo; amarillo si queda hasta 10 % por fuera; rojo si queda peor. Los cambios quedan auditados.
      </p>
    </form>
  );
}

type Props = {
  rows: DashboardIndicatorRow[];
  canEditTargets: boolean;
  schemaPending: boolean;
  onSaveTarget: EditorProps["onSave"];
  onClearTarget: EditorProps["onClear"];
};

/** Indicadores operativos: resultado actual, objetivo, estado y semáforo. */
export function DashboardIndicators({ rows, canEditTargets, schemaPending, onSaveTarget, onClearTarget }: Props) {
  const [editing, setEditing] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function save(input: { key: string; value: number; direction: "min" | "max" }) {
    setBusy(true);
    try {
      await onSaveTarget(input);
      setEditing(null);
    } finally {
      setBusy(false);
    }
  }
  async function clear(key: string) {
    setBusy(true);
    try {
      await onClearTarget(key);
      setEditing(null);
    } finally {
      setBusy(false);
    }
  }

  return (
    <section
      className="min-w-0 rounded-[var(--os-radius)] border border-[var(--os-border)] bg-[var(--os-surface)] p-4 shadow-[var(--os-shadow-sm)]"
      aria-label="Indicadores operativos"
      data-testid="dashboard-indicators"
    >
      <h3 className="text-sm font-semibold text-[var(--os-text)]">Indicadores operativos</h3>
      <p className="mb-3 mt-0.5 text-xs text-[var(--os-text-muted)]">Resultado actual contra el objetivo definido por Producción/Dirección. No hay objetivos por defecto.</p>
      {schemaPending ? (
        <p className="mb-3 rounded border border-amber-400/40 bg-amber-400/10 px-3 py-2 text-xs text-amber-200" role="alert">
          Los objetivos todavía no se pueden guardar: falta aplicar la migración 0046 en la base.
        </p>
      ) : null}
      <div role="table" aria-label="Indicadores operativos" className="min-w-0 text-sm">
        <div role="row" className="hidden grid-cols-[minmax(0,2fr)_minmax(0,1fr)_minmax(0,1.2fr)_minmax(0,1.4fr)] gap-3 border-b border-[var(--os-border)] pb-1.5 text-xs font-semibold uppercase tracking-wide text-[var(--os-text-muted)] md:grid">
          <span role="columnheader">Indicador</span>
          <span role="columnheader">Resultado actual</span>
          <span role="columnheader">Objetivo</span>
          <span role="columnheader">Estado</span>
        </div>
        {rows.map((row) => (
          <div key={row.key} role="row" className="border-b border-white/[0.06] py-3" data-testid={`indicator-${row.key}`} data-light={row.light}>
            <div className="grid gap-x-3 gap-y-1.5 md:grid-cols-[minmax(0,2fr)_minmax(0,1fr)_minmax(0,1.2fr)_minmax(0,1.4fr)] md:items-center">
              <span role="cell" className="font-medium text-[var(--os-text)]">
                {row.label}
              </span>
              <span role="cell" className="tabular-nums text-[var(--os-text)]" data-testid={`indicator-${row.key}-result`}>
                <span className="mr-1 text-xs text-[var(--os-text-muted)] md:hidden">Resultado: </span>
                {row.result == null ? <span className="text-[var(--os-text-muted)]">Sin datos suficientes</span> : formatByUnit(row.result, row.unit)}
              </span>
              <span role="cell" className="flex flex-wrap items-center gap-2 text-[var(--os-text)]" data-testid={`indicator-${row.key}-target`}>
                <span className="text-xs text-[var(--os-text-muted)] md:hidden">Objetivo: </span>
                <span className={row.target ? "" : "text-[var(--os-text-muted)]"}>{targetText(row)}</span>
                {canEditTargets && !schemaPending ? (
                  <button
                    type="button"
                    onClick={() => setEditing(editing === row.key ? null : row.key)}
                    className="inline-flex size-7 items-center justify-center rounded-full text-[var(--os-text-muted)] hover:bg-white/10 hover:text-[var(--os-text)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--os-teal)]"
                    aria-label={`${row.target ? "Editar" : "Definir"} objetivo de ${row.label}`}
                    data-testid={`target-edit-${row.key}`}
                  >
                    <Pencil className="size-3.5" aria-hidden="true" />
                  </button>
                ) : null}
              </span>
              <span role="cell" className="min-w-0">
                <DashboardSemaforo light={row.light} label={row.statusLabel} />
              </span>
            </div>
            {row.note && (row.light === "sin_datos" || row.light === "no_aplica") ? (
              <p className="mt-1.5 text-xs leading-snug text-[var(--os-text-muted)]">{row.note}</p>
            ) : null}
            {editing === row.key ? (
              <TargetEditor row={row} busy={busy} onSave={save} onClear={clear} onCancel={() => setEditing(null)} />
            ) : null}
          </div>
        ))}
      </div>
    </section>
  );
}
