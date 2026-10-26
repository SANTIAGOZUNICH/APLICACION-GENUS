"use client";

/**
 * Ingreso de Materias Primas / Materiales de envase con foto de remito.
 * Pasos: 1) foto/PDF  2) revisión editable (con la foto al lado)  3) resumen y «Confirmar ingreso de stock».
 * Nada de lo que se ve acá mueve stock hasta confirmar; la confirmación la hace el servidor por el mecanismo real de inventario.
 * La lectura automática (si está activada) solo COMPLETA el formulario como sugerencia.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AlertTriangle, Camera, CheckCircle2, FileText, ImagePlus, Loader2, ScanLine, Table2, Trash2, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { getCurrentAuthSession } from "@/features/os/auth/lib/auth-session-helpers";
import { ACTOR_EMAIL_HEADER, ACTOR_SECTOR_HEADER } from "@/lib/auth/header-names";
import { emptyLine, type CatalogItem, type DuplicateWarning, type MaterialSuggestion, type ReceiptDraftPayload, type ReceiptIssue, type ReceiptLineDraft, type ReceiptModule } from "@/lib/inventory/receipt-rules";
import type { Analysis, Receipt, ReceiptSummary } from "@/lib/inventory/receipt-service";

import { prepareReceiptImage, withRetry } from "@/lib/inventory/prepare-receipt-image";

const API = "/api/v1/inventory/receipts";
const FILE_API = "/api/v1/inventory/ingreso-adjuntos";
const MAX_BYTES = 4 * 1024 * 1024;
const prepareFile = prepareReceiptImage;

function authHeaders(): Record<string, string> {
  const s = getCurrentAuthSession();
  return { [ACTOR_EMAIL_HEADER]: s?.user.email ?? "", [ACTOR_SECTOR_HEADER]: s?.sector.id ?? "" };
}

class ApiError extends Error {
  constructor(message: string, readonly status: number, readonly code: string, readonly body: Record<string, unknown>) {
    super(message);
  }
}
async function call<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(path, { ...init, headers: { ...authHeaders(), ...(init?.headers ?? {}) }, cache: "no-store" });
  const body = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  if (!res.ok) throw new ApiError(String(body.error ?? "No se pudo completar la operación."), res.status, String(body.code ?? "ERROR"), body);
  return body as T;
}
const post = <T,>(body: Record<string, unknown>) => call<T>(API, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });

const MODULE_TEXT: Record<ReceiptModule, { sector: string; material: string; stockWord: string }> = {
  MP: { sector: "Materia Prima", material: "materia prima", stockWord: "Stock MP" },
  ME: { sector: "Depósito", material: "material de envase", stockWord: "Stock de Depósito" },
};

const uid = () => (typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(16).slice(2)}`);
const field = "w-full rounded-lg border border-[var(--os-border)] bg-[var(--os-surface,transparent)] px-2.5 py-2 text-sm";
const reviewRing = "border-amber-500 bg-amber-500/10";
const fmtQty = (n: number, unit: string) => `${n.toLocaleString("es-AR", { maximumFractionDigits: 3 })} ${unit}`;

// ───────────────────────── Botones que se insertan en cada sector ─────────────────────────

export function IngresoConRemitoButtons({ module, canWrite, onChanged }: { module: ReceiptModule; canWrite: boolean; onChanged?: () => void }) {
  const [wizard, setWizard] = useState(false);
  const [history, setHistory] = useState<{ open: boolean; resumeId?: string | null }>({ open: false });
  return (
    <>
      {canWrite ? (
        <Button type="button" onClick={() => setWizard(true)} data-testid="nuevo-ingreso-remito">
          <ScanLine className="mr-1 size-4" /> Nuevo ingreso con remito
        </Button>
      ) : null}
      <Button type="button" variant="secondary" onClick={() => setHistory({ open: true })} data-testid="remitos-recibidos">
        <FileText className="mr-1 size-4" /> Remitos recibidos
      </Button>
      {wizard ? <RemitoWizard module={module} onClose={() => setWizard(false)} onConfirmed={() => onChanged?.()} /> : null}
      {history.open ? (
        <RemitosHistorial
          module={module}
          canWrite={canWrite}
          onClose={() => setHistory({ open: false })}
          onResume={(id) => {
            setHistory({ open: false });
            setWizard(true);
            resumeRef.id = id;
          }}
        />
      ) : null}
    </>
  );
}
/** Id del borrador a retomar (lo lee el asistente al abrirse). */
const resumeRef: { id: string | null } = { id: null };

// ───────────────────────── Asistente ─────────────────────────

type Step = "foto" | "revision" | "resumen" | "listo" | "planilla";
type Thumb = { id: string; name: string; type: string; url: string | null };

function RemitoWizard({ module, onClose, onConfirmed }: { module: ReceiptModule; onClose: () => void; onConfirmed: () => void }) {
  const t = MODULE_TEXT[module];
  const [step, setStep] = useState<Step>("foto");
  const [receipt, setReceipt] = useState<Receipt | null>(null);
  const [draft, setDraft] = useState<ReceiptDraftPayload>({ header: { supplier: "", remitoNumber: "", remitoDate: "", receivedDate: "", notes: "" }, lines: [] });
  const [thumbs, setThumbs] = useState<Thumb[]>([]);
  const [viewIdx, setViewIdx] = useState(0);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [analysis, setAnalysis] = useState<Analysis | null>(null);
  const [ack, setAck] = useState(false);
  const [parentId, setParentId] = useState<string>("");
  const [extraction, setExtraction] = useState<{ available: boolean; reason: string; code?: string } | null>(null);
  const [storageIssue, setStorageIssue] = useState<string | null>(null);
  /** La última lectura automática falló: se muestra el motivo con «Reintentar lectura». */
  const [readFailed, setReadFailed] = useState<string | null>(null);
  const [showPhoto, setShowPhoto] = useState(false);
  const [sheetResult, setSheetResult] = useState<{ count: number } | null>(null);
  /** Alto visible real (con el teclado abierto en Android el área útil se achica): el diálogo nunca la supera, así el botón principal no queda tapado. */
  const [vvh, setVvh] = useState<number | null>(null);
  useEffect(() => {
    const vv = typeof window !== "undefined" ? window.visualViewport : null;
    if (!vv) return;
    const read = () => setVvh(Math.round(vv.height));
    read();
    vv.addEventListener("resize", read);
    return () => vv.removeEventListener("resize", read);
  }, []);
  const confirmKey = useRef(uid());
  const cameraRef = useRef<HTMLInputElement>(null);
  const filesRef = useRef<HTMLInputElement>(null);
  const urlsRef = useRef<string[]>([]);
  const receiptRef = useRef<Receipt | null>(null);
  const draftRef = useRef<ReceiptDraftPayload>(draft);
  /** Configuración de lectura automática: se guarda en ref para que una subida iniciada antes de que cargue igual pueda arrancar la lectura. */
  const extractionRef = useRef<{ available: boolean; reason: string; code?: string } | null>(null);
  const configLoad = useRef<Promise<void> | null>(null);
  useEffect(() => {
    draftRef.current = draft;
  }, [draft]);

  const trackUrl = (u: string) => {
    urlsRef.current.push(u);
    return u;
  };
  useEffect(
    () => () => {
      for (const u of urlsRef.current) URL.revokeObjectURL(u);
    },
    []
  );

  const applyReceipt = useCallback((r: Receipt) => {
    receiptRef.current = r;
    setReceipt(r);
    setDraft(r.draft);
  }, []);

  // Configuración de lectura automática + retomar un borrador (si se vino desde «Remitos recibidos»).
  useEffect(() => {
    let alive = true;
    const setCfg = (c: { available: boolean; reason: string; code?: string }) => {
      extractionRef.current = c;
      if (alive) setExtraction(c);
    };
    configLoad.current = call<{ extraction: { available: boolean; reason: string; code?: string }; storage?: { configured: boolean; reason: string } }>(`${API}?module=${module}&view=config`)
      .then((c) => {
        setCfg(c.extraction);
        if (alive && c.storage && !c.storage.configured) setStorageIssue(c.storage.reason);
      })
      .catch(() => setCfg({ available: false, reason: "No se pudo comprobar si la lectura automática está disponible. Cargá los datos a mano." }));
    const resume = resumeRef.id;
    resumeRef.id = null;
    if (resume) {
      void call<{ receipt: Receipt }>(`${API}?module=${module}&view=get&id=${resume}`)
        .then(async (r) => {
          if (!alive) return;
          applyReceipt(r.receipt);
          const loaded: Thumb[] = [];
          for (const f of r.receipt.files) {
            const blob = await fetch(`${FILE_API}/${f.id}`, { headers: authHeaders() }).then((x) => (x.ok ? x.blob() : null)).catch(() => null);
            loaded.push({ id: f.id, name: f.fileName, type: f.contentType, url: blob ? trackUrl(URL.createObjectURL(blob)) : null });
          }
          if (alive) {
            setThumbs(loaded);
            setStep(r.receipt.draft.lines.length || r.receipt.draft.header.supplier ? "revision" : "foto");
          }
        })
        .catch((e) => alive && setError(e instanceof Error ? e.message : "No se pudo abrir el borrador."));
    }
    return () => {
      alive = false;
    };
  }, [module, applyReceipt]);

  async function ensureDraft(): Promise<Receipt> {
    if (receiptRef.current) return receiptRef.current;
    const r = (await post<{ receipt: Receipt }>({ action: "create", module })).receipt;
    applyReceipt(r);
    return r;
  }

  async function addFiles(list: FileList | null) {
    const files = Array.from(list ?? []);
    if (!files.length) return;
    setError(null);
    setReadFailed(null);
    setBusy("Subiendo…");
    let uploaded = false;
    try {
      const r = await ensureDraft();
      for (const raw of files) {
        const file = await prepareFile(raw);
        if (file.size > MAX_BYTES) {
          setError(`«${raw.name}» pesa demasiado (máx. 4 MB). Probá sacar la foto de nuevo o subir un PDF más liviano.`);
          continue;
        }
        const fd = new FormData();
        fd.append("module", module);
        fd.append("receiptId", r.id);
        fd.append("file", file, file.name);
        try {
          const res = await withRetry(() => call<{ item: { id: string; fileName: string; contentType: string } }>(`${API}/files`, { method: "POST", body: fd }), { retryable: (e) => !(e instanceof ApiError) || e.status >= 500 });
          setThumbs((prev) => (prev.some((x) => x.id === res.item.id) ? prev : [...prev, { id: res.item.id, name: res.item.fileName, type: res.item.contentType, url: trackUrl(URL.createObjectURL(file)) }]));
        } catch (e) {
          setError(e instanceof Error ? e.message : `No se pudo subir «${raw.name}».`);
        }
      }
      uploaded = true;
    } catch (e) {
      setError(e instanceof Error ? e.message : "No se pudo iniciar el ingreso.");
    } finally {
      setBusy(null);
    }
    // Lectura automática: arranca sola al terminar de subir (sin segundo botón), salvo que ya haya datos cargados a mano.
    if (uploaded && !extractionRef.current) await configLoad.current;
    if (uploaded && extractionRef.current?.available) {
      const hasManual = draftRef.current.lines.some((l) => l.description || l.quantity || l.materialCode);
      if (!hasManual) await runExtract(false);
      else setNotice("Subido. Como ya cargaste datos, la lectura no se hizo sola: usá «Leer la foto automáticamente» si querés completar lo que falta.");
    }
  }

  async function removeThumb(th: Thumb) {
    if (!receipt) return;
    try {
      await post({ action: "remove_file", module, id: receipt.id, fileId: th.id });
      setThumbs((prev) => prev.filter((x) => x.id !== th.id));
      setViewIdx(0);
    } catch (e) {
      setError(e instanceof Error ? e.message : "No se pudo quitar el archivo.");
    }
  }

  async function saveDraft(next: ReceiptDraftPayload = draft): Promise<Receipt | null> {
    const r = receiptRef.current ?? (await ensureDraft());
    try {
      const res = await post<{ receipt: Receipt }>({ action: "save", module, id: r.id, expectedVersion: r.version, header: next.header, lines: next.lines });
      receiptRef.current = res.receipt;
      setReceipt(res.receipt);
      return res.receipt;
    } catch (e) {
      setError(e instanceof Error ? e.message : "No se pudo guardar el borrador.");
      return null;
    }
  }

  async function runExtract(replace: boolean) {
    setError(null);
    setNotice(null);
    setReadFailed(null);
    setBusy("Analizando remito…");
    try {
      const r = await ensureDraft();
      // Guarda lo escrito antes: la lectura no pisa lo que ya cargó la persona.
      const cur = draftRef.current;
      if (receiptRef.current && (cur.header.supplier || cur.lines.length)) await saveDraft(cur);
      const res = await post<{ receipt: Receipt; applied: boolean; message: string; kind: string; analysis: Analysis | null }>({ action: "extract", module, id: (receiptRef.current ?? r).id, replace });
      applyReceipt(res.receipt);
      if (res.analysis) setAnalysis(res.analysis);
      if (res.applied) {
        setNotice(res.message);
        setStep("revision");
      } else {
        setReadFailed(res.message);
      }
    } catch (e) {
      // Sin respuesta del servidor (corte de conexión) ≠ el servicio de lectura falló: la foto y lo cargado siguen guardados.
      setReadFailed(
        e instanceof ApiError
          ? e.message
          : "Error de conexión: no pudimos comunicarnos con GENUS OS. La foto y lo que cargaste siguen guardados; reintentá cuando vuelva la conexión o completá los datos a mano."
      );
    } finally {
      setBusy(null);
    }
  }

  function retryRead() {
    const cur = draftRef.current;
    const hasContent = cur.lines.some((l) => l.description || l.quantity || l.materialCode);
    if (hasContent && !window.confirm("Volver a leer reemplaza los datos cargados por los del remito. ¿Continuar?")) return;
    void runExtract(hasContent);
  }

  async function goReview() {
    setError(null);
    setBusy("Guardando…");
    try {
      if (draft.lines.length === 0) {
        const next = { ...draft, lines: [emptyLine(uid().slice(0, 8))], header: { ...draft.header, receivedDate: draft.header.receivedDate || new Date().toISOString().slice(0, 10) } };
        setDraft(next);
        await saveDraft(next);
      } else await saveDraft();
      const rc = receiptRef.current;
      if (rc) await call<{ analysis: Analysis }>(`${API}?module=${module}&view=analyze&id=${rc.id}`).then((a) => setAnalysis(a.analysis)).catch(() => undefined);
      setStep("revision");
    } finally {
      setBusy(null);
    }
  }

  async function goSummary() {
    setError(null);
    setBusy("Revisando…");
    try {
      const saved = await saveDraft();
      if (!saved) return;
      const a = await call<{ analysis: Analysis }>(`${API}?module=${module}&view=analyze&id=${saved.id}`);
      setAnalysis(a.analysis);
      setAck(false);
      setStep("resumen");
    } catch (e) {
      setError(e instanceof Error ? e.message : "No se pudo revisar el remito.");
    } finally {
      setBusy(null);
    }
  }

  /** «Pasar al Excel»: sube lo leído tal cual (aunque falte casi todo o esté mal leído) a la tabla; se edita ahí. No mueve stock. */
  async function toSheet() {
    setBusy("Pasando al Excel…");
    setError(null);
    try {
      const r = receiptRef.current ?? (await ensureDraft());
      const cur = draftRef.current;
      const res = await post<{ receipt: Receipt; sheet: { count: number } }>({ action: "to_sheet", module, id: r.id, confirmKey: confirmKey.current, header: cur.header, lines: cur.lines });
      applyReceipt(res.receipt);
      setSheetResult({ count: res.sheet.count });
      setStep("planilla");
      onConfirmed();
    } catch (e) {
      setError(e instanceof Error ? e.message : "No se pudo pasar al Excel. Tu conexión pudo fallar: volvé a tocar «Pasar al Excel»; no se carga dos veces.");
    } finally {
      setBusy(null);
    }
  }

  async function confirm() {
    if (!receipt) return;
    setBusy("Confirmando ingreso…");
    setError(null);
    try {
      const res = await post<{ receipt: Receipt }>({ action: "confirm", module, id: receipt.id, expectedVersion: receipt.version, confirmKey: confirmKey.current, acknowledgeDuplicates: ack, parentReceiptId: parentId || null });
      applyReceipt(res.receipt);
      setStep("listo");
      onConfirmed();
    } catch (e) {
      if (e instanceof ApiError && (e.body.issues || e.body.warnings)) {
        setAnalysis((prev) => ({ ...(prev ?? emptyAnalysis()), validation: { ok: false, issues: (e.body.issues as ReceiptIssue[]) ?? prev?.validation.issues ?? [] }, warnings: (e.body.warnings as DuplicateWarning[]) ?? prev?.warnings ?? [] }));
      }
      setError(e instanceof Error ? e.message : "No se pudo confirmar. Tu conexión pudo fallar: podés volver a tocar «Confirmar»; no se suma dos veces.");
    } finally {
      setBusy(null);
    }
  }

  async function discardAndClose() {
    if (receipt && receipt.status === "BORRADOR" && (thumbs.length || draft.lines.length)) {
      // Se conserva como borrador (queda en «Remitos recibidos» para retomar); no se pierde la foto.
      await saveDraft().catch(() => undefined);
    }
    onClose();
  }

  const issueMap = useMemo(() => {
    const m = new Map<string, ReceiptIssue>();
    for (const i of analysis?.validation.issues ?? []) m.set(`${i.line ?? "h"}:${i.field}`, i);
    return m;
  }, [analysis]);

  const stepIdx = { foto: 0, revision: 1, resumen: 2, listo: 3, planilla: 3 }[step];
  const current = thumbs[viewIdx] ?? null;

  return (
    <Dialog open onOpenChange={(o) => !o && void discardAndClose()}>
      <DialogContent
        className="max-h-[100dvh] w-[min(72rem,100vw)] max-w-none overflow-y-auto p-3 pb-0 sm:max-h-[94dvh] sm:w-[min(72rem,calc(100vw-16px))] sm:p-6 sm:pb-0"
        style={{ maxHeight: vvh ? `${vvh}px` : undefined }}
        data-testid="ingreso-remito-dialog"
      >
        <DialogTitle className="text-base sm:text-lg">Nuevo ingreso con remito — {t.sector}</DialogTitle>
        <DialogDescription className="hidden sm:block">
          {step === "listo" ? "Ingreso registrado." : step === "planilla" ? "Pasado al Excel." : `Registrá ${module === "MP" ? "materias primas" : "materiales de envase"} a partir de la foto del remito. No se suma stock hasta que confirmes.`}
        </DialogDescription>
        <ol className="hidden gap-2 text-xs sm:flex" aria-label="Pasos">
          {["1 · Foto", "2 · Revisión", "3 · Confirmar"].map((s, i) => (
            <li key={s} className={`rounded-full px-3 py-1 ${i === Math.min(stepIdx, 2) ? "bg-[var(--os-teal,#0d9488)] text-white" : "border border-[var(--os-border)] text-[var(--os-text-muted)]"}`}>
              {s}
            </li>
          ))}
        </ol>

        {error ? (
          <p className="rounded-lg bg-rose-500/10 px-3 py-2 text-sm text-rose-700 dark:text-rose-300" role="alert" data-testid="ingreso-remito-error">
            {error}
          </p>
        ) : null}
        {notice ? <p className="rounded-lg bg-sky-500/10 px-3 py-2 text-sm" role="status">{notice}</p> : null}
        {busy ? (
          <p className="flex items-center gap-2 text-sm text-[var(--os-text-muted)]" role="status">
            <Loader2 className="size-4 animate-spin" /> {busy}
          </p>
        ) : null}

        {step === "foto" ? (
          <section className="space-y-4" data-testid="paso-foto">
            <div className="flex flex-wrap gap-2">
              <Button type="button" className="min-h-12 flex-1" onClick={() => cameraRef.current?.click()} disabled={Boolean(busy)} data-testid="remito-camara">
                <Camera className="size-5" /> Sacar foto
              </Button>
              <Button type="button" variant="secondary" className="min-h-12 flex-1" onClick={() => filesRef.current?.click()} disabled={Boolean(busy)} data-testid="remito-subir">
                <ImagePlus className="size-5" /> Subir imagen o PDF
              </Button>
              <input ref={cameraRef} type="file" accept="image/*" capture="environment" className="hidden" onChange={(e) => { void addFiles(e.target.files); e.target.value = ""; }} data-testid="remito-input-camara" />
              <input ref={filesRef} type="file" multiple accept="image/jpeg,image/png,image/heic,image/heif,application/pdf,.jpg,.jpeg,.png,.heic,.heif,.pdf" className="hidden" onChange={(e) => { void addFiles(e.target.files); e.target.value = ""; }} data-testid="remito-input-archivos" />
            </div>
            <p className="text-xs text-[var(--os-text-muted)]">Si el remito tiene varias hojas, agregá una foto por hoja (o un PDF). JPG, PNG, HEIC o PDF, hasta 4 MB cada uno.</p>
            <ThumbGrid thumbs={thumbs} onRemove={(th) => void removeThumb(th)} />
            {readFailed ? (
              <div className="space-y-2 rounded-lg border border-rose-500/40 bg-rose-500/10 p-3 text-sm" role="alert" data-testid="remito-lectura-fallo">
                <p>{readFailed}</p>
                <div className="flex flex-wrap gap-2">
                  <Button type="button" variant="secondary" onClick={retryRead} disabled={Boolean(busy)} data-testid="remito-reintentar">Reintentar lectura</Button>
                </div>
              </div>
            ) : null}
            <div className="flex flex-wrap items-center gap-2 border-t border-[var(--os-border)] pt-3">
              {extraction?.available ? (
                <Button type="button" variant="secondary" disabled={!thumbs.length || Boolean(busy)} onClick={() => void runExtract(false)} data-testid="remito-leer">
                  <ScanLine className="mr-1 size-4" /> {readFailed ? "Reintentar lectura" : "Leer la foto automáticamente"}
                </Button>
              ) : null}
              {thumbs.length ? (
                <Button type="button" disabled={Boolean(busy)} onClick={() => void toSheet()} data-testid="remito-pasar-excel-foto">
                  <Table2 className="mr-1 size-4" /> PASAR A EXCEL
                </Button>
              ) : null}
              <Button type="button" variant="secondary" disabled={Boolean(busy)} onClick={() => void goReview()} data-testid="remito-cargar-manual">
                {thumbs.length ? "Cargar los datos a mano" : "Cargar manualmente (sin foto por ahora)"}
              </Button>
              {storageIssue ? <p className="w-full rounded-lg bg-amber-500/10 px-3 py-2 text-xs" role="alert" data-testid="remito-storage-issue">{storageIssue}</p> : null}
              {extraction?.available ? (
                <p className="w-full text-xs text-[var(--os-text-muted)]">Al subir la foto, GENUS OS analiza el remito solo y completa el formulario. La imagen se envía al servicio de lectura configurado por Sistemas. Es una sugerencia: siempre la revisás vos antes de confirmar.</p>
              ) : extraction && extraction.reason ? (
                <p className="w-full rounded-lg bg-amber-500/10 px-3 py-2 text-xs" data-testid="remito-lectura-apagada">{extraction.reason}</p>
              ) : null}
            </div>
          </section>
        ) : null}

        {step === "revision" ? (
          <section className="grid gap-4 lg:grid-cols-[minmax(0,5fr)_minmax(0,7fr)]" data-testid="paso-revision">
            <div className={`${showPhoto ? "" : "hidden"} space-y-2 lg:block`}>
              <PhotoViewer thumbs={thumbs} idx={viewIdx} onIdx={setViewIdx} current={current} />
            </div>
            <div className="space-y-4">
              {draft.extraction?.ok ? (
                <p className="rounded-lg bg-emerald-500/10 px-3 py-2 text-sm" data-testid="remito-lectura-ok">
                  Datos leídos automáticamente del remito. Lo que no se pudo leer queda vacío. No hace falta corregir nada ahora: podés pasarlo al Excel y editarlo ahí.
                </p>
              ) : null}
              {(readFailed || (draft.extraction && !draft.extraction.ok)) && thumbs.length ? (
                <div className="flex flex-wrap items-center gap-2 rounded-lg border border-rose-500/40 bg-rose-500/10 px-3 py-2 text-sm" role="alert" data-testid="remito-lectura-fallo">
                  <span className="flex-1">{readFailed ?? draft.extraction?.note}</span>
                  {extraction?.available ? <Button type="button" variant="secondary" onClick={retryRead} disabled={Boolean(busy)} data-testid="remito-reintentar">Reintentar lectura</Button> : null}
                </div>
              ) : null}
              <button type="button" className="text-sm underline lg:hidden" onClick={() => setShowPhoto((v) => !v)}>
                {showPhoto ? "Ocultar foto" : "Ver foto del remito"}
              </button>
              <HeaderForm draft={draft} onChange={setDraft} issueMap={issueMap} extractionNote={draft.extraction && !draft.extraction.ok ? draft.extraction.note : undefined} />
              <div className="space-y-3">
                {draft.lines.map((l, i) => (
                  <LineCard
                    key={l.id}
                    module={module}
                    index={i}
                    line={l}
                    supplier={draft.header.supplier}
                    suggestions={analysis?.suggestions[l.id] ?? []}
                    issueMap={issueMap}
                    onChange={(nl) => setDraft((d) => ({ ...d, lines: d.lines.map((x) => (x.id === l.id ? nl : x)) }))}
                    onRemove={() => setDraft((d) => ({ ...d, lines: d.lines.filter((x) => x.id !== l.id) }))}
                  />
                ))}
                <Button type="button" variant="secondary" onClick={() => setDraft((d) => ({ ...d, lines: [...d.lines, emptyLine(uid().slice(0, 8))] }))} data-testid="remito-agregar-linea">
                  + Agregar material
                </Button>
              </div>
            </div>
          </section>
        ) : null}

        {/* Barra fija abajo (hija directa del diálogo que scrollea): PASAR A EXCEL siempre visible; respeta el área segura de Android. */}
        {step === "revision" ? (
          <div className="sticky bottom-0 z-10 -mx-3 flex flex-wrap items-center justify-between gap-2 border-t border-[var(--os-border)] bg-[var(--os-surface)] px-3 pt-2 pb-[max(0.5rem,env(safe-area-inset-bottom))] sm:-mx-6 sm:px-6" data-testid="remito-barra-accion">
            <div className="flex items-center gap-2">
              <Button type="button" variant="secondary" size="sm" onClick={() => setStep("foto")}>Volver</Button>
              {extraction?.available && thumbs.length ? <Button type="button" variant="secondary" size="sm" onClick={retryRead} disabled={Boolean(busy)} data-testid="remito-releer">Releer</Button> : null}
              <button type="button" className="text-xs underline disabled:opacity-50" onClick={() => void goSummary()} disabled={Boolean(busy)} data-testid="remito-revisar">Confirmar ingreso de stock (opcional)</button>
            </div>
            <Button type="button" className="min-h-12 min-w-44 flex-1 font-bold uppercase tracking-wide sm:flex-none" onClick={() => void toSheet()} disabled={Boolean(busy)} data-testid="remito-pasar-excel"><Table2 className="mr-1 size-4" /> PASAR A EXCEL</Button>
          </div>
        ) : null}

        {step === "resumen" && analysis && receipt ? (
          <Summary
            module={module}
            draft={draft}
            thumbs={thumbs}
            analysis={analysis}
            ack={ack}
            onAck={setAck}
            parentId={parentId}
            onParent={setParentId}
            busy={Boolean(busy)}
            onBack={() => setStep("revision")}
            onConfirm={() => void confirm()}
          />
        ) : null}

        {step === "planilla" && receipt ? (
          <section className="space-y-3" data-testid="paso-planilla">
            <p className="flex items-center gap-2 text-base font-medium text-emerald-700 dark:text-emerald-300">
              <CheckCircle2 className="size-5" /> Pasado al Excel: {sheetResult?.count ?? 1} fila{(sheetResult?.count ?? 1) === 1 ? "" : "s"} en {module === "MP" ? "Ingresos MP" : "Ingresos de Depósito"}.
            </p>
            <p className="text-sm">Lo que no se pudo leer quedó vacío. Editá, corregí y completá lo que necesites directamente en la tabla; se guarda solo.</p>
            <p className="text-xs text-[var(--os-text-muted)]">
              {module === "MP"
                ? "Las filas entran como borrador: todavía no mueven stock ni el libro mayor. Cuando estén completas las confirmás en la tabla («Confirmar borradores»)."
                : "El stock se calcula por código y cantidad: una fila sin código o sin cantidad no suma nada hasta que la completes."}
            </p>
            <div className="flex gap-2">
              <Button type="button" onClick={onClose} data-testid="remito-ir-tabla">Ir a la tabla</Button>
            </div>
          </section>
        ) : null}

        {step === "listo" && receipt ? (
          <section className="space-y-3" data-testid="paso-listo">
            <p className="flex items-center gap-2 text-base font-medium text-emerald-700 dark:text-emerald-300">
              <CheckCircle2 className="size-5" /> Ingreso confirmado: el stock se actualizó.
            </p>
            <ul className="space-y-1 text-sm">
              {receipt.confirmedLines.map((l) => (
                <li key={l.ingresoId}>
                  <strong>{l.ingresoNro ?? "—"}</strong> · {l.materialCode} — {l.materialLabel}: {fmtQty(l.quantity, l.unit)}
                  {l.lote ? ` · lote ${l.lote}` : ""}
                </li>
              ))}
            </ul>
            <p className="text-xs text-[var(--os-text-muted)]">El remito quedó guardado y vinculado a cada ingreso. Lo encontrás en «Remitos recibidos» y en la columna de fotos del ingreso.</p>
            <div className="flex gap-2">
              <Button type="button" onClick={onClose} data-testid="remito-cerrar">Cerrar</Button>
            </div>
          </section>
        ) : null}
      </DialogContent>
    </Dialog>
  );
}

const emptyAnalysis = (): Analysis => ({ validation: { ok: false, issues: [] }, suggestions: {}, preselected: {}, warnings: [], fileCount: 0, ready: false });

function ThumbGrid({ thumbs, onRemove }: { thumbs: Thumb[]; onRemove?: (t: Thumb) => void }) {
  if (!thumbs.length) return <p className="text-sm text-[var(--os-text-muted)]">Todavía no hay hojas del remito.</p>;
  return (
    <ul className="grid grid-cols-2 gap-2 sm:grid-cols-4" data-testid="remito-miniaturas">
      {thumbs.map((th, i) => (
        <li key={th.id} className="overflow-hidden rounded border border-[var(--os-border)]">
          <div className="flex aspect-[4/3] items-center justify-center bg-[var(--os-bg)]">
            {th.type === "application/pdf" ? (
              <span className="flex flex-col items-center gap-1 text-xs"><FileText className="size-8" /> PDF</span>
            ) : th.url && th.type !== "image/heic" ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={th.url} alt={th.name} className="h-full w-full object-cover" />
            ) : (
              <span className="text-xs text-[var(--os-text-muted)]">{th.type === "image/heic" ? "HEIC" : "…"}</span>
            )}
          </div>
          <div className="flex items-center justify-between gap-1 px-1.5 py-1 text-[11px] text-[var(--os-text-muted)]">
            <span className="truncate">Hoja {i + 1} · {th.name}</span>
            {onRemove ? (
              <button type="button" aria-label="Quitar archivo" onClick={() => onRemove(th)}>
                <Trash2 className="size-3.5 text-rose-600" />
              </button>
            ) : null}
          </div>
        </li>
      ))}
    </ul>
  );
}

function PhotoViewer({ thumbs, idx, onIdx, current }: { thumbs: Thumb[]; idx: number; onIdx: (n: number) => void; current: Thumb | null }) {
  if (!current) return <p className="text-sm text-[var(--os-text-muted)]">Sin foto: cargá los datos a mano. Para confirmar necesitás adjuntar la foto o el PDF.</p>;
  return (
    <div className="space-y-2" data-testid="remito-visor">
      {thumbs.length > 1 ? (
        <div className="flex flex-wrap gap-1">
          {thumbs.map((th, i) => (
            <button key={th.id} type="button" className={`rounded border px-2 py-0.5 text-xs ${i === idx ? "border-[var(--os-teal,#0d9488)] bg-[var(--os-teal,#0d9488)]/10" : "border-[var(--os-border)]"}`} onClick={() => onIdx(i)}>
              Hoja {i + 1}
            </button>
          ))}
        </div>
      ) : null}
      <div className="max-h-[70dvh] overflow-auto rounded border border-[var(--os-border)] bg-[var(--os-bg)]">
        {current.type === "application/pdf" && current.url ? (
          <iframe src={current.url} title="Remito (PDF)" className="h-[70dvh] w-full" />
        ) : current.url && current.type !== "image/heic" ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={current.url} alt="Remito" className="w-full" />
        ) : (
          <p className="p-4 text-sm text-[var(--os-text-muted)]">No se puede previsualizar este formato acá; el archivo está guardado.</p>
        )}
      </div>
    </div>
  );
}

function HeaderForm({ draft, onChange, issueMap, extractionNote }: { draft: ReceiptDraftPayload; onChange: (d: ReceiptDraftPayload) => void; issueMap: Map<string, ReceiptIssue>; extractionNote?: string }) {
  const h = draft.header;
  const set = (patch: Partial<typeof h>) => onChange({ ...draft, header: { ...h, ...patch } });
  const bad = (f: string) => (issueMap.has(`h:${f}`) ? reviewRing : "");
  return (
    <fieldset className="grid gap-3 sm:grid-cols-2" data-testid="remito-cabecera">
      {extractionNote ? <p className="sm:col-span-2 text-xs text-amber-700">{extractionNote}</p> : null}
      <label className="text-sm">Proveedor<input className={`${field} ${bad("supplier")}`} value={h.supplier} onChange={(e) => set({ supplier: e.target.value })} data-testid="remito-proveedor" />{issueMap.get("h:supplier") ? <Hint issue={issueMap.get("h:supplier")!} /> : null}</label>
      <label className="text-sm">N.º de remito<input className={`${field} ${bad("remitoNumber")}`} value={h.remitoNumber} onChange={(e) => set({ remitoNumber: e.target.value })} data-testid="remito-numero" />{issueMap.get("h:remitoNumber") ? <Hint issue={issueMap.get("h:remitoNumber")!} /> : null}</label>
      <label className="text-sm">Fecha del remito<input type="date" className={`${field} ${bad("remitoDate")}`} value={h.remitoDate} onChange={(e) => set({ remitoDate: e.target.value })} data-testid="remito-fecha" />{issueMap.get("h:remitoDate") ? <Hint issue={issueMap.get("h:remitoDate")!} /> : null}</label>
      <label className="text-sm">Fecha de recepción (llegó la mercadería)<input type="date" className={`${field} ${bad("receivedDate")}`} value={h.receivedDate} onChange={(e) => set({ receivedDate: e.target.value })} data-testid="remito-recepcion" />{issueMap.get("h:receivedDate") ? <Hint issue={issueMap.get("h:receivedDate")!} /> : null}</label>
      <label className="text-sm sm:col-span-2">Observaciones<input className={field} value={h.notes} onChange={(e) => set({ notes: e.target.value })} /></label>
    </fieldset>
  );
}

function Hint({ issue }: { issue: ReceiptIssue }) {
  return <span className="mt-0.5 block text-xs text-amber-700 dark:text-amber-300">{issue.message}</span>;
}

function LineCard({
  module, index, line, supplier, suggestions, issueMap, onChange, onRemove,
}: {
  module: ReceiptModule; index: number; line: ReceiptLineDraft; supplier: string; suggestions: MaterialSuggestion[]; issueMap: Map<string, ReceiptIssue>;
  onChange: (l: ReceiptLineDraft) => void; onRemove: () => void;
}) {
  const [partial, setPartial] = useState(Boolean(line.remitoQuantity));
  const set = (patch: Partial<ReceiptLineDraft>) => onChange({ ...line, ...patch });
  const flag = (f: string) => (line.review.includes(f) || issueMap.has(`${index}:${f}`) ? reviewRing : "");
  const hint = (f: string) => (issueMap.get(`${index}:${f}`) ? <Hint issue={issueMap.get(`${index}:${f}`)!} /> : line.review.includes(f) ? <span className="mt-0.5 block text-xs text-amber-700">Revisar</span> : null);
  const dismiss = (f: string) => (line.review.includes(f) ? { review: line.review.filter((x) => x !== f) } : {});
  return (
    <article className="space-y-3 rounded-xl border border-[var(--os-border)] p-3" data-testid="remito-linea">
      <header className="flex items-center justify-between">
        <h4 className="text-sm font-semibold">Material {index + 1}</h4>
        <button type="button" aria-label="Quitar material" onClick={onRemove} className="text-rose-600"><X className="size-4" /></button>
      </header>
      <div className="grid gap-3 sm:grid-cols-2">
        <label className="text-sm">Código del proveedor (impreso en el remito)<input className={field} value={line.supplierCode} onChange={(e) => set({ supplierCode: e.target.value })} data-testid="linea-codigo-proveedor" /></label>
        <label className="text-sm">Descripción del remito<input className={`${field} ${flag("description")}`} value={line.description} onChange={(e) => set({ description: e.target.value, ...dismiss("description") })} data-testid="linea-descripcion" />{hint("description")}</label>
      </div>
      {line.matchSource === "previo" || line.matchSource === "codigo" || line.matchSource === "nombre" ? (
        <p className="text-xs text-sky-700 dark:text-sky-300" data-testid="linea-preseleccion">Material preseleccionado automáticamente: {line.matchReason || "coincidencia"}. Verificá que sea el correcto.</p>
      ) : null}
      <MaterialPicker module={module} supplier={supplier} line={line} suggestions={suggestions} bad={issueMap.has(`${index}:materialCode`) || line.review.includes("materialCode")} issue={issueMap.get(`${index}:materialCode`)} onPick={(code) => set({ materialCode: code, matchSource: "manual", matchReason: "", review: line.review.filter((x) => x !== "materialCode") })} />
      <div className="grid gap-3 sm:grid-cols-4">
        <label className="text-sm">Cantidad recibida<input inputMode="decimal" className={`${field} ${flag("quantity")}`} value={line.quantity} onChange={(e) => set({ quantity: e.target.value, ...dismiss("quantity") })} data-testid="linea-cantidad" />{hint("quantity")}</label>
        <label className="text-sm">Unidad<input className={`${field} ${flag("unit")}`} placeholder={module === "MP" ? "kg" : "un"} value={line.unit} onChange={(e) => set({ unit: e.target.value, ...dismiss("unit") })} data-testid="linea-unidad" />{hint("unit")}</label>
        <label className="text-sm">Bultos<input inputMode="numeric" className={field} value={line.packages} onChange={(e) => set({ packages: e.target.value })} data-testid="linea-bultos" /></label>
        {module === "MP" ? (
          <label className="text-sm">Lote del proveedor<input className={`${field} ${flag("lote")}`} value={line.lote} onChange={(e) => set({ lote: e.target.value, ...dismiss("lote") })} data-testid="linea-lote" />{hint("lote")}</label>
        ) : null}
      </div>
      {module === "MP" ? (
        <div className="grid gap-3 sm:grid-cols-2">
          <label className="text-sm">Vencimiento<input type="date" className={`${field} ${flag("vencimiento")}`} value={line.vencimiento} disabled={line.noExpiry} onChange={(e) => set({ vencimiento: e.target.value, ...dismiss("vencimiento") })} data-testid="linea-vencimiento" />{hint("vencimiento")}</label>
          <label className="flex items-center gap-2 pt-6 text-sm"><input type="checkbox" checked={line.noExpiry} onChange={(e) => set({ noExpiry: e.target.checked, vencimiento: e.target.checked ? "" : line.vencimiento })} data-testid="linea-sin-vencimiento" /> Sin vencimiento (no figura en la mercadería)</label>
        </div>
      ) : null}
      <div className="flex flex-wrap items-end gap-3">
        <button type="button" className="text-xs underline" onClick={() => setPartial((v) => !v)}>{partial ? "Ocultar recepción parcial" : "¿Recepción parcial? Indicar la cantidad del remito"}</button>
        {partial ? (
          <label className="text-sm">Cantidad según remito<input inputMode="decimal" className={field} value={line.remitoQuantity} onChange={(e) => set({ remitoQuantity: e.target.value })} data-testid="linea-cantidad-remito" /></label>
        ) : null}
        <label className="min-w-40 flex-1 text-sm">Observaciones del material<input className={field} value={line.notes} onChange={(e) => set({ notes: e.target.value })} /></label>
      </div>
      {partial && line.remitoQuantity.trim() && line.quantity.trim() ? <PendingNote remito={line.remitoQuantity} received={line.quantity} unit={line.unit} /> : null}
    </article>
  );
}

function PendingNote({ remito, received, unit }: { remito: string; received: string; unit: string }) {
  const num = (s: string) => Number(s.replace(/\./g, "").replace(",", "."));
  const r = num(remito);
  const q = num(received);
  if (!Number.isFinite(r) || !Number.isFinite(q) || r <= q) return null;
  return <p className="text-xs text-amber-700">Pendiente de recibir: {(r - q).toLocaleString("es-AR", { maximumFractionDigits: 3 })} {unit}. Solo se suma al stock lo recibido ahora.</p>;
}

function MaterialPicker({
  module, supplier, line, suggestions, bad, issue, onPick,
}: { module: ReceiptModule; supplier: string; line: ReceiptLineDraft; suggestions: MaterialSuggestion[]; bad: boolean; issue?: ReceiptIssue; onPick: (code: string) => void }) {
  const [open, setOpen] = useState(!line.materialCode);
  const [q, setQ] = useState("");
  const [results, setResults] = useState<CatalogItem[]>([]);
  const [selected, setSelected] = useState<CatalogItem | null>(null);
  const label = MODULE_TEXT[module].material;
  useEffect(() => {
    if (!open) return;
    let alive = true;
    const timer = setTimeout(() => {
      void call<{ items: CatalogItem[] }>(`${API}?module=${module}&view=catalog&q=${encodeURIComponent(q)}`).then((r) => alive && setResults(r.items)).catch(() => alive && setResults([]));
    }, 250);
    return () => {
      alive = false;
      clearTimeout(timer);
    };
  }, [open, q, module]);
  const chosen = selected && selected.code === line.materialCode ? selected : results.find((r) => r.code === line.materialCode) ?? suggestions.find((s) => s.code === line.materialCode) ?? null;
  return (
    <div className={`space-y-2 rounded-lg border p-2 ${bad ? reviewRing : "border-[var(--os-border)]"}`} data-testid="linea-material">
      <div className="flex flex-wrap items-center justify-between gap-2 text-sm">
        <span>
          <span className="text-[var(--os-text-muted)]">Material de GENUS OS ({label}): </span>
          {line.materialCode ? <strong data-testid="linea-material-elegido">{line.materialCode}{chosen ? ` — ${chosen.description}` : ""}</strong> : <em className="text-amber-700">sin elegir</em>}
        </span>
        <button type="button" className="text-xs underline" onClick={() => setOpen((v) => !v)}>{open ? "Cerrar" : line.materialCode ? "Cambiar" : "Elegir"}</button>
      </div>
      {issue ? <Hint issue={issue} /> : null}
      {open ? (
        <div className="space-y-2">
          {suggestions.length ? (
            <div className="flex flex-wrap gap-1" data-testid="linea-sugerencias">
              {suggestions.map((s) => (
                <button key={s.code} type="button" title={s.reason} className="rounded-full border border-[var(--os-border)] px-2 py-0.5 text-xs hover:bg-[var(--os-teal,#0d9488)]/10" onClick={() => { setSelected(s); onPick(s.code); setOpen(false); }}>
                  Sugerido{s.confidence ? ` (${s.confidence === "ALTA" ? "confianza alta" : s.confidence === "MEDIA" ? "confianza media — verificá" : "confianza baja — verificá"})` : ""}: {s.code} — {s.description}
                </button>
              ))}
            </div>
          ) : null}
          <input className={field} placeholder={`Buscar ${label} por código o nombre`} value={q} onChange={(e) => setQ(e.target.value)} data-testid="linea-buscar-material" aria-label="Buscar material" />
          <ul className="max-h-48 overflow-auto text-sm" data-testid="linea-catalogo">
            {results.map((r) => (
              <li key={r.code}>
                <button type="button" className="w-full rounded px-2 py-1 text-left hover:bg-[var(--os-teal,#0d9488)]/10" onClick={() => { setSelected(r); onPick(r.code); setOpen(false); }} data-testid="linea-catalogo-item">
                  <strong>{r.code}</strong> — {r.description} <span className="text-xs text-[var(--os-text-muted)]">({r.unit})</span>
                </button>
              </li>
            ))}
            {results.length === 0 ? <li className="px-2 py-1 text-xs text-[var(--os-text-muted)]">No hay coincidencias. Los materiales nuevos no se crean desde un remito: pedí el alta autorizada.</li> : null}
          </ul>
          {supplier && line.supplierCode ? <p className="text-[11px] text-[var(--os-text-muted)]">El código del proveedor ({line.supplierCode}) no es un código interno: elegí el material de GENUS OS que corresponde.</p> : null}
        </div>
      ) : null}
    </div>
  );
}

function Summary({
  module, draft, thumbs, analysis, ack, onAck, parentId, onParent, busy, onBack, onConfirm,
}: {
  module: ReceiptModule; draft: ReceiptDraftPayload; thumbs: Thumb[]; analysis: Analysis; ack: boolean; onAck: (v: boolean) => void; parentId: string; onParent: (v: string) => void;
  busy: boolean; onBack: () => void; onConfirm: () => void;
}) {
  const session = getCurrentAuthSession();
  const t = MODULE_TEXT[module];
  const needsAck = analysis.warnings.some((w) => w.requiresAck);
  const parent = analysis.warnings.find((w) => w.kind === "remito_parcial" && w.source === "recepcion");
  const blocked = !analysis.validation.ok || (needsAck && !ack);
  return (
    <section className="space-y-4" data-testid="paso-resumen">
      <dl className="grid gap-x-6 gap-y-1 text-sm sm:grid-cols-2">
        <div><dt className="inline text-[var(--os-text-muted)]">Sector: </dt><dd className="inline font-medium">{t.sector}</dd></div>
        <div><dt className="inline text-[var(--os-text-muted)]">Proveedor: </dt><dd className="inline font-medium">{draft.header.supplier || "—"}</dd></div>
        <div><dt className="inline text-[var(--os-text-muted)]">N.º de remito: </dt><dd className="inline font-medium">{draft.header.remitoNumber || "—"}</dd></div>
        <div><dt className="inline text-[var(--os-text-muted)]">Fecha del remito: </dt><dd className="inline font-medium">{draft.header.remitoDate || "—"}</dd></div>
        <div><dt className="inline text-[var(--os-text-muted)]">Fecha de recepción: </dt><dd className="inline font-medium">{draft.header.receivedDate || "—"}</dd></div>
        <div><dt className="inline text-[var(--os-text-muted)]">Responsable: </dt><dd className="inline font-medium">{session?.user.displayName || session?.user.email || "—"}</dd></div>
        <div><dt className="inline text-[var(--os-text-muted)]">Comprobante: </dt><dd className="inline font-medium">{thumbs.length} archivo{thumbs.length === 1 ? "" : "s"}</dd></div>
      </dl>
      <div className="overflow-x-auto">
        <table className="w-full min-w-[32rem] text-sm" data-testid="resumen-lineas">
          <thead><tr className="text-left text-xs text-[var(--os-text-muted)]"><th className="py-1">Material</th><th>Cantidad</th>{module === "MP" ? <><th>Lote</th><th>Vencimiento</th></> : <th>Bultos</th>}</tr></thead>
          <tbody>
            {draft.lines.map((l) => (
              <tr key={l.id} className="border-t border-[var(--os-border)]">
                <td className="py-1.5"><strong>{l.materialCode || "—"}</strong> <span className="text-xs text-[var(--os-text-muted)]">{l.description}</span></td>
                <td>{l.quantity} {l.unit}</td>
                {module === "MP" ? <><td>{l.lote || "—"}</td><td>{l.noExpiry ? "Sin vencimiento" : l.vencimiento || "—"}</td></> : <td>{l.packages || "—"}</td>}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {analysis.validation.issues.length ? (
        <div className="rounded-lg border border-amber-500/50 bg-amber-500/10 p-3 text-sm" role="alert" data-testid="resumen-pendientes">
          <p className="mb-1 flex items-center gap-2 font-medium"><AlertTriangle className="size-4" /> Falta corregir antes de confirmar:</p>
          <ul className="list-disc pl-5">{analysis.validation.issues.map((i, k) => <li key={k}>{i.line != null ? `Material ${i.line + 1}: ` : ""}{i.message}</li>)}</ul>
          <Button type="button" variant="secondary" className="mt-2" onClick={onBack}>Volver a la revisión</Button>
        </div>
      ) : null}

      {analysis.warnings.length ? (
        <div className="space-y-2 rounded-lg border border-amber-500/50 bg-amber-500/10 p-3 text-sm" data-testid="resumen-duplicados">
          <p className="flex items-center gap-2 font-medium"><AlertTriangle className="size-4" /> Posible remito ya cargado</p>
          <ul className="list-disc pl-5">{analysis.warnings.map((w, k) => <li key={k}>{w.detail}</li>)}</ul>
          {parent ? (
            <label className="flex items-center gap-2"><input type="checkbox" checked={parentId === parent.refId} onChange={(e) => onParent(e.target.checked ? parent.refId : "")} data-testid="resumen-parcial" /> Es una recepción parcial del mismo remito (vincularla a la anterior)</label>
          ) : null}
          {needsAck ? (
            <label className="flex items-start gap-2 font-medium"><input type="checkbox" className="mt-1" checked={ack} onChange={(e) => onAck(e.target.checked)} data-testid="resumen-reconozco" /> Revisé la advertencia y quiero cargar este ingreso igual.</label>
          ) : null}
        </div>
      ) : null}

      <p className="text-xs text-[var(--os-text-muted)]">Al confirmar se suma {module === "MP" ? "al Stock MP y al libro mayor" : "al stock de Depósito"} una sola vez, con este remito como comprobante. Para corregir cantidades después se usa un ajuste con motivo.</p>
      <div className="flex flex-wrap justify-between gap-2">
        <Button type="button" variant="secondary" onClick={onBack} disabled={busy}>Volver</Button>
        <Button type="button" onClick={onConfirm} disabled={busy || blocked} data-testid="remito-confirmar">
          {busy ? "Confirmando…" : "Confirmar ingreso de stock"}
        </Button>
      </div>
    </section>
  );
}

// ───────────────────────── Historial / consulta ─────────────────────────

function RemitosHistorial({ module, canWrite, onClose, onResume }: { module: ReceiptModule; canWrite: boolean; onClose: () => void; onResume: (id: string) => void }) {
  const [items, setItems] = useState<ReceiptSummary[] | null>(null);
  const [detail, setDetail] = useState<Receipt | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    let alive = true;
    void call<{ items: ReceiptSummary[] }>(`${API}?module=${module}&view=list`).then((r) => alive && setItems(r.items)).catch((e) => alive && setError(e instanceof Error ? e.message : "No se pudo cargar el historial."));
    return () => {
      alive = false;
    };
  }, [module]);
  async function open(id: string) {
    try {
      setDetail((await call<{ receipt: Receipt }>(`${API}?module=${module}&view=get&id=${id}`)).receipt);
    } catch (e) {
      setError(e instanceof Error ? e.message : "No se pudo abrir.");
    }
  }
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-h-[92dvh] w-[min(52rem,calc(100vw-16px))] max-w-none overflow-y-auto" data-testid="remitos-historial">
        <DialogTitle>Remitos recibidos — {MODULE_TEXT[module].sector}</DialogTitle>
        <DialogDescription>Ingresos registrados con foto de remito, con quién los cargó, cuándo y su comprobante.</DialogDescription>
        {error ? <p className="text-sm text-rose-600" role="alert">{error}</p> : null}
        {detail ? (
          <ReceiptDetail receipt={detail} onBack={() => setDetail(null)} />
        ) : items == null ? (
          <p className="text-sm text-[var(--os-text-muted)]">Cargando…</p>
        ) : items.length === 0 ? (
          <p className="text-sm text-[var(--os-text-muted)]">Todavía no hay ingresos registrados con remito.</p>
        ) : (
          <ul className="divide-y divide-[var(--os-border)]" data-testid="remitos-lista">
            {items.map((r) => (
              <li key={r.id} className="flex flex-wrap items-center justify-between gap-2 py-2 text-sm">
                <button type="button" className="text-left" onClick={() => void (r.status === "CONFIRMADO" ? open(r.id) : r.status === "EN_PLANILLA" ? undefined : canWrite ? onResume(r.id) : undefined)}>
                  <strong>{r.supplier || "(sin proveedor)"}</strong> · remito {r.remitoNumber || "—"} · {r.receivedDate || "—"}
                  <span className="block text-xs text-[var(--os-text-muted)]">{r.lineCount} material{r.lineCount === 1 ? "" : "es"} · {r.fileCount} archivo{r.fileCount === 1 ? "" : "s"} · {r.confirmedBy ?? r.createdBy}</span>
                </button>
                <span className={`rounded-full px-2 py-0.5 text-xs ${r.status === "CONFIRMADO" ? "bg-emerald-500/15 text-emerald-700" : r.status === "EN_PLANILLA" ? "bg-sky-500/15 text-sky-700" : "bg-amber-500/15 text-amber-700"}`}>{r.status === "CONFIRMADO" ? "Confirmado" : r.status === "EN_PLANILLA" ? "En la planilla" : "Borrador"}</span>
              </li>
            ))}
          </ul>
        )}
      </DialogContent>
    </Dialog>
  );
}

function ReceiptDetail({ receipt, onBack }: { receipt: Receipt; onBack: () => void }) {
  const h = receipt.draft.header;
  const when = (iso: string | null) => (iso ? new Date(iso).toLocaleString("es-AR", { dateStyle: "short", timeStyle: "short" }) : "—");
  return (
    <div className="space-y-3 text-sm" data-testid="remito-detalle">
      <button type="button" className="text-xs underline" onClick={onBack}>← Volver al listado</button>
      <p><strong>{h.supplier}</strong> · remito {h.remitoNumber} · fecha del remito {h.remitoDate || "—"} · recibido el {h.receivedDate || "—"}</p>
      <p className="text-xs text-[var(--os-text-muted)]">Registrado por {receipt.confirmedBy ?? receipt.createdBy} el {when(receipt.confirmedAt ?? receipt.createdAt)}</p>
      <table className="w-full text-sm">
        <thead><tr className="text-left text-xs text-[var(--os-text-muted)]"><th>Ingreso</th><th>Material</th><th>Cantidad</th><th>Lote</th><th>Venc.</th></tr></thead>
        <tbody>
          {receipt.confirmedLines.map((l) => (
            <tr key={l.ingresoId} className="border-t border-[var(--os-border)]">
              <td className="py-1"><strong>{l.ingresoNro ?? "—"}</strong></td>
              <td>{l.materialCode} <span className="text-xs text-[var(--os-text-muted)]">{l.materialLabel}</span></td>
              <td>{fmtQty(l.quantity, l.unit)}{l.remitoQuantity != null && l.remitoQuantity > l.quantity ? <span className="block text-xs text-amber-700">de {fmtQty(l.remitoQuantity, l.unit)} del remito</span> : null}</td>
              <td>{l.lote || "—"}</td>
              <td>{l.vencimiento || "—"}</td>
            </tr>
          ))}
        </tbody>
      </table>
      {receipt.movements.length ? (
        <div>
          <p className="text-xs font-medium">Movimientos de stock</p>
          <ul className="text-xs text-[var(--os-text-muted)]">{receipt.movements.map((m, i) => <li key={i}>{m.ingresoNro ?? m.ingresoId.slice(0, 8)} · {m.kind} {m.quantity > 0 ? "+" : ""}{m.quantity}{m.balanceAfter != null ? ` → saldo ${m.balanceAfter}` : ""} · {when(m.at)}</li>)}</ul>
        </div>
      ) : null}
      <div>
        <p className="text-xs font-medium">Comprobante</p>
        <ul className="space-y-1" data-testid="remito-archivos">
          {receipt.files.map((f) => (
            <li key={f.id} className="flex flex-wrap items-center gap-3">
              <span className="truncate">{f.fileName}</span>
              <a className="underline" href={`${FILE_API}/${f.id}`} target="_blank" rel="noopener noreferrer">Abrir</a>
              <a className="underline" href={`${FILE_API}/${f.id}?download=1`} download={f.fileName}>Descargar</a>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
