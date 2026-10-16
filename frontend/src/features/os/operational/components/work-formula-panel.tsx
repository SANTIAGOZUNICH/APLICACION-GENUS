"use client";

/**
 * «Ver OE / Fórmula» en el detalle de un trabajo de Elaboración.
 *  - Elaboración: abre la OE vinculada (mismo editor de siempre) y el archivo de la fórmula de la carpeta de Drive
 *    (se descarga por GENUS OS con la cuenta de servicio: no se publica nada ni cambian permisos).
 *  - Producción/Dirección: además ve los avisos (falta la fórmula, sin acceso, vínculo vencido), las opciones cuando hay
 *    varios archivos parecidos (copias, versiones, otro cliente) y elige cuál vincular. Nunca se vincula solo.
 */
import { useCallback, useEffect, useState } from "react";
import { AlertTriangle, Download, ExternalLink, FileSpreadsheet, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Drawer, DrawerBody, DrawerCloseButton, DrawerContent, DrawerHeader, DrawerTitle } from "@/components/ui/drawer";
import { OperationalOrderEditor } from "./operational-order-editor";
import { driveFormulasApi } from "@/lib/formulas/drive-formulas-client";
import type { WorkFormulaInfo } from "@/lib/formulas/work-formula-info";

const FLAG_LABEL: Record<string, string> = {
  copia: "copia",
  version: "versión",
  subcarpeta: "en subcarpeta",
  carpeta_antigua: "carpeta de versiones anteriores",
  otro_cliente: "parece de otro cliente",
  duplicado: "repetido",
};
const REASON_LABEL: Record<string, string> = {
  codigo: "mismo código",
  nombre_exacto: "mismo nombre",
  nombre_compacto: "mismo nombre",
  mismas_palabras: "mismas palabras",
  contiene: "nombre parecido",
  parecido: "nombre parecido",
};
const fmtDate = (iso: string | null) => (iso ? new Date(iso).toLocaleString("es-AR", { dateStyle: "short", timeStyle: "short" }) : "—");

export function WorkFormulaPanel({ workItemId }: { workItemId: string }) {
  const [info, setInfo] = useState<WorkFormulaInfo | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [oeOpen, setOeOpen] = useState(false);
  const [choosing, setChoosing] = useState(false);
  const [selected, setSelected] = useState<string | null>(null);
  const [busy, setBusy] = useState<"link" | "sync" | "unlink" | "retry" | null>(null);

  const load = useCallback(async () => {
    setError(null);
    try {
      setInfo(await driveFormulasApi.workInfo(workItemId));
    } catch (e) {
      setError(e instanceof Error ? e.message : "No se pudo consultar la fórmula.");
    }
  }, [workItemId]);

  // El detalle monta un panel por trabajo (key = id): la primera carga no necesita limpiar estado.
  useEffect(() => {
    let alive = true;
    driveFormulasApi
      .workInfo(workItemId)
      .then((i) => alive && setInfo(i))
      .catch((e: unknown) => alive && setError(e instanceof Error ? e.message : "No se pudo consultar la fórmula."));
    return () => {
      alive = false;
    };
  }, [workItemId]);

  const sync = async () => {
    setBusy("sync");
    setNotice(null);
    try {
      const r = await driveFormulasApi.sync();
      setNotice(r.result.ok ? `Índice actualizado: ${r.result.fileCount} archivos de ${r.result.clientCount} clientes (${r.result.added ?? 0} nuevos, ${r.result.removed ?? 0} quitados).` : r.result.error ?? "No se pudo actualizar el índice.");
      await load();
    } catch (e) {
      setNotice(e instanceof Error ? e.message : "No se pudo actualizar el índice.");
    } finally {
      setBusy(null);
    }
  };

  const link = async () => {
    if (!info || !selected) return;
    setBusy("link");
    setNotice(null);
    try {
      const r = await driveFormulasApi.link({ client: info.work.client, product: info.work.product, fileId: selected, workItemId: info.work.id });
      const oeMsg =
        r.oe?.status === "applied"
          ? ` La OE ${r.oe.orderNumber ?? ""} se preparó con esta fórmula.`
          : r.oe?.message
            ? ` ${r.oe.message}`
            : "";
      setNotice(`Fórmula vinculada: «${r.link.fileName}».${oeMsg}`);
      setChoosing(false);
      setSelected(null);
      await load();
    } catch (e) {
      setNotice(e instanceof Error ? e.message : "No se pudo vincular la fórmula.");
    } finally {
      setBusy(null);
    }
  };

  const unlink = async () => {
    if (!info?.link) return;
    setBusy("unlink");
    try {
      await driveFormulasApi.unlink(info.link.id, "Desvinculado por Producción");
      setNotice("Vínculo quitado. La próxima búsqueda vuelve a usar el índice.");
      await load();
    } catch (e) {
      setNotice(e instanceof Error ? e.message : "No se pudo desvincular.");
    } finally {
      setBusy(null);
    }
  };

  const retryOe = async () => {
    if (!info) return;
    setBusy("retry");
    setNotice(null);
    try {
      const r = await driveFormulasApi.retryOe(info.work.id);
      setInfo(r.info);
      setNotice(r.pending.resolved ? `La OE ${r.pending.orderNumbers.join(", ")} quedó con la fórmula cargada.` : r.info.oe?.formulaMessage ?? "La OE sigue sin fórmula: revisá el aviso.");
    } catch (e) {
      setNotice(e instanceof Error ? e.message : "No se pudo preparar la OE.");
    } finally {
      setBusy(null);
    }
  };

  const doc = info?.document ?? null;
  const oePending = Boolean(info?.oe && info.oe.formulaStatus !== "ok" && info.oe.formulaStatus !== "manual_content" && ["BORRADOR", "PENDIENTE"].includes(info.oe.status));
  const showWarning = info && info.status !== "ok";
  const candidates = info?.candidates ?? [];
  const canChoose = Boolean(info?.canLink && candidates.length);
  const openChooser = choosing || (canChoose && (info?.status === "ambiguous" || info?.status === "not_found"));

  return (
    <section className="space-y-2 rounded-[var(--os-radius-sm)] border border-[var(--os-border)] p-3" data-testid="work-formula-panel" data-status={info?.status ?? (error ? "error" : "loading")}>
      <p className="text-xs uppercase text-[var(--os-text-muted)]">OE / Fórmula</p>
      {error && <p role="alert" className="text-xs text-[var(--genus-error,#e85d5d)]">{error}</p>}
      {!info && !error && <p className="text-xs text-[var(--os-text-muted)]">Buscando la OE y la fórmula…</p>}
      {info && (
        <>
          <div className="flex flex-wrap gap-2">
            {info.oe ? (
              <Button type="button" size="sm" onClick={() => setOeOpen(true)} data-testid="work-formula-open-oe">
                Ver OE {info.oe.number}
              </Button>
            ) : (
              <span className="text-xs text-[var(--os-text-muted)]">Sin OE vinculada.</span>
            )}
            {doc?.downloadable && (
              <a
                href={driveFormulasApi.downloadUrl(doc.fileId)}
                className="inline-flex items-center gap-1 rounded-md border border-[var(--os-border)] px-2.5 py-1 text-sm text-[var(--os-teal)] hover:underline"
                data-testid="work-formula-download"
              >
                <Download className="size-3.5" aria-hidden="true" /> Ver fórmula
              </a>
            )}
            {doc?.driveUrl && (
              <a href={doc.driveUrl} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 px-1 py-1 text-xs text-[var(--os-text-muted)] hover:underline" data-testid="work-formula-drive">
                <ExternalLink className="size-3" aria-hidden="true" /> Abrir en Drive
              </a>
            )}
          </div>

          {info.canLink && oePending && info.status === "ok" && (
            <div className="flex flex-wrap items-center gap-2 rounded-md bg-sky-500/10 px-2 py-1.5 text-xs text-[var(--os-text)]" data-testid="work-formula-oe-pending">
              <span>La OE {info.oe!.number} todavía no tiene la fórmula cargada.</span>
              <Button type="button" size="sm" onClick={() => void retryOe()} disabled={busy !== null} data-testid="work-formula-retry">
                {busy === "retry" ? "Cargando…" : "Cargar fórmula en la OE"}
              </Button>
            </div>
          )}

          {doc && (
            <p className="flex items-center gap-1.5 text-xs text-[var(--os-text-muted)]" data-testid="work-formula-doc">
              <FileSpreadsheet className="size-3.5 shrink-0" aria-hidden="true" />
              <span className="truncate font-medium text-[var(--os-text)]" data-testid="work-formula-doc-name">{doc.fileName}</span>
              {doc.clientFolder && <span className="shrink-0">· {doc.clientFolder}</span>}
              <span className="shrink-0">· {doc.via === "oe" ? "usada en la OE" : doc.via === "link" ? "vinculada por Producción" : "encontrada"}</span>
            </p>
          )}

          {showWarning && (
            <p role="status" className="flex items-start gap-1.5 rounded-md bg-amber-500/10 px-2 py-1.5 text-xs text-amber-200" data-testid="work-formula-status">
              <AlertTriangle className="mt-0.5 size-3.5 shrink-0" aria-hidden="true" />
              <span>
                {info.canLink ? info.message : `Producción todavía no definió la fórmula de este trabajo. ${info.message ?? ""}`}
              </span>
            </p>
          )}

          {info.canLink && (
            <div className="space-y-2 border-t border-[var(--os-border)] pt-2">
              <div className="flex flex-wrap items-center gap-2 text-[11px] text-[var(--os-text-muted)]">
                <span data-testid="work-formula-index">
                  Índice de Drive: {info.index.validated ? `${info.index.files} archivos · ${info.index.clients} clientes · ${fmtDate(info.index.lastSyncAt)}` : "sin indexar"}
                </span>
                <button type="button" onClick={() => void sync()} disabled={busy !== null} className="inline-flex items-center gap-1 text-[var(--os-teal)] hover:underline disabled:opacity-50" data-testid="work-formula-sync">
                  <RefreshCw className={`size-3 ${busy === "sync" ? "animate-spin" : ""}`} aria-hidden="true" /> Actualizar índice
                </button>
                {info.link && (
                  <button type="button" onClick={() => void unlink()} disabled={busy !== null} className="text-[var(--os-text-muted)] hover:underline" data-testid="work-formula-unlink">
                    Desvincular
                  </button>
                )}
                {canChoose && !openChooser && (
                  <button type="button" onClick={() => setChoosing(true)} className="text-[var(--os-teal)] hover:underline" data-testid="work-formula-change">
                    Elegir otro archivo
                  </button>
                )}
              </div>

              {openChooser && candidates.length > 0 && (
                <fieldset className="space-y-1.5" data-testid="work-formula-candidates">
                  <legend className="mb-1 text-xs text-[var(--os-text-muted)]">Elegí el archivo correcto para «{info.work.product}» ({info.work.client}):</legend>
                  {candidates.map((c) => (
                    <label
                      key={c.fileId}
                      className={`flex cursor-pointer items-start gap-2 rounded-md border px-2 py-1.5 text-xs ${selected === c.fileId ? "border-[var(--os-teal)] bg-[var(--os-teal)]/10" : "border-[var(--os-border)]"}`}
                      data-testid="work-formula-candidate"
                      data-file-name={c.fileName}
                    >
                      <input type="radio" name={`formula-${info.work.id}`} checked={selected === c.fileId} onChange={() => setSelected(c.fileId)} className="mt-0.5 size-3.5 accent-[var(--os-teal)]" />
                      <span className="min-w-0 flex-1">
                        <span className="block truncate font-medium text-[var(--os-text)]">{c.fileName}</span>
                        <span className="text-[var(--os-text-muted)]">
                          {c.clientFolder}
                          {c.subPath ? ` / ${c.subPath}` : ""} · {REASON_LABEL[c.reason] ?? c.reason} · modificado {fmtDate(c.modifiedTime)}
                        </span>
                        {c.flags.length > 0 && (
                          <span className="mt-0.5 flex flex-wrap gap-1">
                            {c.flags.map((f) => (
                              <span key={f} className={`rounded px-1 py-px text-[10px] ${f === "otro_cliente" ? "bg-red-500/15 text-red-300" : "bg-amber-500/15 text-amber-200"}`} data-testid="work-formula-flag">
                                {f === "otro_cliente" && c.otherClient ? `parece de ${c.otherClient}` : FLAG_LABEL[f] ?? f}
                              </span>
                            ))}
                          </span>
                        )}
                      </span>
                    </label>
                  ))}
                  <div className="flex gap-2">
                    <Button type="button" size="sm" onClick={() => void link()} disabled={!selected || busy !== null} data-testid="work-formula-link-confirm">
                      {busy === "link" ? "Vinculando…" : "Vincular este archivo"}
                    </Button>
                    {choosing && (
                      <Button type="button" size="sm" variant="secondary" onClick={() => { setChoosing(false); setSelected(null); }}>
                        Cancelar
                      </Button>
                    )}
                  </div>
                </fieldset>
              )}
            </div>
          )}
          {notice && <p role="status" className="text-xs text-[var(--os-text)]" data-testid="work-formula-notice">{notice}</p>}
        </>
      )}

      {info?.oe && (
        <Drawer open={oeOpen} onOpenChange={setOeOpen}>
          <DrawerContent widthClassName="sm:max-w-5xl" aria-describedby={undefined}>
            <DrawerHeader>
              <DrawerTitle>OE {info.oe.number}</DrawerTitle>
              <DrawerCloseButton />
            </DrawerHeader>
            <DrawerBody data-testid="work-formula-oe-viewer">
              {oeOpen && (
                <OperationalOrderEditor
                  orderId={info.oe.id}
                  onClose={() => {
                    setOeOpen(false);
                    void load();
                  }}
                />
              )}
            </DrawerBody>
          </DrawerContent>
        </Drawer>
      )}
    </section>
  );
}
