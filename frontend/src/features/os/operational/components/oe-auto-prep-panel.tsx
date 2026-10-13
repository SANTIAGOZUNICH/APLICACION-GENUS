"use client";

/**
 * Panel de la OE preparada automáticamente desde el trabajo asignado: qué llegó listo (producto, lote de fabricación,
 * cantidad, fórmula y versión) y qué falta. Los lotes de MP los completa el elaborador en la tabla, a medida que
 * elabora: acá solo se cuenta cuántos lleva (con lo que hay HOY en pantalla).
 *
 * «Actualizar desde fórmula» (Producción / Elaboración): primero muestra qué cambiaría y recién aplica al confirmar.
 * Si la fórmula nueva ya no tiene una MP con lote o ajuste del elaborador, lo advierte y exige confirmarlo.
 * Nunca mueve stock.
 */
import { useState } from "react";
import type { OeContent } from "@/lib/orders/types";
import { oeAutoPrepApi, type OeAutoPrepApiResponse, type OrdersClientSession } from "@/lib/orders/orders-client";
import { friendlySaveError } from "@/lib/ui/friendly-error";

const fmtKg = (v: number | null | undefined) =>
  v == null ? "—" : v.toLocaleString("es-AR", { maximumFractionDigits: 4 });

/** Lo que falta de Producción/fórmula (no incluye los lotes de MP: esos los completa el elaborador). */
export function livePendientes(content: OeContent): string[] {
  const ap = content.autoPrep;
  if (!ap) return [];
  const out = ap.pendientes.filter((p) => !p.startsWith("Lote de fabricación"));
  if (!content.header.lot.trim()) out.push("Lote de fabricación: Producción todavía no lo cargó en el trabajo.");
  return out;
}

/** Lotes de MP cargados por el elaborador / filas de MP. */
export function mpLotsProgress(content: OeContent): { filled: number; total: number } {
  const rows = content.materials.filter((m) => m.materiaPrima.trim() || m.codigo.trim());
  return { filled: rows.filter((m) => m.lote.trim()).length, total: rows.length };
}

export function OeAutoPrepPanel({
  orderId,
  version,
  content,
  canRefresh,
  session,
  onApplied,
}: {
  orderId: string;
  version: number;
  content: OeContent;
  canRefresh: boolean;
  session: OrdersClientSession;
  onApplied: () => void | Promise<void>;
}) {
  const ap = content.autoPrep;
  const [preview, setPreview] = useState<OeAutoPrepApiResponse | null>(null);
  const [previewVersion, setPreviewVersion] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [acceptLoss, setAcceptLoss] = useState(false);

  if (!ap && !canRefresh) return null;
  const pendientes = livePendientes(content);
  const lots = mpLotsProgress(content);
  const f = ap?.formula;

  const openPreview = async () => {
    setBusy(true);
    setMsg(null);
    try {
      const res = await oeAutoPrepApi(session, orderId);
      if (!res.ok) {
        setMsg(res.message ?? "No se puede actualizar esta OE.");
        return;
      }
      setPreview(res);
      setPreviewVersion(version);
      setAcceptLoss(false);
    } catch (err) {
      setMsg(friendlySaveError(err, "No se pudo actualizar la OE."));
    } finally {
      setBusy(false);
    }
  };

  const confirm = async () => {
    setBusy(true);
    setMsg(null);
    try {
      const res = await oeAutoPrepApi(session, orderId, { confirm: true, expectedVersion: previewVersion ?? version, acceptLostRecords: acceptLoss });
      if (!res.ok) {
        setMsg(res.message ?? "No se pudo actualizar.");
        return;
      }
      setPreview(null);
      setMsg(res.status === "unchanged" ? "La OE ya estaba al día." : "OE actualizada desde la fórmula.");
      await onApplied();
    } catch (err) {
      setMsg(friendlySaveError(err, "No se pudo actualizar la OE."));
    } finally {
      setBusy(false);
    }
  };

  return (
    <section
      className="rounded-lg border border-[var(--os-border)] bg-[var(--os-surface,white)] p-3 text-sm"
      data-testid="oe-autoprep-panel"
      aria-label="Preparación automática de la OE"
    >
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <p className="text-xs font-semibold uppercase tracking-wide text-[var(--os-text-muted)]">
            Preparada desde el trabajo asignado
          </p>
          {ap ? (
            <p className="text-xs text-[var(--os-text-muted)]">
              {new Date(ap.preparedAt).toLocaleString("es-AR")} · {ap.reason}
            </p>
          ) : (
            <p className="text-xs text-[var(--os-text-muted)]">Esta OE no se preparó automáticamente.</p>
          )}
        </div>
        {canRefresh ? (
          <button
            type="button"
            className="rounded border border-[var(--os-border)] px-3 py-1.5 text-sm hover:bg-[var(--os-bg)] disabled:opacity-50"
            onClick={() => void openPreview()}
            disabled={busy}
            data-testid="oe-autoprep-refresh"
          >
            {busy && !preview ? "Revisando…" : "Actualizar desde fórmula"}
          </button>
        ) : null}
      </div>

      {ap ? (
        <dl className="mt-2 grid gap-x-4 gap-y-1 sm:grid-cols-2 lg:grid-cols-4">
          <div>
            <dt className="text-xs text-[var(--os-text-muted)]">Producto</dt>
            <dd className="font-medium" data-testid="oe-autoprep-product">{content.header.productName || "—"}</dd>
          </div>
          <div>
            <dt className="text-xs text-[var(--os-text-muted)]">Lote de fabricación</dt>
            <dd data-testid="oe-autoprep-lot">
              {content.header.lot.trim() ? (
                <span className="font-medium">{content.header.lot}</span>
              ) : (
                <span className="font-semibold text-rose-700">Pendiente</span>
              )}
            </dd>
          </div>
          <div>
            <dt className="text-xs text-[var(--os-text-muted)]">Cantidad</dt>
            <dd className="font-medium" data-testid="oe-autoprep-qty">
              {content.header.quantityKg != null ? `${fmtKg(content.header.quantityKg)} kg` : <span className="font-semibold text-rose-700">Pendiente</span>}
            </dd>
          </div>
          <div>
            <dt className="text-xs text-[var(--os-text-muted)]">Fórmula</dt>
            <dd data-testid="oe-autoprep-formula">
              {f?.status === "ok" ? (
                <span>
                  <span className="font-medium">{f.displayProduct || content.header.productName}</span>
                  <span className="block text-xs text-[var(--os-text-muted)]">
                    {f.source === "DRIVE" ? "Google Drive" : "Banco de fórmulas"}
                    {f.sourceSheet ? ` · hoja «${f.sourceSheet}»` : ""}
                    {f.versionHash ? ` · versión ${f.versionHash.slice(0, 8)}` : ""}
                    {f.driveModifiedTime ? ` · modificada ${new Date(f.driveModifiedTime).toLocaleDateString("es-AR")}` : ""}
                  </span>
                </span>
              ) : (
                <span className="font-semibold text-rose-700">{f?.status === "manual_content" ? "Cargada a mano" : "Pendiente"}</span>
              )}
            </dd>
          </div>
        </dl>
      ) : null}

      {ap && f && f.status !== "ok" ? (
        <p className="mt-2 rounded border border-amber-300 bg-amber-50 px-2 py-1 text-amber-900" data-testid="oe-autoprep-formula-msg">
          {f.message}
        </p>
      ) : null}
      {ap ? (
        <p className="mt-2 text-xs text-[var(--os-text-muted)]" data-testid="oe-autoprep-mplots">
          Lotes de MP: {lots.filled} de {lots.total} cargados. Los completa Elaboración en la tabla, a medida que pesa.
        </p>
      ) : null}

      {pendientes.length > 0 ? (
        <div className="mt-2 rounded border border-rose-200 bg-rose-50 px-2 py-1.5" data-testid="oe-autoprep-pendientes">
          <p className="text-xs font-semibold text-rose-800">Falta completar ({pendientes.length})</p>
          <ul className="ml-4 list-disc text-rose-900">
            {pendientes.map((p) => (
              <li key={p}>{p}</li>
            ))}
          </ul>
        </div>
      ) : ap ? (
        <p className="mt-2 text-xs font-medium text-emerald-700" data-testid="oe-autoprep-ready">
          ✓ Fórmula, cantidades y lote de fabricación listos: completá los lotes de MP y los datos del proceso.
        </p>
      ) : null}

      {msg ? (
        <p className="mt-2 text-sm" role="status" data-testid="oe-autoprep-msg">
          {msg}
        </p>
      ) : null}

      {preview?.preview ? (
        <div className="mt-3 rounded border border-[var(--os-border)] p-2" data-testid="oe-autoprep-preview" role="dialog" aria-label="Vista previa de la actualización">
          <p className="font-semibold">Así quedaría la OE</p>
          <p className="text-xs text-[var(--os-text-muted)]">
            Producto {preview.preview.header.productName} · Lote {preview.preview.header.lot || "pendiente"} · Cantidad{" "}
            {preview.preview.header.quantityKg != null ? `${fmtKg(preview.preview.header.quantityKg)} kg` : "pendiente"}
            {preview.autoPrep?.formula.status === "ok" ? "" : ` · Fórmula: ${preview.autoPrep?.formula.message ?? "pendiente"}`}
          </p>
          <div className="mt-2 max-h-64 overflow-auto">
            <table className="w-full text-left text-xs">
              <thead>
                <tr>
                  <th className="p-1">MP</th>
                  <th className="p-1">Código</th>
                  <th className="p-1 text-right">%</th>
                  <th className="p-1 text-right">Kg a pesar</th>
                  <th className="p-1">Lote</th>
                </tr>
              </thead>
              <tbody>
                {preview.preview.materials.map((m, i) => {
                  const before = content.materials[i];
                  const changed =
                    !before ||
                    before.materiaPrima !== m.materiaPrima ||
                    before.formulaPct !== m.formulaPct ||
                    before.kgAPesar !== m.kgAPesar ||
                    before.lote !== m.lote;
                  return (
                    <tr key={`${m.codigo}-${i}`} className={changed ? "bg-amber-400/15 font-medium" : ""}>
                      <td className="p-1">{m.materiaPrima}</td>
                      <td className="p-1">{m.codigo}</td>
                      <td className="p-1 text-right">{m.formulaPct ?? "—"}</td>
                      <td className="p-1 text-right">{fmtKg(m.kgAPesar)}</td>
                      <td className="p-1">{m.lote || <span className="text-rose-700">pendiente</span>}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          {preview.status === "unchanged" ? (
            <p className="mt-2 text-xs text-[var(--os-text-muted)]">No hay cambios: la OE ya coincide con la fórmula y los lotes.</p>
          ) : (
            <p className="mt-2 text-xs text-[var(--os-text-muted)]">
              Las filas resaltadas cambian. Los lotes y ajustes del elaborador se conservan en las MP que siguen en la
              fórmula. No se mueve stock.
            </p>
          )}
          {preview.lostRecords && preview.lostRecords.length > 0 ? (
            <div className="mt-2 rounded border border-amber-400 bg-amber-50 px-2 py-1.5 text-amber-950" data-testid="oe-autoprep-lost">
              <p className="font-semibold">Atención: la fórmula ya no tiene estas materias primas, que tienen datos del elaborador</p>
              <ul className="ml-4 list-disc">
                {preview.lostRecords.map((l, i) => (
                  <li key={`${l.codigo}-${i}`}>
                    {l.materiaPrima || l.codigo}
                    {l.lote ? ` — lote ${l.lote}` : ""}
                    {l.ajuste != null ? ` — ajuste ${l.ajuste} kg` : ""}
                  </li>
                ))}
              </ul>
              <label className="mt-1 flex items-center gap-2">
                <input type="checkbox" checked={acceptLoss} onChange={(e) => setAcceptLoss(e.target.checked)} data-testid="oe-autoprep-accept-lost" />
                Entiendo que se quitan de la OE (quedan en el historial de versiones)
              </label>
            </div>
          ) : null}
          <div className="mt-2 flex gap-2">
            <button
              type="button"
              className="rounded bg-[var(--os-teal)] px-3 py-1.5 text-sm font-medium text-white disabled:opacity-50"
              onClick={() => void confirm()}
              disabled={busy || preview.status === "unchanged" || ((preview.lostRecords?.length ?? 0) > 0 && !acceptLoss)}
              data-testid="oe-autoprep-confirm"
            >
              {busy ? "Aplicando…" : "Aplicar cambios"}
            </button>
            <button type="button" className="rounded border px-3 py-1.5 text-sm" onClick={() => setPreview(null)} disabled={busy}>
              Cancelar
            </button>
          </div>
        </div>
      ) : null}
    </section>
  );
}
