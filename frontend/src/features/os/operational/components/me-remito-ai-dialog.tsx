"use client";

/**
 * Depósito → Material de Empaque → Ingresos → "Cargar desde remito".
 * foto/PDF → IA interpreta → PREVIEW editable → el operario CONFIRMA → recién ahí se crean ingresos.
 * Pensado para celular (cámara trasera, tarjetas apiladas, botones grandes).
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Camera, FileUp, Loader2, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { fetchInventory } from "@/features/os/operational/adapters/inventory-client";
import {
  analyzeRemito,
  compressImageForUpload,
  confirmRemito,
  REMITO_UPLOAD_LIMIT_BYTES,
  RemitoClientError,
  type ConfirmResult,
  type RemitoDuplicateInfo,
  type RemitoPreview,
} from "@/features/os/operational/adapters/remito-ai-client";
import type { MeMaterial } from "@/lib/inventory/types";
import type { MeRemitoLine, RemitoConfianza } from "@/lib/inventory/remito-ai/types";

type Step = "capture" | "analyzing" | "preview" | "confirming" | "done" | "duplicate";

type LineState = {
  include: boolean;
  materialId: string;
  cantidad: string;
  conversionConfirmada: boolean;
};

const CONF_STYLE: Record<RemitoConfianza, { label: string; icon: string; cls: string }> = {
  ALTA: { label: "ALTA", icon: "✓", cls: "bg-emerald-100 text-emerald-800" },
  MEDIA: { label: "MEDIA · revisar", icon: "🟡", cls: "bg-amber-100 text-amber-900" },
  BAJA: { label: "REVISAR MATERIAL", icon: "🟡", cls: "bg-amber-100 text-amber-900" },
  SIN_COINCIDENCIA: { label: "SIN COINCIDENCIA", icon: "🔴", cls: "bg-rose-100 text-rose-800" },
};

const fmt = (n: number) => n.toLocaleString("es-AR");

function parseQty(s: string): number | null {
  let t = s.trim();
  // es-AR: "1.000" (miles) · "1.000,5" · "2,5" · "2.5" (decimal con punto).
  if (t.includes(",")) t = t.replace(/\./g, "").replace(",", ".");
  else if (/^\d{1,3}(\.\d{3})+$/.test(t)) t = t.replace(/\./g, "");
  if (!t) return null;
  const n = Number(t);
  return Number.isFinite(n) && n > 0 ? n : null;
}

export function MeRemitoAiDialog({
  open,
  onClose,
  onDone,
  onShowIngresos,
}: {
  open: boolean;
  onClose: () => void;
  onDone: () => void;
  onShowIngresos: (remitoNro: string) => void;
}) {
  const [step, setStep] = useState<Step>("capture");
  const [files, setFiles] = useState<File[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [unreadable, setUnreadable] = useState(false);
  const [preview, setPreview] = useState<RemitoPreview | null>(null);
  const [duplicate, setDuplicate] = useState<RemitoDuplicateInfo | null>(null);
  const [header, setHeader] = useState({ proveedor: "", numeroRemito: "", fecha: "" });
  const [lines, setLines] = useState<Record<string, LineState>>({});
  const [catalog, setCatalog] = useState<MeMaterial[]>([]);
  const [result, setResult] = useState<ConfirmResult | null>(null);
  const cameraRef = useRef<HTMLInputElement>(null);
  const galleryRef = useRef<HTMLInputElement>(null);

  const reset = useCallback(() => {
    setStep("capture");
    setFiles([]);
    setError(null);
    setUnreadable(false);
    setPreview(null);
    setDuplicate(null);
    setLines({});
    setResult(null);
  }, []);

  // El padre monta el diálogo solo cuando está abierto: el estado arranca limpio.
  useEffect(() => {
    if (!open) return;
    void fetchInventory<MeMaterial>("me_stock")
      .then((res) => setCatalog(res.data.filter((m) => !m.archived && m.codigo)))
      .catch(() => setCatalog([]));
  }, [open]);

  const previews = useMemo(
    () => files.map((f) => (f.type.startsWith("image/") ? URL.createObjectURL(f) : null)),
    [files]
  );
  useEffect(() => () => previews.forEach((u) => u && URL.revokeObjectURL(u)), [previews]);

  async function addFiles(list: FileList | null) {
    if (!list || list.length === 0) return;
    setError(null);
    const prepared = await Promise.all([...list].map((f) => compressImageForUpload(f)));
    setFiles((prev) => [...prev, ...prepared].slice(0, 8));
  }

  async function analyze() {
    const total = files.reduce((a, f) => a + f.size, 0);
    if (total > REMITO_UPLOAD_LIMIT_BYTES) {
      setError("Los archivos son demasiado pesados (máx. 4 MB en total). Sacá fotos más chicas o quitá páginas.");
      return;
    }
    setStep("analyzing");
    setError(null);
    setUnreadable(false);
    try {
      const p = await analyzeRemito(files);
      if (p.duplicate) {
        setDuplicate(p.duplicate);
        setStep("duplicate");
        return;
      }
      setPreview(p);
      setHeader({ proveedor: p.header.proveedor, numeroRemito: p.header.numeroRemito, fecha: p.header.fecha ?? "" });
      const init: Record<string, LineState> = {};
      for (const l of p.lines) {
        init[l.id] = {
          include: l.includeDefault,
          materialId: l.materialSugeridoId ?? "",
          cantidad: l.requiereConversion || l.cantidadInterpretada == null ? "" : String(l.cantidadInterpretada),
          conversionConfirmada: false,
        };
      }
      setLines(init);
      setStep("preview");
    } catch (e) {
      setStep("capture");
      if (e instanceof RemitoClientError && e.code === "REMITO_ILEGIBLE") setUnreadable(true);
      setError(e instanceof Error ? e.message : "No se pudo analizar el remito.");
    }
  }

  const summary = useMemo(() => {
    if (!preview) return null;
    const asociados = preview.lines.filter((l) => lines[l.id]?.include && lines[l.id]?.materialId).length;
    const incluidas = preview.lines.filter((l) => lines[l.id]?.include).length;
    const pendientes = preview.lines.filter((l) => {
      const s = lines[l.id];
      return s?.include && (!s.materialId || parseQty(s.cantidad) == null);
    }).length;
    return { total: preview.lines.length, asociados, incluidas, pendientes };
  }, [preview, lines]);

  async function confirm() {
    if (!preview?.docId || !summary) return;
    setStep("confirming");
    setError(null);
    try {
      const res = await confirmRemito({
        docId: preview.docId,
        header: { proveedor: header.proveedor, numeroRemito: header.numeroRemito, fecha: header.fecha || null },
        lines: preview.lines.map((l) => {
          const s = lines[l.id]!;
          return {
            lineId: l.id,
            include: s.include,
            materialId: s.materialId || null,
            cantidad: parseQty(s.cantidad),
            conversionConfirmada: s.conversionConfirmada,
          };
        }),
      });
      setResult(res);
      setStep("done");
    } catch (e) {
      if (e instanceof RemitoClientError && e.duplicate) {
        setDuplicate(e.duplicate);
        setStep("duplicate");
        return;
      }
      setStep("preview");
      setError(e instanceof Error ? e.message : "No se pudo confirmar.");
    }
  }

  if (!open) return null;

  const sortedCatalog = [...catalog].sort((a, b) => a.codigo.localeCompare(b.codigo, "es"));

  return (
    <div className="fixed inset-0 z-50 flex items-stretch justify-center bg-black/50 sm:items-center sm:p-4" data-testid="remito-ai-dialog">
      <div className="flex max-h-full w-full max-w-3xl flex-col overflow-hidden bg-[var(--os-surface)] shadow-xl sm:rounded-lg">
        <div className="flex items-center justify-between border-b border-[var(--os-border)] px-4 py-3">
          <h2 className="text-base font-semibold">Cargar ingresos desde remito</h2>
          <button type="button" aria-label="Cerrar" className="inline-flex size-10 items-center justify-center" onClick={onClose}>
            <X className="size-5" />
          </button>
        </div>

        <div className="flex-1 space-y-4 overflow-y-auto px-4 py-4 text-sm">
          {error && (
            <div
              role="alert"
              className={`rounded border px-3 py-2 ${unreadable ? "border-rose-300 bg-rose-50 text-rose-900" : "border-amber-300 bg-amber-50 text-amber-900"}`}
              data-testid="remito-ai-error"
            >
              {unreadable ? "🔴 " : ""}
              {error}
            </div>
          )}

          {(step === "capture" || step === "analyzing") && (
            <div className="space-y-3">
              <p className="text-[var(--os-text-muted)]">
                Sacá una foto del remito (o subí imagen / PDF). Si tiene varias hojas, agregalas todas: se leen como un solo remito.
                La IA solo propone: nada se guarda hasta que lo revises y confirmes.
              </p>
              <input
                ref={cameraRef}
                type="file"
                accept="image/*"
                capture="environment"
                className="hidden"
                data-testid="remito-camera-input"
                onChange={(e) => {
                  void addFiles(e.target.files);
                  e.target.value = "";
                }}
              />
              <input
                ref={galleryRef}
                type="file"
                accept="image/jpeg,image/png,image/webp,application/pdf"
                multiple
                className="hidden"
                data-testid="remito-file-input"
                onChange={(e) => {
                  void addFiles(e.target.files);
                  e.target.value = "";
                }}
              />
              <div className="grid gap-2 sm:grid-cols-2">
                <Button type="button" className="h-12" disabled={step === "analyzing"} onClick={() => cameraRef.current?.click()}>
                  <Camera className="mr-2 size-5" /> {files.length ? "Agregar otra hoja (cámara)" : "Sacar foto"}
                </Button>
                <Button type="button" variant="secondary" className="h-12" disabled={step === "analyzing"} onClick={() => galleryRef.current?.click()}>
                  <FileUp className="mr-2 size-5" /> Subir imagen / PDF
                </Button>
              </div>
              {files.length > 0 && (
                <ul className="grid grid-cols-2 gap-2 sm:grid-cols-4" data-testid="remito-files">
                  {files.map((f, i) => (
                    <li key={`${f.name}-${i}`} className="relative rounded border border-[var(--os-border)] p-1">
                      {previews[i] ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img src={previews[i]!} alt={`Hoja ${i + 1}`} className="h-28 w-full rounded object-cover" />
                      ) : (
                        <div className="flex h-28 items-center justify-center text-xs">PDF · {f.name}</div>
                      )}
                      <div className="mt-1 text-center text-xs text-[var(--os-text-muted)]">Hoja {i + 1}</div>
                      <button
                        type="button"
                        aria-label={`Quitar hoja ${i + 1}`}
                        className="absolute right-1 top-1 inline-flex size-7 items-center justify-center rounded-full bg-black/60 text-white"
                        onClick={() => setFiles((prev) => prev.filter((_, j) => j !== i))}
                      >
                        <X className="size-4" />
                      </button>
                    </li>
                  ))}
                </ul>
              )}
              <Button type="button" className="h-12 w-full" disabled={files.length === 0 || step === "analyzing"} onClick={() => void analyze()}>
                {step === "analyzing" ? (
                  <>
                    <Loader2 className="mr-2 size-5 animate-spin" /> Analizando remito…
                  </>
                ) : (
                  "Analizar remito"
                )}
              </Button>
            </div>
          )}

          {step === "duplicate" && duplicate && (
            <div className="space-y-3 rounded border border-rose-300 bg-rose-50 p-4 text-rose-900" data-testid="remito-duplicate">
              <div className="text-base font-semibold">🔴 ESTE REMITO YA FUE CARGADO</div>
              <div>Proveedor: {duplicate.proveedor || "—"}</div>
              <div>Remito: {duplicate.numeroRemito || "—"}</div>
              <div>Fecha de carga: {duplicate.confirmedAt ? new Date(duplicate.confirmedAt).toLocaleString("es-AR") : "—"}</div>
              <div>Usuario: {duplicate.confirmedBy ?? "—"}</div>
              {duplicate.motivo === "ARCHIVO" && <div>(Es el mismo archivo que ya se procesó.)</div>}
              <div className="flex flex-wrap gap-2 pt-1">
                <Button
                  type="button"
                  onClick={() => {
                    onShowIngresos(duplicate.numeroRemito);
                    onClose();
                  }}
                >
                  VER INGRESOS
                </Button>
                <Button type="button" variant="secondary" onClick={reset}>
                  Cargar otro remito
                </Button>
              </div>
            </div>
          )}

          {(step === "preview" || step === "confirming") && preview && summary && (
            <div className="space-y-4">
              <section className="grid gap-2 sm:grid-cols-3">
                <label className="flex flex-col gap-1">
                  <span className="text-xs font-medium">Proveedor</span>
                  <input className="h-11 rounded border border-[var(--os-border)] px-2" value={header.proveedor} onChange={(e) => setHeader({ ...header, proveedor: e.target.value })} />
                </label>
                <label className="flex flex-col gap-1">
                  <span className="text-xs font-medium">N° Remito</span>
                  <input className="h-11 rounded border border-[var(--os-border)] px-2" value={header.numeroRemito} onChange={(e) => setHeader({ ...header, numeroRemito: e.target.value })} />
                </label>
                <label className="flex flex-col gap-1">
                  <span className="text-xs font-medium">Fecha del remito</span>
                  <input type="date" className="h-11 rounded border border-[var(--os-border)] px-2" value={header.fecha} onChange={(e) => setHeader({ ...header, fecha: e.target.value })} />
                </label>
              </section>

              {preview.warnings.map((w) => (
                <div key={w} className="rounded border border-amber-300 bg-amber-50 px-3 py-2 text-amber-900">
                  🟡 {w}
                </div>
              ))}

              <div className="rounded bg-[var(--os-bg)] px-3 py-2 font-medium" data-testid="remito-summary">
                {summary.total} materiales detectados · {summary.asociados} asociados ·{" "}
                {summary.pendientes > 0 ? `${summary.pendientes} requieren revisión` : "listos para confirmar"}
              </div>

              <ul className="space-y-3">
                {preview.lines.map((l) => (
                  <LineCard
                    key={l.id}
                    line={l}
                    state={lines[l.id]!}
                    catalog={sortedCatalog}
                    onChange={(patch) => setLines((prev) => ({ ...prev, [l.id]: { ...prev[l.id]!, ...patch } }))}
                  />
                ))}
              </ul>
            </div>
          )}

          {step === "done" && result && (
            <div className="space-y-3" data-testid="remito-done">
              <div className="rounded border border-emerald-300 bg-emerald-50 p-3 text-emerald-900">
                <div className="text-base font-semibold">INGRESOS REGISTRADOS</div>
                <div>
                  Remito {result.doc.numeroRemito || "s/n"} · {result.doc.proveedor}
                </div>
              </div>
              <ul className="space-y-2">
                {result.ingresos.map((ing) => {
                  const st = result.stock.find((s) => s.materialId === ing.materialId);
                  return (
                    <li key={ing.id} className="rounded border border-[var(--os-border)] px-3 py-2">
                      <div className="font-medium">
                        {ing.codigo} — {ing.descripcionInsumo}
                      </div>
                      <div>+{fmt(ing.total ?? 0)} un.</div>
                      {st && (
                        <div className={st.negativo ? "font-semibold text-red-600" : ""}>
                          {st.negativo ? `🔴 STOCK ACTUAL: ${fmt(st.stockActual)} un. Revisar movimientos pendientes de carga.` : `Stock actual: ${fmt(st.stockActual)} un.`}
                        </div>
                      )}
                    </li>
                  );
                })}
              </ul>
            </div>
          )}
        </div>

        <div className="flex flex-wrap items-center justify-end gap-2 border-t border-[var(--os-border)] px-4 py-3">
          {(step === "preview" || step === "confirming") && summary && (
            <>
              <Button type="button" variant="secondary" disabled={step === "confirming"} onClick={reset}>
                Volver
              </Button>
              <Button
                type="button"
                className="h-11"
                data-testid="remito-confirm"
                disabled={step === "confirming" || summary.incluidas === 0 || summary.pendientes > 0 || !header.proveedor.trim()}
                onClick={() => void confirm()}
              >
                {step === "confirming" ? "Registrando…" : summary.pendientes > 0 ? `Resolver ${summary.pendientes} línea(s)` : "CONFIRMAR INGRESOS"}
              </Button>
            </>
          )}
          {step === "done" && (
            <Button
              type="button"
              onClick={() => {
                onDone();
                onClose();
              }}
            >
              Listo
            </Button>
          )}
          {(step === "capture" || step === "duplicate") && (
            <Button type="button" variant="secondary" onClick={onClose}>
              Cerrar
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}

function LineCard({
  line,
  state,
  catalog,
  onChange,
}: {
  line: MeRemitoLine;
  state: LineState;
  catalog: MeMaterial[];
  onChange: (patch: Partial<LineState>) => void;
}) {
  const conf = CONF_STYLE[line.confianza];
  const candidateIds = new Set(line.candidates.map((c) => c.materialId));
  const suggested = catalog.filter((m) => candidateIds.has(m.id));
  const others = catalog.filter((m) => !candidateIds.has(m.id));
  const qty = parseQty(state.cantidad);
  const needsMaterial = state.include && !state.materialId;
  return (
    <li className={`rounded border p-3 ${state.include ? "border-[var(--os-border)]" : "border-dashed opacity-60"}`} data-testid="remito-line">
      <div className="flex items-start justify-between gap-2">
        <div>
          <div className="font-medium">{line.descripcionOriginal}</div>
          <div className="text-xs text-[var(--os-text-muted)]">
            En el remito: {line.cantidadTexto || "—"} {line.unidadOriginal}
            {line.codigoProveedor ? ` · cód. ${line.codigoProveedor}` : ""}
          </div>
        </div>
        <span className={`shrink-0 rounded px-2 py-0.5 text-xs font-medium ${conf.cls}`}>
          {conf.icon} {conf.label}
        </span>
      </div>

      <label className="mt-2 flex flex-col gap-1">
        <span className="text-xs font-medium">Material GENUS</span>
        <select
          className={`h-11 rounded border px-2 ${needsMaterial ? "border-amber-400" : "border-[var(--os-border)]"}`}
          value={state.materialId}
          onChange={(e) => onChange({ materialId: e.target.value })}
          data-testid="remito-line-material"
        >
          <option value="">[seleccionar]</option>
          {suggested.length > 0 && (
            <optgroup label="Sugeridos">
              {suggested.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.codigo} — {m.descripcion}
                </option>
              ))}
            </optgroup>
          )}
          <optgroup label="Todos los materiales">
            {others.map((m) => (
              <option key={m.id} value={m.id}>
                {m.codigo} — {m.descripcion}
              </option>
            ))}
          </optgroup>
        </select>
      </label>

      <div className="mt-2 grid grid-cols-2 items-end gap-2">
        <label className="flex flex-col gap-1">
          <span className="text-xs font-medium">{line.requiereConversion ? "Unidades a ingresar" : "Cantidad (un.)"}</span>
          <input
            inputMode="decimal"
            className={`h-11 rounded border px-2 ${state.include && qty == null ? "border-amber-400" : "border-[var(--os-border)]"}`}
            value={state.cantidad}
            placeholder={line.requiereConversion ? `${line.cantidadTexto} ${line.unidadOriginal} → ¿cuántas un.?` : ""}
            onChange={(e) => onChange({ cantidad: e.target.value, conversionConfirmada: line.requiereConversion ? true : state.conversionConfirmada })}
            data-testid="remito-line-qty"
          />
        </label>
        <label className="flex h-11 items-center gap-2">
          <input type="checkbox" className="size-5" checked={state.include} onChange={(e) => onChange({ include: e.target.checked })} />
          <span>{state.include ? "Ingresar" : "No ingresar esta línea"}</span>
        </label>
      </div>

      {line.warnings.map((w) => (
        <div key={w} className="mt-2 text-xs text-amber-800">
          🟡 {w}
        </div>
      ))}
    </li>
  );
}
