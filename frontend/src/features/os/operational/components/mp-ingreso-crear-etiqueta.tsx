"use client";

import { useEffect, useState } from "react";
import { Download, Tag, ExternalLink, Share, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { MpIngresoRow } from "@/lib/inventory/types";
import {
  HERELABEL_IMPORT_INSTRUCTION,
  buildMpAprobadoLabelFromIngreso,
  type MpAprobadoLabelData,
  type MpAprobadoLabelSource,
} from "@/lib/inventory/mp-aprobado-label";
import {
  fetchMpAprobadoLabelPdfFile,
  isIosDevice,
  openHereLabelOfficialPage,
  saveOrDownloadMpAprobadoLabel,
  type MpLabelPreparedFile,
} from "@/lib/inventory/mp-aprobado-label-download";
import { MpAprobadoLabelPreview } from "@/features/os/operational/components/mp-aprobado-label-preview";

type Props = {
  row: MpAprobadoLabelSource | MpIngresoRow;
  onError?: (message: string) => void;
  onToast?: (message: string) => void;
  compactOnMobile?: boolean;
};

/**
 * Vista previa + guardar/descargar etiqueta.
 * iOS: prefetch File + navigator.share (Genus OS permanece).
 * Desktop: Blob + <a download>.
 * No muta ingreso ni stock.
 */
export function MpIngresoCrearEtiquetaButton({
  row,
  onError,
  onToast,
  compactOnMobile = true,
}: Props) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [acting, setActing] = useState(false);
  const [filename, setFilename] = useState("ETIQUETA-MP.pdf");
  const [labelData, setLabelData] = useState<MpAprobadoLabelData | null>(null);
  const [prepared, setPrepared] = useState<MpLabelPreparedFile | null>(null);
  const [preparing, setPreparing] = useState(false);
  const [prepareError, setPrepareError] = useState(false);
  const [ios] = useState(() => isIosDevice());

  useEffect(() => {
    if (!open || !labelData) return;
    let cancelled = false;
    setPreparing(true);
    setPrepareError(false);
    setPrepared(null);
    void fetchMpAprobadoLabelPdfFile(labelData)
      .then((file) => {
        if (!cancelled) {
          setPrepared(file);
          setFilename(file.filename);
          setPreparing(false);
        }
      })
      .catch(() => {
        if (!cancelled) {
          setPrepared(null);
          setPreparing(false);
          setPrepareError(true);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [open, labelData]);

  function createLabel() {
    setBusy(true);
    try {
      const { data, filename: name } = buildMpAprobadoLabelFromIngreso(row);
      setLabelData(data);
      setFilename(name);
      setPrepared(null);
      setPrepareError(false);
      setOpen(true);
    } catch {
      onError?.("No se pudo generar la etiqueta. Reintentá.");
    } finally {
      setBusy(false);
    }
  }

  async function handleSaveOrDownload() {
    if (!labelData || acting || preparing || !prepared) return;
    setActing(true);
    try {
      const result = await saveOrDownloadMpAprobadoLabel(labelData, prepared);
      onToast?.(result.toast);
    } catch (err) {
      if (err instanceof DOMException && err.name === "AbortError") {
        // Usuario canceló la hoja nativa — permanece en el modal.
        return;
      }
      onError?.(
        ios
          ? "No se pudo abrir la hoja para guardar la etiqueta."
          : "No se pudo iniciar la descarga de la etiqueta."
      );
    } finally {
      setActing(false);
    }
  }

  function handleOpenHereLabel() {
    onToast?.(HERELABEL_IMPORT_INSTRUCTION);
    openHereLabelOfficialPage();
  }

  function close() {
    if (acting) return;
    setOpen(false);
    setPrepared(null);
    setPreparing(false);
    setPrepareError(false);
  }

  const primaryDisabled = acting || preparing || !prepared || prepareError;
  const primaryLabel = preparing
    ? "Preparando etiqueta…"
    : acting
      ? ios
        ? "Abriendo…"
        : "Descargando…"
      : ios
        ? "Guardar etiqueta"
        : "Descargar etiqueta";

  return (
    <>
      <Button
        type="button"
        size="sm"
        variant="secondary"
        data-testid="mp-ingreso-crear-etiqueta"
        title="Crear etiqueta"
        aria-label="Crear etiqueta"
        disabled={busy}
        onClick={(e) => {
          e.stopPropagation();
          createLabel();
        }}
        className="shrink-0"
      >
        <Tag className={`size-3.5 ${compactOnMobile ? "sm:mr-1.5" : "mr-1.5"}`} aria-hidden />
        <span className={compactOnMobile ? "hidden sm:inline" : undefined}>
          {busy ? "Generando…" : "Crear etiqueta"}
        </span>
      </Button>

      {open && labelData ? (
        <div
          className="fixed inset-0 z-[80] flex items-end justify-center bg-black/55 p-3 sm:items-center"
          role="dialog"
          aria-modal="true"
          aria-label="Vista previa etiqueta APROBADO MATERIA PRIMA"
          onClick={close}
        >
          <div
            className="flex max-h-[92vh] w-full max-w-lg flex-col overflow-hidden rounded-lg border border-[var(--os-border)] bg-[var(--os-surface)] shadow-xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between gap-2 border-b border-[var(--os-border)] px-3 py-2">
              <div className="min-w-0">
                <p className="truncate text-sm font-semibold text-[var(--os-text)]">
                  Vista previa — APROBADO MATERIA PRIMA
                </p>
                <p className="truncate font-mono text-[11px] text-[var(--os-muted)]">
                  {filename}
                </p>
              </div>
              <button
                type="button"
                className="rounded p-1 text-[var(--os-muted)] hover:bg-[var(--os-bg)]"
                aria-label="Cerrar"
                onClick={close}
                disabled={acting}
              >
                <X className="size-4" />
              </button>
            </div>

            <div className="min-h-0 flex-1 overflow-y-auto bg-neutral-200 p-3">
              <MpAprobadoLabelPreview data={labelData} />
              <p className="mt-3 text-center text-[12px] leading-snug text-[var(--os-muted)]">
                {ios
                  ? "En iPhone: Guardar etiqueta → Guardar en Archivos. Genus OS permanece abierto."
                  : HERELABEL_IMPORT_INSTRUCTION}
              </p>
              {prepareError ? (
                <p className="mt-2 text-center text-[12px] text-red-600">
                  No se pudo preparar el PDF. Cerrá y volvé a intentar.
                </p>
              ) : null}
            </div>

            <div className="flex flex-col gap-2 border-t border-[var(--os-border)] p-3 sm:flex-row sm:flex-wrap">
              <Button
                type="button"
                size="sm"
                onClick={() => void handleSaveOrDownload()}
                data-testid="mp-label-download"
                disabled={primaryDisabled}
                className="w-full sm:w-auto"
              >
                {ios ? (
                  <Share className="mr-1.5 size-3.5" aria-hidden />
                ) : (
                  <Download className="mr-1.5 size-3.5" aria-hidden />
                )}
                {primaryLabel}
              </Button>
              <Button
                type="button"
                size="sm"
                variant="secondary"
                onClick={handleOpenHereLabel}
                data-testid="mp-label-open-herelabel"
                className="w-full sm:w-auto"
              >
                <ExternalLink className="mr-1.5 size-3.5" aria-hidden />
                Abrir HereLabel para importar
              </Button>
            </div>
          </div>
        </div>
      ) : null}
    </>
  );
}
