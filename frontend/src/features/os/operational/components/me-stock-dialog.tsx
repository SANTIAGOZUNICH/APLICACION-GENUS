"use client";

/**
 * Stock de un material ME: libro de movimientos (con saldo) + AJUSTE de inventario.
 * El stock no se escribe a mano: se corrige el movimiento de origen (en Ingresos / Salidas, y el saldo se recalcula
 * solo) o se registra un ajuste con motivo y el stock que el usuario vio (si cambió mientras tanto → conflicto).
 * Un stock negativo se muestra tal cual: nunca se oculta ni se lleva a 0 automáticamente.
 */
import { useEffect, useState } from "react";
import { AlertTriangle } from "lucide-react";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { ME_AJUSTE_TIPOS, MIN_AJUSTE_MOTIVO } from "@/lib/inventory/me-sheet-edit";
import type { MeMovement } from "@/lib/inventory/me-stock-calc";
import { fetchMeMovimientos, postMeAjuste } from "../adapters/inventory-client";

const KIND: Record<MeMovement["tipo"], string> = { INGRESO: "Ingreso", SALIDA_OA: "Consumo OA", SALIDA_MANUAL: "Salida manual", AJUSTE: "Ajuste" };
const n = (v: number) => v.toLocaleString("es-AR");

export function MeStockDialog({ target, canAdjust, onClose, onAdjusted }: { target: { materialId: string; codigo: string; insumo: string; stock: number } | null; canAdjust: boolean; onClose: () => void; onAdjusted: () => void }) {
  const [data, setData] = useState<{ stockActual: number; movimientos: MeMovement[] } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [newStock, setNewStock] = useState("");
  const [motivo, setMotivo] = useState("");
  const [tipo, setTipo] = useState<string>("CONTEO_FISICO");
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState<string | null>(null);
  const load = async (id: string) => {
    try {
      setData(await fetchMeMovimientos(id));
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "No se pudo leer el stock.");
    }
  };
  useEffect(() => {
    if (!target) return;
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setData(null);
    setNewStock("");
    setMotivo("");
    setDone(null);
    setTipo(target.stock < 0 ? "CORRECCION_ERROR_REGISTRO" : "CONTEO_FISICO");
    void load(target.materialId);
  }, [target]);
  if (!target) return null;
  const stock = data?.stockActual ?? target.stock;
  const negative = stock < 0;
  const submit = async () => {
    setBusy(true);
    setError(null);
    try {
      const r = await postMeAjuste({ materialId: target.materialId, expectedStock: stock, newStock: Number(newStock.replace(",", ".")), motivo, tipo });
      setDone(`Ajuste guardado: ${n(r.stockAnterior)} → ${n(r.stockActual)}.`);
      setNewStock("");
      setMotivo("");
      await load(target.materialId);
      onAdjusted();
    } catch (e) {
      setError(e instanceof Error ? e.message : "No se pudo ajustar.");
      await load(target.materialId);
    } finally {
      setBusy(false);
    }
  };
  const valid = newStock.trim() !== "" && Number.isFinite(Number(newStock.replace(",", "."))) && Number(newStock.replace(",", ".")) >= 0 && motivo.trim().length >= MIN_AJUSTE_MOTIVO;
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-h-[90vh] max-w-3xl overflow-y-auto" data-testid="me-stock-dialog">
        <DialogHeader>
          <DialogTitle>Stock · {target.codigo} · {target.insumo}</DialogTitle>
          <DialogDescription>El stock se calcula: ingresos − consumos de OA − salidas manuales que descuentan + ajustes.</DialogDescription>
        </DialogHeader>
        <p className={`text-lg font-bold ${negative ? "text-red-500" : ""}`} data-testid="me-stock-actual">
          Stock actual: {n(stock)} {negative && "· NEGATIVO"}
        </p>
        {negative && (
          <div className="rounded-md border border-red-400/40 bg-red-500/10 px-3 py-2 text-sm" data-testid="me-stock-negativo">
            <p className="flex items-center gap-1 font-semibold"><AlertTriangle className="size-4" aria-hidden="true" /> Stock negativo: no se oculta ni se lleva a 0 solo.</p>
            <p className="mt-1 text-xs">
              Suele venir de un ingreso que falta o se cargó mal, o de una salida duplicada. Revisá los movimientos de abajo:
              corregí el ingreso o la salida en su planilla (el saldo se recalcula solo) o, si el conteo físico es otro,
              registrá un ajuste con motivo.
            </p>
          </div>
        )}
        <div className="max-h-64 overflow-y-auto rounded-md border border-[var(--os-border)]">
          <table className="w-full text-xs" data-testid="me-movimientos">
            <thead className="sticky top-0 bg-[var(--os-surface)] text-left text-[var(--os-text-muted)]">
              <tr><th className="px-2 py-1">Fecha</th><th className="px-2 py-1">Tipo</th><th className="px-2 py-1">Referencia</th><th className="px-2 py-1">Detalle</th><th className="px-2 py-1 text-right">Cantidad</th><th className="px-2 py-1 text-right">Saldo</th></tr>
            </thead>
            <tbody>
              {(data?.movimientos ?? []).map((m) => (
                <tr key={m.id} className={`border-t border-[var(--os-border)] ${m.anulado ? "opacity-50 line-through" : ""}`} data-testid="me-movimiento">
                  <td className="px-2 py-1">{m.fecha}</td>
                  <td className="px-2 py-1">{KIND[m.tipo]}</td>
                  <td className="px-2 py-1">{m.referencia}</td>
                  <td className="px-2 py-1">{m.detalle}</td>
                  <td className={`px-2 py-1 text-right tabular-nums ${m.cantidad < 0 ? "text-red-400" : "text-emerald-400"}`}>{m.cantidad > 0 ? "+" : ""}{n(m.cantidad)}</td>
                  <td className={`px-2 py-1 text-right font-semibold tabular-nums ${m.saldo < 0 ? "text-red-400" : ""}`}>{n(m.saldo)}</td>
                </tr>
              ))}
              {data && data.movimientos.length === 0 && <tr><td colSpan={6} className="px-2 py-2 text-center text-[var(--os-text-muted)]">Sin movimientos.</td></tr>}
            </tbody>
          </table>
        </div>
        {canAdjust ? (
          <div className="space-y-2 rounded-md border border-[var(--os-border)] p-3" data-testid="me-ajuste-form">
            <p className="text-sm font-semibold">Ajuste de inventario</p>
            <div className="grid gap-2 sm:grid-cols-3">
              <label className="flex flex-col gap-1 text-xs">Stock real (conteo)
                <input value={newStock} onChange={(e) => setNewStock(e.target.value)} inputMode="decimal" placeholder={`hoy: ${n(stock)}`} className="rounded border border-[var(--os-border)] bg-[var(--os-bg)] px-2 py-1 text-sm" data-testid="me-ajuste-nuevo" />
              </label>
              <label className="flex flex-col gap-1 text-xs">Tipo
                <select value={tipo} onChange={(e) => setTipo(e.target.value)} className="rounded border border-[var(--os-border)] bg-[var(--os-bg)] px-2 py-1 text-sm" data-testid="me-ajuste-tipo">
                  {ME_AJUSTE_TIPOS.map((t) => <option key={t.id} value={t.id}>{t.label}</option>)}
                </select>
              </label>
              <label className="flex flex-col gap-1 text-xs">Motivo (obligatorio)
                <input value={motivo} onChange={(e) => setMotivo(e.target.value)} placeholder={`mín. ${MIN_AJUSTE_MOTIVO} caracteres`} className="rounded border border-[var(--os-border)] bg-[var(--os-bg)] px-2 py-1 text-sm" data-testid="me-ajuste-motivo" />
              </label>
            </div>
            {newStock.trim() !== "" && Number.isFinite(Number(newStock.replace(",", "."))) && (
              <p className="text-xs text-[var(--os-text-muted)]">Diferencia que se registra: {n(Number((Number(newStock.replace(",", ".")) - stock).toFixed(6)))} (queda en el historial con tu usuario y motivo).</p>
            )}
            <button type="button" disabled={!valid || busy} onClick={() => void submit()} className="rounded-md bg-[var(--os-teal)] px-3 py-1.5 text-sm font-bold text-[#04201e] disabled:opacity-50" data-testid="me-ajuste-guardar">
              {busy ? "Guardando…" : "Registrar ajuste"}
            </button>
          </div>
        ) : (
          <p className="text-xs text-[var(--os-text-muted)]">Tu sector no registra ajustes de inventario.</p>
        )}
        {done && <p className="text-sm text-emerald-400" role="status" data-testid="me-ajuste-ok">{done}</p>}
        {error && <p className="text-sm text-red-400" role="alert" data-testid="me-ajuste-error">{error}</p>}
      </DialogContent>
    </Dialog>
  );
}
