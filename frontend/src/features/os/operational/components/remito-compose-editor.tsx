"use client";

import { Button } from "@/components/ui/button";
import {
  formatCajasLines,
  producedVsBoxedWarning,
  remitoComposeSummary,
  withComposeAutoTotal,
  type RemitoComposeLine,
} from "@/lib/remitos/compose-from-quality";
import { formatLoteVtoCell } from "@/lib/remitos/line-qty";
import type { RemitoCajaCombo } from "@/lib/remitos/types";

type Props = {
  lines: RemitoComposeLine[];
  onChangeLines: (lines: RemitoComposeLine[]) => void;
  clientDisplay: string;
  onClientChange: (v: string) => void;
  deliveryDate: string;
  onDeliveryDateChange: (v: string) => void;
  displayName: string;
  onDisplayNameChange: (v: string) => void;
  busy?: boolean;
  error?: string | null;
  onCancel: () => void;
  onSaveDraft: () => void;
  onGenerateExcel: () => void;
  title?: string;
};

export function RemitoComposeEditor({
  lines,
  onChangeLines,
  clientDisplay,
  onClientChange,
  deliveryDate,
  onDeliveryDateChange,
  displayName,
  onDisplayNameChange,
  busy,
  error,
  onCancel,
  onSaveDraft,
  onGenerateExcel,
  title = "Editor de remito",
}: Props) {
  const summary = remitoComposeSummary(lines);
  const warning = producedVsBoxedWarning(lines);

  function updateLine(idx: number, patch: Partial<RemitoComposeLine>) {
    const next = [...lines];
    const cur = next[idx];
    if (!cur) return;
    next[idx] = withComposeAutoTotal({ ...cur, ...patch });
    onChangeLines(next);
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
      data-testid="remito-compose-editor"
    >
      <div className="max-h-[92vh] w-full max-w-3xl overflow-y-auto rounded border border-[var(--os-border)] bg-[var(--os-surface,#fff)] p-4 shadow-lg">
        <div className="space-y-4">
          <div>
            <h3 className="text-lg font-semibold">{title}</h3>
            <p className="text-sm text-[var(--os-text-muted)]">
              Revisá productos agrupados. Cancelar no crea borrador ni archivos.
            </p>
          </div>

          {error ? (
            <p className="rounded border border-rose-200 bg-rose-50 px-3 py-2 text-sm" role="alert">
              {error}
            </p>
          ) : null}

          <div className="grid gap-3 sm:grid-cols-3">
            <label className="block text-sm sm:col-span-1">
              Nombre visible
              <input
                className="mt-1 w-full rounded border border-[var(--os-border)] px-2 py-1.5"
                value={displayName}
                onChange={(e) => onDisplayNameChange(e.target.value)}
                data-testid="remito-compose-display-name"
              />
            </label>
            <label className="block text-sm">
              Cliente
              <input
                className="mt-1 w-full rounded border border-[var(--os-border)] px-2 py-1.5"
                value={clientDisplay}
                onChange={(e) => onClientChange(e.target.value)}
                data-testid="remito-compose-client"
              />
            </label>
            <label className="block text-sm">
              Fecha entrega
              <input
                type="date"
                className="mt-1 w-full rounded border border-[var(--os-border)] px-2 py-1.5"
                value={deliveryDate}
                onChange={(e) => onDeliveryDateChange(e.target.value)}
                data-testid="remito-compose-date"
              />
            </label>
          </div>

          <div className="space-y-3">
            {lines.map((l, idx) => {
              const cajaTxt = formatCajasLines(l);
              return (
                <div
                  key={l.id}
                  className="space-y-2 rounded border border-[var(--os-border)] p-3"
                  data-testid={`remito-compose-line-${idx}`}
                >
                  <div className="flex flex-wrap items-baseline justify-between gap-2">
                    <div>
                      <p className="text-base font-semibold uppercase tracking-wide">
                        {l.product || "Producto"}
                      </p>
                      {cajaTxt.map((t) => (
                        <p key={t} className="text-sm text-[var(--os-text-muted)]">
                          {t}
                        </p>
                      ))}
                      <p className="mt-1 text-sm font-medium" data-testid={`remito-compose-product-total-${idx}`}>
                        Total producto: {l.totalUnits} unidades
                      </p>
                    </div>
                    <p className="text-xs text-[var(--os-text-muted)]">
                      Producido: {l.producedUnits}
                    </p>
                  </div>

                  <div className="grid grid-cols-2 gap-2 text-xs">
                    <label className="block">
                      Producto
                      <input
                        className="mt-0.5 w-full rounded border border-[var(--os-border)] px-2 py-1"
                        value={l.product}
                        onChange={(e) => updateLine(idx, { product: e.target.value })}
                      />
                    </label>
                    <label className="block">
                      Lote / VTO
                      <input
                        className="mt-0.5 w-full rounded border border-[var(--os-border)] px-2 py-1"
                        value={formatLoteVtoCell(l.lote, l.vto)}
                        readOnly
                      />
                    </label>
                    <label className="block">
                      Lote
                      <input
                        className="mt-0.5 w-full rounded border border-[var(--os-border)] px-2 py-1"
                        value={l.lote}
                        onChange={(e) => updateLine(idx, { lote: e.target.value })}
                      />
                    </label>
                    <label className="block">
                      VTO
                      <input
                        className="mt-0.5 w-full rounded border border-[var(--os-border)] px-2 py-1"
                        value={l.vto}
                        onChange={(e) => updateLine(idx, { vto: e.target.value })}
                      />
                    </label>
                  </div>

                  {(
                    [
                      { label: "Cajas 1", cajasKey: "cajas1", unidadesKey: "unidades1" },
                      { label: "Cajas 2", cajasKey: "cajas2", unidadesKey: "unidades2" },
                      { label: "Cajas 3", cajasKey: "cajas3", unidadesKey: "unidades3" },
                    ] as const
                  ).map((slot) => (
                    <div key={slot.label} className="flex flex-wrap items-center gap-2 text-xs">
                      <span className="w-16 shrink-0 font-medium">{slot.label}:</span>
                      <input
                        type="number"
                        min={0}
                        className="w-20 rounded border border-[var(--os-border)] px-2 py-1"
                        value={l[slot.cajasKey] ?? 0}
                        onChange={(e) =>
                          updateLine(idx, {
                            [slot.cajasKey]: Math.max(0, Math.floor(Number(e.target.value) || 0)),
                          })
                        }
                      />
                      <span>×</span>
                      <input
                        type="number"
                        min={0}
                        className="w-20 rounded border border-[var(--os-border)] px-2 py-1"
                        value={l[slot.unidadesKey] ?? 0}
                        onChange={(e) =>
                          updateLine(idx, {
                            [slot.unidadesKey]: Math.max(
                              0,
                              Math.floor(Number(e.target.value) || 0)
                            ),
                          })
                        }
                      />
                    </div>
                  ))}

                  {(l.extraCajas ?? []).map((extra, ei) => (
                    <div
                      key={`extra-${ei}`}
                      className="flex flex-wrap items-center gap-2 rounded border border-dashed border-[var(--os-border)] px-2 py-1 text-xs"
                    >
                      <span className="w-16 shrink-0 font-medium">Extra {ei + 1}:</span>
                      <input
                        type="number"
                        min={0}
                        className="w-20 rounded border border-[var(--os-border)] px-2 py-1"
                        value={extra.cajas}
                        onChange={(e) => {
                          const extras = [...(l.extraCajas ?? [])];
                          extras[ei] = {
                            ...extra,
                            cajas: Math.max(0, Math.floor(Number(e.target.value) || 0)),
                          };
                          updateLine(idx, { extraCajas: extras });
                        }}
                      />
                      <span>×</span>
                      <input
                        type="number"
                        min={0}
                        className="w-20 rounded border border-[var(--os-border)] px-2 py-1"
                        value={extra.unidades}
                        onChange={(e) => {
                          const extras = [...(l.extraCajas ?? [])];
                          extras[ei] = {
                            ...extra,
                            unidades: Math.max(0, Math.floor(Number(e.target.value) || 0)),
                          };
                          updateLine(idx, { extraCajas: extras });
                        }}
                      />
                      <button
                        type="button"
                        className="underline"
                        onClick={() => {
                          const extras = (l.extraCajas ?? []).filter((_, i) => i !== ei);
                          updateLine(idx, { extraCajas: extras });
                        }}
                      >
                        Quitar
                      </button>
                    </div>
                  ))}

                  <button
                    type="button"
                    className="text-xs underline"
                    onClick={() => {
                      const extras: RemitoCajaCombo[] = [
                        ...(l.extraCajas ?? []),
                        { cajas: 0, unidades: 0 },
                      ];
                      updateLine(idx, { extraCajas: extras });
                    }}
                  >
                    Agregar otro tipo de caja
                  </button>
                </div>
              );
            })}
          </div>

          {warning ? (
            <p
              className="rounded border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-950"
              role="status"
              data-testid="remito-compose-mismatch-warning"
            >
              {warning}
            </p>
          ) : null}

          <div
            className="rounded border border-[var(--os-border)] bg-[var(--os-bg,#f8fafc)] p-3"
            data-testid="remito-compose-summary"
          >
            <h4 className="mb-2 font-semibold tracking-wide">RESUMEN DEL REMITO</h4>
            <ul className="space-y-1 text-sm">
              <li>Total de productos: {summary.totalProductos}</li>
              <li data-testid="remito-compose-total-bultos">
                Total de bultos: {summary.totalBultos}
              </li>
              <li className="text-base font-semibold" data-testid="remito-compose-total-unidades">
                TOTAL DE UNIDADES: {summary.totalUnidades}
              </li>
            </ul>
          </div>

          <div className="flex flex-wrap justify-end gap-2">
            <Button type="button" variant="secondary" disabled={busy} onClick={onCancel}>
              Cancelar
            </Button>
            <Button
              type="button"
              variant="secondary"
              disabled={busy || !clientDisplay.trim() || !deliveryDate.trim()}
              onClick={onSaveDraft}
              data-testid="remito-compose-save-draft"
            >
              Guardar borrador
            </Button>
            <Button
              type="button"
              disabled={busy || !displayName.trim() || !clientDisplay.trim() || !deliveryDate.trim()}
              onClick={onGenerateExcel}
              data-testid="remito-compose-generate"
            >
              Generar Excel
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}
