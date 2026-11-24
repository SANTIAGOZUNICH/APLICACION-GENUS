"use client";

/**
 * Depósito › INGRESO DE CAJAS GENUS. Planilla simple: FECHA | INSUMO | BULTOS | CANTIDAD | TOTAL. Cada fila suma TOTAL = BULTOS × CANTIDAD al stock de
 * cajas al confirmar. El total se recalcula en el servidor; el reintento / doble toque no duplica (clave por operación).
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Plus, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { TwinShell } from "@/features/os/shell/twin-shell";
import { CAJAS_CHANGED_EVENT, cajasGet, cajasPost, newKey } from "../components/cajas-genus/cajas-client";
import { ingresoTotal } from "@/lib/cajas-genus/rules";
import type { MovementView } from "@/lib/cajas-genus/service";

const nf = new Intl.NumberFormat("es-AR");
const today = () => new Date().toLocaleDateString("en-CA", { timeZone: "America/Argentina/Buenos_Aires" });
const dayFmt = (iso: string) => iso.split("-").reverse().join("/");
const fieldCls = "mt-1 block min-h-11 w-full rounded-lg border border-[var(--os-border)] bg-[var(--os-surface)] px-3 py-2 text-base";
type Row = { id: string; fecha: string; bultos: string; cantidad: string };
const newRow = (): Row => ({ id: newKey(), fecha: today(), bultos: "", cantidad: "" });
const digits = (v: string) => v.replace(/\D/g, "");

export function IngresoCajasGenusView() {
  const [rows, setRows] = useState<Row[]>([newRow()]);
  const [history, setHistory] = useState<MovementView[]>([]);
  const [canRegister, setCanRegister] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const batchKey = useRef(newKey());

  const load = useCallback(async () => {
    try {
      const r = await cajasGet<{ items: MovementView[]; canRegister: boolean }>({ view: "movements", kind: "INGRESO", voided: "1" });
      setHistory(r.items ?? []);
      setCanRegister(r.canRegister !== false);
    } catch (e) {
      setError(e instanceof Error ? e.message : "No se pudo cargar el historial.");
    }
  }, []);
  useEffect(() => {
    queueMicrotask(() => void load());
    const onChange = () => void load();
    window.addEventListener(CAJAS_CHANGED_EVENT, onChange);
    return () => window.removeEventListener(CAJAS_CHANGED_EVENT, onChange);
  }, [load]);

  const calc = useMemo(() => rows.map((r) => (r.bultos && r.cantidad ? ingresoTotal(Number(r.bultos), Number(r.cantidad)) : null)), [rows]);
  const filled = rows.filter((r) => r.bultos || r.cantidad);
  const dirty = filled.length > 0;
  const valid = filled.length > 0 && rows.every((r, i) => !(r.bultos || r.cantidad) || (calc[i]?.ok === true && /^\d{4}-\d{2}-\d{2}$/.test(r.fecha)));
  const grand = rows.reduce((a, _r, i) => a + (calc[i]?.ok ? calc[i]!.total : 0), 0);

  useEffect(() => {
    if (!dirty) return;
    const onUnload = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = "";
    };
    window.addEventListener("beforeunload", onUnload);
    return () => window.removeEventListener("beforeunload", onUnload);
  }, [dirty]);

  const upd = (id: string, patch: Partial<Row>) => setRows((rs) => rs.map((r) => (r.id === id ? { ...r, ...patch } : r)));

  async function confirm() {
    if (saving || !valid) return;
    setSaving(true);
    setError(null);
    setNotice(null);
    try {
      const payload = rows.filter((r) => r.bultos || r.cantidad).map((r) => ({ fecha: r.fecha, bultos: Number(r.bultos), cantidad: Number(r.cantidad), key: `${batchKey.current}:${r.id}` }));
      const out = await cajasPost<{ results: Array<{ total: number; replayed: boolean }> }>("register_ingresos", { rows: payload, batchKey: batchKey.current });
      const total = out.results.reduce((a, r) => a + r.total, 0);
      setNotice(`Ingreso registrado: +${nf.format(total)} cajas al stock.`);
      setRows([newRow()]); // se reinicia SOLO tras un guardado exitoso
      batchKey.current = newKey();
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "No se pudo registrar. Tus datos siguen acá: podés reintentar (no se suma dos veces).");
    } finally {
      setSaving(false);
    }
  }

  return (
    <TwinShell title="Ingreso de Cajas Genus">
      <header className="mb-3">
        <h2 className="text-2xl font-semibold tracking-tight">Ingreso de Cajas Genus</h2>
        <p className="text-sm text-[var(--os-text-muted)]">Cargá lo que llegó: BULTOS × CANTIDAD (cajas por bulto) = TOTAL. Al confirmar se suma al stock de cajas.</p>
      </header>
      {error ? <p role="alert" className="mb-3 rounded-lg border border-rose-500/40 bg-rose-500/10 p-3 text-sm" data-testid="cajas-ingreso-error">{error}</p> : null}
      {notice ? <p role="status" className="mb-3 rounded-lg border border-emerald-500/40 bg-emerald-500/10 p-3 text-sm" data-testid="cajas-ingreso-ok">{notice}</p> : null}

      {canRegister ? (
        <section className="space-y-3 rounded-xl border border-[var(--os-border)] p-3" data-testid="cajas-ingreso-planilla">
          <div className="hidden grid-cols-[9rem_1fr_7rem_7rem_7rem_3rem] gap-2 text-xs font-semibold uppercase text-[var(--os-text-muted)] md:grid"><span>Fecha</span><span>Insumo</span><span>Bultos</span><span>Cantidad</span><span>Total</span><span /></div>
          {rows.map((r, i) => (
            <div key={r.id} className="grid grid-cols-2 gap-2 rounded-lg border border-[var(--os-border)] p-2 md:grid-cols-[9rem_1fr_7rem_7rem_7rem_3rem] md:items-end md:border-0 md:p-0" data-testid="cajas-ingreso-fila">
              <label className="text-sm font-medium md:[&>span]:hidden"><span>Fecha</span><input type="date" className={fieldCls} value={r.fecha} onChange={(e) => upd(r.id, { fecha: e.target.value })} data-testid="cajas-ingreso-fecha" /></label>
              <label className="text-sm font-medium md:[&>span]:hidden"><span>Insumo</span><input readOnly className={`${fieldCls} bg-[var(--os-border)]/30 font-semibold`} value="CAJAS GENUS" aria-label="Insumo" /></label>
              <label className="text-sm font-medium md:[&>span]:hidden"><span>Bultos</span><input inputMode="numeric" className={fieldCls} value={r.bultos} onChange={(e) => upd(r.id, { bultos: digits(e.target.value) })} data-testid="cajas-ingreso-bultos" /></label>
              <label className="text-sm font-medium md:[&>span]:hidden"><span>Cantidad por bulto</span><input inputMode="numeric" className={fieldCls} value={r.cantidad} onChange={(e) => upd(r.id, { cantidad: digits(e.target.value) })} data-testid="cajas-ingreso-cantidad" /></label>
              <div className="text-sm font-medium md:[&>span]:hidden"><span>Total</span><output className={`${fieldCls} flex items-center bg-[var(--os-border)]/30 font-bold`} data-testid="cajas-ingreso-total">{calc[i]?.ok ? nf.format(calc[i]!.total) : "—"}</output></div>
              <button type="button" aria-label="Quitar fila" disabled={rows.length === 1} onClick={() => setRows((rs) => rs.filter((x) => x.id !== r.id))} className="grid size-11 place-items-center rounded-lg text-rose-600 disabled:opacity-30"><Trash2 className="size-5" /></button>
            </div>
          ))}
          <div className="flex flex-wrap items-center justify-between gap-2">
            <Button type="button" variant="secondary" className="min-h-11" onClick={() => setRows((rs) => [...rs, newRow()])} data-testid="cajas-ingreso-agregar"><Plus className="mr-1 size-4" /> Agregar fila</Button>
            <p className="text-sm">Total a ingresar: <strong data-testid="cajas-ingreso-gran-total">{nf.format(grand)}</strong> cajas</p>
          </div>
          <Button type="button" className="min-h-12 w-full text-base font-bold" disabled={!valid || saving} onClick={() => void confirm()} data-testid="cajas-ingreso-confirmar">
            {saving ? "Registrando…" : "CONFIRMAR INGRESO"}
          </Button>
        </section>
      ) : <p className="rounded-lg border border-amber-500/40 bg-amber-500/10 p-3 text-sm">Tu sector puede consultar el historial pero no registrar ingresos de Cajas Genus.</p>}

      <section className="mt-4 overflow-x-auto rounded-xl border border-[var(--os-border)] p-3" data-testid="cajas-ingreso-historial">
        <h3 className="mb-2 text-sm font-semibold">Historial de ingresos</h3>
        <table className="w-full min-w-[34rem] text-sm">
          <thead><tr className="text-left text-xs uppercase text-[var(--os-text-muted)]"><th className="py-1">Fecha</th><th>Insumo</th><th className="text-right">Bultos</th><th className="text-right">Cantidad</th><th className="text-right">Total</th><th>Registró</th><th>Estado</th></tr></thead>
          <tbody>
            {history.map((m) => (
              <tr key={m.id} className={`border-t border-[var(--os-border)] ${m.status !== "ACTIVO" ? "text-[var(--os-text-muted)] line-through" : ""}`} data-testid="cajas-ingreso-hist">
                <td className="py-1.5">{dayFmt(m.fecha)}</td><td>CAJAS GENUS</td><td className="text-right">{m.bultos ?? "—"}</td><td className="text-right">{m.cantidad ?? "—"}</td><td className="text-right font-semibold">+{nf.format(m.delta)}</td><td className="truncate text-xs">{m.createdBy}</td><td>{m.status === "ACTIVO" ? "Registrado" : "Anulado"}</td>
              </tr>
            ))}
            {!history.length ? <tr><td colSpan={7} className="py-3 text-center text-[var(--os-text-muted)]">Todavía no hay ingresos.</td></tr> : null}
          </tbody>
        </table>
      </section>
    </TwinShell>
  );
}
