"use client";

/** Administración › INSUMOS › STOCK ACTUAL: stock, mínimo, unidad, ingresos, retiros y estado por insumo + stock inicial, configuración y ajuste manual. */
import { useRef, useState } from "react";
import { AlertTriangle, Minus, Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { STOCK_STATUS_LABEL, type StockStatus } from "@/lib/insumos/stock-rules";
import { newStockKey, stockPost, type StockRowView, type StockSummaryView } from "./insumos-stock-client";

export const fmtN = (n: number) => new Intl.NumberFormat("es-AR", { maximumFractionDigits: 0 }).format(n);
export const todayAr = () => new Date().toLocaleDateString("en-CA", { timeZone: "America/Argentina/Buenos_Aires" });
export const field = "min-h-11 w-full rounded-lg border border-[var(--os-border)] bg-[var(--os-surface,transparent)] px-3 text-base";

const STATUS_CLS: Record<StockStatus, string> = {
  DISPONIBLE: "bg-emerald-500/15 text-emerald-700 dark:text-emerald-300",
  STOCK_BAJO: "bg-amber-500/20 text-amber-800 dark:text-amber-300",
  SIN_STOCK: "bg-rose-600 text-white",
  SIN_CONFIGURAR: "bg-slate-500/15 text-[var(--os-text-muted)]",
};
export const StatusBadge = ({ status }: { status: StockStatus }) => (
  <span className={`inline-block rounded px-2 py-0.5 text-xs font-bold ${STATUS_CLS[status]}`} data-testid="stock-estado">{STOCK_STATUS_LABEL[status]}</span>
);

type Modal = { kind: "inicial" | "config" | "ajuste"; row: StockRowView } | null;

export function InsumosStockPanel({ summary, error, onChanged, onIngresar }: { summary: StockSummaryView | null; error: string | null; onChanged: () => void; onIngresar: (insumoId: string) => void }) {
  const [modal, setModal] = useState<Modal>(null);
  if (!summary) return <p className="text-sm text-[var(--os-text-muted)]">{error ?? "Cargando stock…"}</p>;
  const rows = summary.items.filter((r) => r.active);
  const inactive = summary.items.filter((r) => !r.active && r.configured);
  const done = () => {
    setModal(null);
    onChanged();
  };
  return (
    <div className="space-y-4" data-testid="insumos-stock">
      {error ? <p role="alert" className="rounded-lg bg-rose-500/10 px-3 py-2 text-sm text-rose-700 dark:text-rose-300">{error}</p> : null}
      {summary.alertCount > 0 ? (
        <p role="status" className="flex items-center gap-2 rounded-lg bg-rose-600 px-3 py-2 text-sm font-semibold text-white" data-testid="stock-alerta-resumen">
          <AlertTriangle className="size-4 shrink-0" aria-hidden /> {summary.alertCount} insumo{summary.alertCount === 1 ? "" : "s"} requiere{summary.alertCount === 1 ? "" : "n"} reposición.
        </p>
      ) : (
        <p className="text-sm text-[var(--os-text-muted)]">Ningún insumo requiere reposición. STOCK = stock inicial + ingresos − retiros ± ajustes (solo lo registrado desde el conteo).</p>
      )}
      <ul className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
        {rows.map((r) => (
          <li key={r.insumoId} className={`space-y-2 rounded-xl border p-3 ${r.alert ? "border-rose-500" : "border-[var(--os-border)]"}`} data-testid={`stock-${r.insumoId}`} data-status={r.status}>
            <div className="flex items-start justify-between gap-2">
              <h3 className="min-w-0 break-words font-semibold">{r.name}</h3>
              <StatusBadge status={r.status} />
            </div>
            {r.configured ? (
              <p className="text-3xl font-bold tabular-nums" data-testid="stock-actual">{fmtN(r.stock ?? 0)} <span className="text-sm font-normal text-[var(--os-text-muted)]">{r.unit}</span></p>
            ) : (
              <p className="text-sm text-[var(--os-text-muted)]" data-testid="stock-sin-inicial">Sin stock inicial: cargá el conteo físico para calcular el stock y activar las alertas.</p>
            )}
            <dl className="grid grid-cols-3 gap-2 text-xs">
              <div><dt className="text-[var(--os-text-muted)]">Mínimo</dt><dd className="font-semibold tabular-nums" data-testid="stock-minimo">{fmtN(r.minStock)}</dd></div>
              <div><dt className="text-[var(--os-text-muted)]">Ingresos</dt><dd className="font-semibold tabular-nums">{fmtN(r.ingresos)}</dd></div>
              <div><dt className="text-[var(--os-text-muted)]">Retiros</dt><dd className="font-semibold tabular-nums">{fmtN(r.retiros)}</dd></div>
            </dl>
            <div className="flex flex-wrap gap-2">
              <Button size="sm" variant="secondary" className="min-h-11" onClick={() => onIngresar(r.insumoId)} data-testid="stock-btn-ingresar">Ingresar</Button>
              <Button size="sm" variant="secondary" className="min-h-11" onClick={() => setModal({ kind: "inicial", row: r })} data-testid="stock-btn-inicial">{r.configured ? "Nuevo conteo" : "Stock inicial"}</Button>
              <Button size="sm" variant="secondary" className="min-h-11" onClick={() => setModal({ kind: "config", row: r })} data-testid="stock-btn-config">Mínimo y unidad</Button>
              {r.configured ? <Button size="sm" variant="secondary" className="min-h-11" onClick={() => setModal({ kind: "ajuste", row: r })} data-testid="stock-btn-ajuste">Ajuste</Button> : null}
            </div>
          </li>
        ))}
      </ul>
      {inactive.length ? <p className="text-xs text-[var(--os-text-muted)]">Insumos dados de baja con stock cargado (no alertan): {inactive.map((r) => `${r.name} (${r.stock ?? "—"} ${r.unit})`).join(", ")}.</p> : null}
      {modal?.kind === "inicial" ? <InicialDialog row={modal.row} onClose={() => setModal(null)} onDone={done} /> : null}
      {modal?.kind === "config" ? <ConfigDialog row={modal.row} onClose={() => setModal(null)} onDone={done} /> : null}
      {modal?.kind === "ajuste" ? <AjusteDialog row={modal.row} onClose={() => setModal(null)} onDone={done} /> : null}
    </div>
  );
}

function useSubmit(onDone: () => void) {
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const run = async (fn: () => Promise<unknown>) => {
    if (busy) return;
    setBusy(true);
    setErr(null);
    try {
      await fn();
      onDone();
    } catch (e) {
      setErr(e instanceof Error ? e.message : "No se pudo guardar.");
      setBusy(false);
    }
  };
  return { busy, err, run };
}

function Shell({ title, desc, onClose, busy, children, testId }: { title: string; desc: string; onClose: () => void; busy: boolean; children: React.ReactNode; testId: string }) {
  return (
    <Dialog open onOpenChange={(o) => !o && !busy && onClose()}>
      <DialogContent className="max-h-[92dvh] w-[min(30rem,calc(100vw-24px))] overflow-y-auto" data-testid={testId}>
        <DialogTitle>{title}</DialogTitle>
        <DialogDescription>{desc}</DialogDescription>
        {children}
      </DialogContent>
    </Dialog>
  );
}

function InicialDialog({ row, onClose, onDone }: { row: StockRowView; onClose: () => void; onDone: () => void }) {
  const key = useRef(newStockKey());
  const [qty, setQty] = useState(row.baseline != null ? String(row.baseline) : "");
  const [note, setNote] = useState("");
  const { busy, err, run } = useSubmit(onDone);
  return (
    <Shell title={`Stock inicial — ${row.name}`} desc="Cargá el conteo físico real. Desde este momento cuentan los ingresos y retiros nuevos; los retiros anteriores NO se descuentan y se conservan en el historial." onClose={onClose} busy={busy} testId="stock-dialogo-inicial">
      <label className="text-sm">Cantidad contada ({row.unit})<input type="number" inputMode="numeric" min={0} step={1} className={field} value={qty} onChange={(e) => setQty(e.target.value)} data-testid="inicial-cantidad" /></label>
      <label className="text-sm">Observaciones (opcional)<input className={field} value={note} onChange={(e) => setNote(e.target.value)} maxLength={500} /></label>
      {err ? <p role="alert" className="text-sm text-rose-700 dark:text-rose-300">{err}</p> : null}
      <div className="flex justify-end gap-2">
        <Button variant="secondary" className="min-h-11" onClick={onClose} disabled={busy}>Cancelar</Button>
        <Button className="min-h-11" disabled={busy || qty.trim() === ""} onClick={() => void run(() => stockPost("inicial", { insumoId: row.insumoId, quantity: Number(qty), note, key: key.current }))} data-testid="inicial-guardar">{busy ? "Guardando…" : "Guardar stock inicial"}</Button>
      </div>
    </Shell>
  );
}

function ConfigDialog({ row, onClose, onDone }: { row: StockRowView; onClose: () => void; onDone: () => void }) {
  const [min, setMin] = useState(String(row.minStock));
  const [unit, setUnit] = useState(row.unit);
  const { busy, err, run } = useSubmit(onDone);
  const changed = min !== String(row.minStock) || unit.trim().toLowerCase() !== row.unit;
  return (
    <Shell title={`Mínimo y unidad — ${row.name}`} desc="La unidad es la misma para ingresos y retiros. Hay alerta cuando el stock es igual o menor al mínimo (y SIN STOCK en 0 o menos)." onClose={onClose} busy={busy} testId="stock-dialogo-config">
      <label className="text-sm">Stock mínimo<input type="number" inputMode="numeric" min={0} step={1} className={field} value={min} onChange={(e) => setMin(e.target.value)} data-testid="config-minimo" /></label>
      <label className="text-sm">Unidad de medida
        <input className={field} list="insumo-unidades" value={unit} onChange={(e) => setUnit(e.target.value)} maxLength={30} data-testid="config-unidad" />
        <datalist id="insumo-unidades">{["unidades", "rollos", "cajas", "paquetes", "pares", "bobinas"].map((u) => <option key={u} value={u} />)}</datalist>
      </label>
      {err ? <p role="alert" className="text-sm text-rose-700 dark:text-rose-300">{err}</p> : null}
      <div className="flex justify-end gap-2">
        <Button variant="secondary" className="min-h-11" onClick={onClose} disabled={busy}>Cancelar</Button>
        <Button className="min-h-11" disabled={busy || !changed || min.trim() === ""} onClick={() => void run(() => stockPost("config", { insumoId: row.insumoId, minStock: Number(min), unit }))} data-testid="config-guardar">{busy ? "Guardando…" : "Guardar"}</Button>
      </div>
    </Shell>
  );
}

function AjusteDialog({ row, onClose, onDone }: { row: StockRowView; onClose: () => void; onDone: () => void }) {
  const key = useRef(newStockKey());
  const [delta, setDelta] = useState(0);
  const [reason, setReason] = useState("");
  const { busy, err, run } = useSubmit(onDone);
  const next = (row.stock ?? 0) + delta;
  return (
    <Shell title={`Ajuste manual — ${row.name}`} desc="Corrige una diferencia de inventario sin tocar el historial. El motivo es obligatorio y queda auditado." onClose={onClose} busy={busy} testId="stock-dialogo-ajuste">
      <div className="flex items-center justify-center gap-3">
        <Button variant="secondary" className="size-14" aria-label="Restar uno" onClick={() => setDelta((d) => d - 1)}><Minus className="size-6" /></Button>
        <input type="number" inputMode="numeric" step={1} className={`${field} w-28 text-center text-2xl font-bold`} value={delta} onChange={(e) => setDelta(Math.trunc(Number(e.target.value) || 0))} aria-label="Ajuste" data-testid="ajuste-delta" />
        <Button variant="secondary" className="size-14" aria-label="Sumar uno" onClick={() => setDelta((d) => d + 1)}><Plus className="size-6" /></Button>
      </div>
      <p className="text-center text-sm">Stock actual {fmtN(row.stock ?? 0)} → nuevo stock <strong data-testid="ajuste-nuevo">{fmtN(next)}</strong> {row.unit}</p>
      <label className="text-sm">Motivo (obligatorio)<textarea className={`${field} min-h-20 py-2`} value={reason} onChange={(e) => setReason(e.target.value)} data-testid="ajuste-motivo" /></label>
      {err ? <p role="alert" className="text-sm text-rose-700 dark:text-rose-300">{err}</p> : null}
      <div className="flex justify-end gap-2">
        <Button variant="secondary" className="min-h-11" onClick={onClose} disabled={busy}>Cancelar</Button>
        <Button className="min-h-11" disabled={busy || delta === 0 || reason.trim().length < 3} onClick={() => void run(() => stockPost("ajuste", { insumoId: row.insumoId, delta, reason, key: key.current }))} data-testid="ajuste-guardar">{busy ? "Guardando…" : "Guardar ajuste"}</Button>
      </div>
    </Shell>
  );
}
