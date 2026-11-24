"use client";

/**
 * Retiro de insumos — formulario de 3 pasos pensado para celular (se completa casi sin escribir).
 *  1) INSUMOS: botones grandes −/+ por insumo (todo en 0).  2) RESPONSABLE: solo los de TU sector.  3) CONFIRMACIÓN.
 * El sector sale de la sesión (lo confirma el servidor). Al registrar: un solo guardado transaccional con clave de idempotencia
 * por intento (doble toque / reintento / falla de red no duplican). El formulario se reinicia SOLO tras un guardado exitoso.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { CheckCircle2, Loader2, Minus, Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { createRetiroApi, fetchCatalog, InsumosApiError } from "@/lib/insumos/insumos-client";
import { MAX_CANTIDAD, hasAnyQuantity, newClientRequestId } from "@/lib/insumos/insumos-rules";
import type { CatalogResponse } from "@/lib/insumos/types";
import { SECTOR_LABELS } from "@/types/operational/sector";

type Step = 1 | 2 | 3;

const stepBtn = "grid size-14 shrink-0 place-items-center rounded-xl border border-[var(--os-border)] bg-[var(--os-surface,transparent)] text-2xl font-semibold active:scale-95 disabled:opacity-40";
const bigBtn = "min-h-14 w-full rounded-xl text-base font-semibold";

export function RetiroWizard() {
  const [catalog, setCatalog] = useState<CatalogResponse | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [step, setStep] = useState<Step>(1);
  const [qty, setQty] = useState<Record<string, number>>({});
  const [responsableId, setResponsableId] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [askCancel, setAskCancel] = useState(false);
  /** Clave del intento: se genera al abrir y se renueva SOLO tras un guardado exitoso (o al descartar). */
  const requestId = useRef(newClientRequestId());
  const savingRef = useRef(false);

  const load = useCallback(async () => {
    await Promise.resolve(); // el estado se actualiza siempre de forma asíncrona (también al montar)
    setLoadError(null);
    try {
      setCatalog(await fetchCatalog());
    } catch (e) {
      setLoadError(e instanceof Error ? e.message : "No se pudo cargar el catálogo de insumos.");
    }
  }, []);
  useEffect(() => {
    const t = setTimeout(() => void load(), 0);
    return () => clearTimeout(t);
  }, [load]);

  const dirty = hasAnyQuantity(qty) && !success;
  const dirtyRef = useRef(false);
  useEffect(() => {
    dirtyRef.current = dirty;
  }, [dirty]);
  // Recargar / cerrar la pestaña con cantidades cargadas: aviso nativo del navegador.
  useEffect(() => {
    const onUnload = (e: BeforeUnloadEvent) => {
      if (!dirtyRef.current && !savingRef.current) return;
      e.preventDefault();
      e.returnValue = "";
    };
    window.addEventListener("beforeunload", onUnload);
    return () => window.removeEventListener("beforeunload", onUnload);
  }, []);

  const items = useMemo(() => catalog?.items ?? [], [catalog]);
  const responsables = useMemo(() => catalog?.responsables ?? [], [catalog]);
  const lines = useMemo(() => items.filter((i) => (qty[i.id] ?? 0) > 0).map((i) => ({ insumoId: i.id, insumoName: i.name, cantidad: qty[i.id]! })), [items, qty]);
  const responsable = responsables.find((r) => r.id === responsableId) ?? null;
  const sectorLabel = catalog?.registrationSector ? SECTOR_LABELS[catalog.registrationSector] : "";

  const change = (id: string, delta: number) => setQty((q) => ({ ...q, [id]: Math.min(MAX_CANTIDAD, Math.max(0, (q[id] ?? 0) + delta)) }));

  function resetForm() {
    setQty({});
    setResponsableId(null);
    setStep(1);
    setError(null);
    requestId.current = newClientRequestId();
  }

  async function register() {
    if (savingRef.current || !responsable || lines.length === 0) return; // doble toque: el segundo se ignora
    savingRef.current = true;
    setSaving(true);
    setError(null);
    try {
      const res = await createRetiroApi({ clientRequestId: requestId.current, responsableId: responsable.id, lines: lines.map((l) => ({ insumoId: l.insumoId, cantidad: l.cantidad })) });
      const total = res.retiro.lines.reduce((n, l) => n + l.cantidad, 0);
      setSuccess(`Retiro registrado: ${total} unidad${total === 1 ? "" : "es"} para ${res.retiro.responsableName}.`);
      resetForm(); // solo después del guardado exitoso
    } catch (e) {
      // Se conserva todo lo cargado y la MISMA clave: reintentar es seguro.
      setError(
        e instanceof InsumosApiError && e.code === "NETWORK"
          ? `${e.message} Tus datos siguen cargados: podés volver a tocar «REGISTRAR RETIRO»; no se registra dos veces.`
          : e instanceof Error
            ? e.message
            : "No se pudo registrar el retiro."
      );
    } finally {
      savingRef.current = false;
      setSaving(false);
    }
  }

  function cancel() {
    if (hasAnyQuantity(qty)) setAskCancel(true);
    else resetForm();
  }

  if (loadError) {
    return (
      <div className="space-y-3" data-testid="insumos-load-error">
        <p role="alert" className="rounded-lg bg-rose-500/10 px-3 py-2 text-sm text-rose-700 dark:text-rose-300">{loadError}</p>
        <Button type="button" className={bigBtn} onClick={() => void load()}>REINTENTAR</Button>
      </div>
    );
  }
  if (!catalog) {
    return <p className="flex items-center gap-2 text-sm text-[var(--os-text-muted)]" role="status"><Loader2 className="size-4 animate-spin" /> Cargando insumos…</p>;
  }
  if (!catalog.canRegister) {
    return (
      <p className="rounded-lg border border-[var(--os-border)] p-4 text-sm" data-testid="insumos-no-register">
        Tu sector no registra retiros de insumos. Administración y Dirección consultan los reportes en Administración › INSUMOS.
      </p>
    );
  }

  return (
    <div className="mx-auto w-full max-w-xl space-y-4 pb-28" data-testid="insumos-wizard">
      <ol className="flex gap-2 text-xs" aria-label="Pasos">
        {["1 · Insumos", "2 · Responsable", "3 · Confirmar"].map((s, i) => (
          <li key={s} className={`flex-1 rounded-full px-2 py-1 text-center ${i + 1 === step ? "bg-[var(--os-teal,#0d9488)] text-white" : "border border-[var(--os-border)] text-[var(--os-text-muted)]"}`}>{s}</li>
        ))}
      </ol>

      {success ? (
        <p role="status" className="flex items-start gap-2 rounded-lg bg-emerald-500/10 px-3 py-3 text-sm text-emerald-800 dark:text-emerald-200" data-testid="insumos-exito">
          <CheckCircle2 className="mt-0.5 size-5 shrink-0" /> {success}
        </p>
      ) : null}
      {error ? <p role="alert" className="rounded-lg bg-rose-500/10 px-3 py-2 text-sm text-rose-700 dark:text-rose-300" data-testid="insumos-error">{error}</p> : null}

      {step === 1 ? (
        <section className="space-y-3" data-testid="insumos-paso-1">
          <h3 className="text-lg font-semibold">¿Qué insumos retiraste?</h3>
          <ul className="space-y-2">
            {items.map((i) => {
              const q = qty[i.id] ?? 0;
              return (
                <li key={i.id} className="flex items-center justify-between gap-2 rounded-xl border border-[var(--os-border)] p-2" data-testid={`insumo-fila-${i.id}`}>
                  <span className="min-w-0 flex-1 break-words px-1 text-sm font-semibold">{i.name}</span>
                  <button type="button" className={stepBtn} aria-label={`Restar ${i.name}`} disabled={q <= 0} onClick={() => { setSuccess(null); change(i.id, -1); }} data-testid={`insumo-menos-${i.id}`}>
                    <Minus className="size-6" />
                  </button>
                  <output className="w-12 text-center text-2xl font-bold tabular-nums" aria-label={`Cantidad de ${i.name}`} data-testid={`insumo-cantidad-${i.id}`}>{q}</output>
                  <button type="button" className={stepBtn} aria-label={`Sumar ${i.name}`} disabled={q >= MAX_CANTIDAD} onClick={() => { setSuccess(null); change(i.id, 1); }} data-testid={`insumo-mas-${i.id}`}>
                    <Plus className="size-6" />
                  </button>
                </li>
              );
            })}
          </ul>
          {items.length === 0 ? <p className="text-sm text-[var(--os-text-muted)]">No hay insumos activos en el catálogo. Pedile a Administración que los cargue.</p> : null}
        </section>
      ) : null}

      {step === 2 ? (
        <section className="space-y-3" data-testid="insumos-paso-2">
          <h3 className="text-lg font-semibold">¿Quién retiró?</h3>
          <p className="text-sm text-[var(--os-text-muted)]">Sector: <strong>{sectorLabel}</strong></p>
          {responsables.length === 0 ? <p className="rounded-lg border border-[var(--os-border)] p-3 text-sm">Tu sector no tiene responsables activos. Pedile a Administración que los cargue.</p> : null}
          <div className="grid grid-cols-2 gap-3">
            {responsables.map((r) => (
              <button
                key={r.id}
                type="button"
                aria-pressed={responsableId === r.id}
                onClick={() => setResponsableId(r.id)}
                data-testid={`responsable-${r.id}`}
                className={`min-h-16 rounded-xl border-2 px-3 text-lg font-bold ${responsableId === r.id ? "border-[var(--os-teal,#0d9488)] bg-[var(--os-teal,#0d9488)]/15" : "border-[var(--os-border)]"}`}
              >
                {r.name}
              </button>
            ))}
          </div>
        </section>
      ) : null}

      {step === 3 && responsable ? (
        <section className="space-y-3" data-testid="insumos-paso-3">
          <h3 className="text-lg font-semibold">Confirmá el retiro</h3>
          <dl className="space-y-1 rounded-xl border border-[var(--os-border)] p-3 text-sm">
            <div className="flex justify-between gap-2"><dt className="text-[var(--os-text-muted)]">Sector</dt><dd className="font-semibold" data-testid="confirm-sector">{sectorLabel}</dd></div>
            <div className="flex justify-between gap-2"><dt className="text-[var(--os-text-muted)]">Responsable</dt><dd className="font-semibold" data-testid="confirm-responsable">{responsable.name}</dd></div>
          </dl>
          <ul className="divide-y divide-[var(--os-border)] rounded-xl border border-[var(--os-border)]" data-testid="confirm-lineas">
            {lines.map((l) => (
              <li key={l.insumoId} className="flex items-center justify-between gap-2 px-3 py-2 text-base"><span>{l.insumoName}</span><strong className="tabular-nums">{l.cantidad}</strong></li>
            ))}
          </ul>
        </section>
      ) : null}

      {/* Barra de acciones fija abajo (siempre al alcance del pulgar). */}
      <div className="fixed inset-x-0 bottom-0 z-30 border-t border-[var(--os-border)] bg-[var(--os-surface)] px-4 pb-[max(0.75rem,env(safe-area-inset-bottom))] pt-3" data-testid="insumos-acciones">
        <div className="mx-auto grid w-full max-w-xl gap-2">
          {step === 1 ? (
            <>
              <Button type="button" className={bigBtn} disabled={!hasAnyQuantity(qty)} onClick={() => { setError(null); setStep(2); }} data-testid="insumos-siguiente">SIGUIENTE</Button>
              {hasAnyQuantity(qty) ? <Button type="button" variant="secondary" className={bigBtn} onClick={cancel} data-testid="insumos-cancelar">CANCELAR</Button> : null}
            </>
          ) : null}
          {step === 2 ? (
            <>
              <Button type="button" className={bigBtn} disabled={!responsable} onClick={() => { setError(null); setStep(3); }} data-testid="insumos-siguiente">SIGUIENTE</Button>
              <div className="grid grid-cols-2 gap-2">
                <Button type="button" variant="secondary" className={bigBtn} onClick={() => setStep(1)} data-testid="insumos-volver">VOLVER</Button>
                <Button type="button" variant="secondary" className={bigBtn} onClick={cancel} data-testid="insumos-cancelar">CANCELAR</Button>
              </div>
            </>
          ) : null}
          {step === 3 ? (
            <>
              <Button type="button" className={bigBtn} disabled={saving} onClick={() => void register()} data-testid="insumos-registrar">
                {saving ? <><Loader2 className="mr-2 size-5 animate-spin" /> REGISTRANDO…</> : "REGISTRAR RETIRO"}
              </Button>
              <div className="grid grid-cols-2 gap-2">
                <Button type="button" variant="secondary" className={bigBtn} disabled={saving} onClick={() => setStep(2)} data-testid="insumos-volver">VOLVER</Button>
                <Button type="button" variant="secondary" className={bigBtn} disabled={saving} onClick={cancel} data-testid="insumos-cancelar">CANCELAR</Button>
              </div>
            </>
          ) : null}
        </div>
      </div>

      <Dialog open={askCancel} onOpenChange={setAskCancel}>
        <DialogContent hideCloseButton className="w-[min(26rem,calc(100vw-24px))]" data-testid="insumos-cancelar-confirmar">
          <DialogTitle className="text-lg">¿Descartar el retiro?</DialogTitle>
          <DialogDescription>Tenés cantidades cargadas que todavía no se registraron. Si cancelás, se pierden.</DialogDescription>
          <div className="grid gap-2">
            <Button type="button" className={bigBtn} onClick={() => setAskCancel(false)} autoFocus data-testid="insumos-seguir">SEGUIR CARGANDO</Button>
            <Button type="button" variant="secondary" className={`${bigBtn} text-rose-700 dark:text-rose-300`} onClick={() => { setAskCancel(false); setSuccess(null); resetForm(); }} data-testid="insumos-descartar">DESCARTAR</Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
