"use client";

/**
 * Métricas — «Pegar desde Excel / Google Sheets».
 *
 * Flujo: pegar (Ctrl+V o menú de pegado del dispositivo) → se interpretan filas y columnas respetando el ORDEN pegado →
 * vista previa con el error de cada celda (editable) y el estado de cada fila según el servidor (nueva / ya existe /
 * existe con otras unidades / repetida) → confirmar. Nada se guarda hasta confirmar; lo que ya existe nunca se
 * sobrescribe sin que el usuario lo tilde fila por fila.
 */
import { useEffect, useMemo, useRef, useState } from "react";
import { AlertTriangle, CheckCircle2, CircleAlert } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import type { OrdersClientSession } from "@/lib/orders/orders-client";
import { commitMetricasImport, previewMetricasImport } from "@/lib/metricas/metricas-client";
import type { MetricImportCommitResult, MetricImportPreviewRow } from "@/lib/metricas/metricas-service-types";
import {
  interpretMetricsPaste,
  METRICS_FIELD_LABEL,
  validateParsedRow,
  type InterpretOptions,
  type MetricsField,
  type MetricsImportRow,
  type ParsedMetricsRow,
} from "@/lib/metricas/metricas-paste";
import type { MetricsSector } from "@/lib/metricas/types";
import { SECTOR_LABELS } from "@/types/operational/sector";
import { friendlySaveError } from "@/lib/ui/friendly-error";

export interface MetricasPasteDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  session: OrdersClientSession;
  /** Producción pega en cualquier sector; Envasado solo en el suyo. */
  isAdmin: boolean;
  /** Sector propio (Envasado). Producción lo elige en el diálogo. */
  ownSector: MetricsSector | null;
  /** Se llama tras un pegado confirmado, para recargar la tabla. */
  onDone: (result: MetricImportCommitResult) => void | Promise<void>;
}

const newBatchId = () =>
  typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID() : `batch-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;

function toImportRow(r: ParsedMetricsRow): MetricsImportRow | null {
  if (!r.valid || !r.metricDate || r.units == null || !r.responsibleDisplay || !r.sector) return null;
  return { metricDate: r.metricDate, product: r.product, units: r.units, responsibleDisplay: r.responsibleDisplay, sector: r.sector };
}

const STATUS_TEXT: Record<MetricImportPreviewRow["status"], string> = {
  new: "Nueva",
  identical: "Ya existe (igual)",
  conflict: "Existe con otras unidades",
  duplicate_in_batch: "Repetida en lo pegado",
  invalid: "Con error",
};

export function MetricasPasteDialog({ open, onOpenChange, session, isAdmin, ownSector, onDone }: MetricasPasteDialogProps) {
  const [text, setText] = useState("");
  const [defaultSector, setDefaultSector] = useState<MetricsSector | null>(isAdmin ? "ENVASADO_MASIVO" : ownSector);
  // Valores crudos editados por celda (índice de fila → campo → texto); se aplican sobre lo interpretado.
  const [edits, setEdits] = useState<Record<number, Partial<Record<MetricsField, string>>>>({});
  // La vista previa del servidor vale solo para el contenido exacto con el que se pidió (validKey): si cambia, vuelve a «Revisando…».
  const [previewState, setPreviewState] = useState<{ key: string; map: Record<number, MetricImportPreviewRow> } | null>(null);
  const [overwrite, setOverwrite] = useState<Record<number, boolean>>({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<MetricImportCommitResult | null>(null);
  const batchRef = useRef<string>(newBatchId());
  const lockRef = useRef(false);

  const opts: InterpretOptions = useMemo(() => ({ isAdmin, defaultSector }), [isAdmin, defaultSector]);
  const interpreted = useMemo(() => interpretMetricsPaste(text, opts), [text, opts]);
  const rows = useMemo(
    () => interpreted.rows.map((r, i) => (edits[i] ? validateParsedRow(r.line, { ...r.raw, ...edits[i] }, opts) : r)),
    [interpreted.rows, edits, opts]
  );
  const columns: MetricsField[] = useMemo(() => {
    const base: MetricsField[] = isAdmin ? ["metricDate", "sector", "product", "units", "responsibleDisplay"] : ["metricDate", "product", "units", "responsibleDisplay"];
    return base;
  }, [isAdmin]);

  const validRows = useMemo(() => rows.map((r) => toImportRow(r)), [rows]);
  const validKey = JSON.stringify(validRows);
  const preview = useMemo(() => (previewState?.key === validKey ? previewState.map : {}), [previewState, validKey]);

  // Estado de cada fila según el servidor (nueva / ya existe / conflicto…): se consulta al cambiar lo pegado.
  useEffect(() => {
    const payload = validRows.flatMap((r, i) => (r ? [{ i, r }] : []));
    if (payload.length === 0) return;
    let cancelled = false;
    const t = setTimeout(async () => {
      try {
        const res = await previewMetricasImport(session, payload.map((p) => p.r));
        if (cancelled) return;
        const map: Record<number, MetricImportPreviewRow> = {};
        res.forEach((row, k) => {
          map[payload[k]!.i] = row;
        });
        setPreviewState({ key: validKey, map });
        setError(null);
      } catch (e) {
        if (!cancelled) setError(friendlySaveError(e, "No se pudo revisar si los registros ya existen."));
      }
    }, 250);
    return () => {
      cancelled = true;
      clearTimeout(t);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [validKey, session]);

  function reset() {
    setText("");
    setEdits({});
    setPreviewState(null);
    setOverwrite({});
    setResult(null);
    setError(null);
    batchRef.current = newBatchId();
  }

  const statusOf = (i: number): MetricImportPreviewRow["status"] | "pending" => {
    if (!rows[i]!.valid) return "invalid";
    return preview[i]?.status ?? "pending";
  };
  const counts = { new: 0, identical: 0, conflict: 0, dup: 0, invalid: 0, pending: 0 };
  rows.forEach((_, i) => {
    const s = statusOf(i);
    if (s === "new") counts.new += 1;
    else if (s === "identical") counts.identical += 1;
    else if (s === "conflict") counts.conflict += 1;
    else if (s === "duplicate_in_batch") counts.dup += 1;
    else if (s === "invalid") counts.invalid += 1;
    else counts.pending += 1;
  });
  const overwriteCount = rows.filter((_, i) => statusOf(i) === "conflict" && overwrite[i]).length;
  const actionable = counts.new + overwriteCount;

  async function confirm() {
    if (busy || lockRef.current || actionable === 0 || counts.pending > 0) return;
    lockRef.current = true;
    setBusy(true);
    setError(null);
    try {
      const sendRows: MetricsImportRow[] = [];
      const overwriteMap: Record<string, string> = {};
      rows.forEach((r, i) => {
        const row = toImportRow(r);
        if (!row) return;
        const st = statusOf(i);
        // Solo viaja lo nuevo y lo que el usuario confirmó pisar: nada más.
        if (st === "new") {
          sendRows.push(row);
        } else if (st === "conflict" && overwrite[i]) {
          overwriteMap[String(sendRows.length)] = preview[i]!.existing!.updatedAt;
          sendRows.push(row);
        }
      });
      const res = await commitMetricasImport(session, { batchId: batchRef.current, rows: sendRows, overwrite: overwriteMap });
      setResult(res);
      await onDone(res);
    } catch (e) {
      setError(friendlySaveError(e, "No se pudo importar. No se guardó nada."));
    } finally {
      setBusy(false);
      lockRef.current = false;
    }
  }

  const CELL = "w-full min-w-[6rem] rounded border bg-[var(--os-bg)] px-2 py-1 text-xs";

  return (
    <Dialog
      open={open}
      onOpenChange={(v) => {
        if (!v && !busy) reset();
        if (!busy) onOpenChange(v);
      }}
    >
      <DialogContent className="flex h-[min(94vh,880px)] w-[min(97vw,1100px)] max-w-[97vw] flex-col gap-0 overflow-hidden p-0" data-testid="metricas-paste-dialog">
        <div className="shrink-0 space-y-2 border-b border-[var(--os-border)] px-4 py-3 sm:px-5">
          <DialogHeader className="space-y-1 pr-8">
            <DialogTitle>Pegar desde Excel / Google Sheets</DialogTitle>
            <DialogDescription>
              Copiá las celdas en la planilla y pegalas acá (Ctrl+V, o mantené presionado → Pegar en tablet/celular). Orden de columnas:{" "}
              {columns.map((c) => METRICS_FIELD_LABEL[c]).join(" · ")} — o pegá con la fila de encabezados y se respeta el orden que traigas. Fechas dd/mm/aaaa; números con coma decimal.
            </DialogDescription>
          </DialogHeader>
          {isAdmin && (
            <label className="flex flex-wrap items-center gap-2 text-xs text-[var(--os-text-muted)]">
              Sector para las filas sin columna Sector:
              <select
                value={defaultSector ?? ""}
                onChange={(e) => setDefaultSector((e.target.value || null) as MetricsSector | null)}
                className="rounded border bg-[var(--os-bg)] px-2 py-1 text-xs text-[var(--os-text)]"
                data-testid="metricas-paste-sector"
              >
                <option value="ENVASADO_MASIVO">{SECTOR_LABELS.ENVASADO_MASIVO}</option>
                <option value="ENVASADO_PREMIUM">{SECTOR_LABELS.ENVASADO_PREMIUM}</option>
              </select>
            </label>
          )}
          <textarea
            className="min-h-20 w-full rounded border border-[var(--os-border)] bg-[var(--os-bg)] p-3 font-mono text-xs"
            placeholder="Pegá acá (Ctrl+V)…"
            value={text}
            onChange={(e) => {
              setText(e.target.value);
              setEdits({});
              setOverwrite({});
              setResult(null);
              setError(null);
              batchRef.current = newBatchId();
            }}
            disabled={busy || Boolean(result)}
            autoFocus
            data-testid="metricas-paste-textarea"
          />
        </div>

        {rows.length > 0 && !result && (
          <div className="shrink-0 border-b border-[var(--os-border)] bg-[var(--os-surface)] px-4 py-2 text-xs sm:px-5" data-testid="metricas-paste-summary">
            {rows.length} fila(s) detectada(s)
            {interpreted.headerDetected ? " (con encabezado)" : ""}: <b>{counts.new}</b> nuevas · <b>{counts.identical}</b> ya existen iguales ·{" "}
            <b>{counts.conflict}</b> existen con otras unidades · <b>{counts.dup}</b> repetidas · <b className={counts.invalid ? "text-[var(--genus-error)]" : ""}>{counts.invalid}</b> con error.
            {counts.invalid > 0 && " Las filas con error no se importan: corregilas en la tabla."}
          </div>
        )}
        {error && (
          <p role="alert" className="shrink-0 px-4 py-2 text-xs text-[var(--genus-error)] sm:px-5" data-testid="metricas-paste-error">
            {error}
          </p>
        )}

        <div className="min-h-0 flex-1 overflow-auto px-2 pb-3 sm:px-4">
          {result ? (
            <div className="space-y-2 p-4 text-sm" data-testid="metricas-paste-result">
              <p className="flex items-center gap-2 font-semibold">
                <CheckCircle2 className="size-5 text-emerald-500" aria-hidden="true" />
                {result.idempotentReplay ? "Este pegado ya estaba guardado." : "Pegado guardado."}
              </p>
              <ul className="list-inside list-disc text-[var(--os-text-muted)]">
                <li>{result.created} registro(s) nuevo(s)</li>
                <li>{result.updated} actualizado(s)</li>
                <li>{result.skipped} sin cambios (ya existían, repetidos, sin confirmar o con error)</li>
              </ul>
              <Button type="button" onClick={() => { reset(); onOpenChange(false); }} data-testid="metricas-paste-close">
                Cerrar
              </Button>
            </div>
          ) : rows.length === 0 ? (
            <p className="px-2 py-8 text-center text-sm text-[var(--os-text-muted)]">Pegá datos para ver la vista previa antes de guardar.</p>
          ) : (
            <table className="w-full min-w-[44rem] border-collapse text-xs" data-testid="metricas-paste-table">
              <thead className="sticky top-0 bg-[var(--os-surface)]">
                <tr>
                  <th className="px-2 py-1 text-left">#</th>
                  {columns.map((c) => (
                    <th key={c} className="px-2 py-1 text-left">{METRICS_FIELD_LABEL[c]}</th>
                  ))}
                  <th className="px-2 py-1 text-left">Estado</th>
                  <th className="px-2 py-1 text-left">Actualizar</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r, i) => {
                  const st = statusOf(i);
                  return (
                    <tr key={i} className="border-t align-top" data-testid="metricas-paste-row" data-status={st}>
                      <td className="px-2 py-1 text-[var(--os-text-muted)]">{r.line}</td>
                      {columns.map((c) => {
                        const err = r.errors[c];
                        const value = edits[i]?.[c] ?? r.raw[c] ?? "";
                        return (
                          <td key={c} className="px-1 py-1">
                            <input
                              value={value}
                              onChange={(e) => setEdits((prev) => ({ ...prev, [i]: { ...prev[i], [c]: e.target.value } }))}
                              className={`${CELL} ${err ? "border-[var(--genus-error)] bg-[var(--genus-error-soft)]" : "border-[var(--os-border)]"}`}
                              aria-invalid={Boolean(err)}
                              aria-label={`${METRICS_FIELD_LABEL[c]} fila ${r.line}`}
                              inputMode={c === "units" ? "decimal" : undefined}
                              placeholder={c === "sector" && defaultSector ? `${SECTOR_LABELS[defaultSector]} (por defecto)` : undefined}
                              data-testid={`metricas-paste-cell-${c}`}
                              data-error={err ? "1" : undefined}
                            />
                            {err && (
                              <span className="mt-0.5 flex items-start gap-1 text-[11px] text-[var(--genus-error)]" data-testid="metricas-paste-cell-error">
                                <CircleAlert className="mt-px size-3 shrink-0" aria-hidden="true" /> {err}
                              </span>
                            )}
                          </td>
                        );
                      })}
                      <td className="px-2 py-1">
                        <span className="font-semibold">{st === "pending" ? "Revisando…" : STATUS_TEXT[st]}</span>
                        {st !== "pending" && preview[i]?.message && r.valid && (
                          <span className="mt-0.5 flex items-start gap-1 text-[11px] text-[var(--os-text-muted)]">
                            {st === "conflict" && <AlertTriangle className="mt-px size-3 shrink-0 text-amber-400" aria-hidden="true" />}
                            {preview[i]!.message}
                          </span>
                        )}
                      </td>
                      <td className="px-2 py-1">
                        {st === "conflict" ? (
                          <label className="flex items-center gap-1.5">
                            <input
                              type="checkbox"
                              checked={Boolean(overwrite[i])}
                              onChange={(e) => setOverwrite((prev) => ({ ...prev, [i]: e.target.checked }))}
                              data-testid="metricas-paste-overwrite"
                            />
                            Pisar unidades
                          </label>
                        ) : (
                          <span className="text-[var(--os-text-muted)]">—</span>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </div>

        {!result && (
          <div className="flex shrink-0 flex-wrap items-center justify-end gap-2 border-t border-[var(--os-border)] px-4 py-3 sm:px-5">
            <Button type="button" variant="secondary" disabled={busy} onClick={() => { reset(); onOpenChange(false); }}>
              Cancelar
            </Button>
            <Button type="button" disabled={busy || actionable === 0 || counts.pending > 0} onClick={() => void confirm()} data-testid="metricas-paste-confirm">
              {busy ? "Guardando…" : `Importar ${counts.new} nueva(s)${overwriteCount ? ` y actualizar ${overwriteCount}` : ""}`}
            </Button>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
