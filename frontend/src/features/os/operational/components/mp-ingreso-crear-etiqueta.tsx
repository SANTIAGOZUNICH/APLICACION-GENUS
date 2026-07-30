"use client";

import { useEffect, useState } from "react";
import { Download, Share2, Tag, ExternalLink, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { MpIngresoRow } from "@/lib/inventory/types";
import type {
  MpAprobadoLabelData,
  MpAprobadoLabelSource,
} from "@/lib/inventory/mp-aprobado-label";
import {
  buildMpAprobadoLabelFromIngreso,
  buildMpAprobadoLabelPdfBlob,
  downloadMpAprobadoLabelPdf,
  shareOrOpenMpAprobadoLabelPdf,
} from "@/lib/inventory/mp-aprobado-label-pdf";
import { MpAprobadoLabelPreview } from "@/features/os/operational/components/mp-aprobado-label-preview";

type Props = {
  row: MpAprobadoLabelSource | MpIngresoRow;
  onError?: (message: string) => void;
  onToast?: (message: string) => void;
  compactOnMobile?: boolean;
};

/**
 * Crea la etiqueta PDF APROBADO MATERIA PRIMA y abre vista previa.
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
  const [blobUrl, setBlobUrl] = useState<string | null>(null);
  const [filename, setFilename] = useState("ETIQUETA-MP.pdf");
  const [blob, setBlob] = useState<Blob | null>(null);
  const [labelData, setLabelData] = useState<MpAprobadoLabelData | null>(null);

  useEffect(() => {
    return () => {
      if (blobUrl) URL.revokeObjectURL(blobUrl);
    };
  }, [blobUrl]);

  async function createLabel() {
    setBusy(true);
    try {
      const { data, filename: name } = buildMpAprobadoLabelFromIngreso(row);
      const pdfBlob = await buildMpAprobadoLabelPdfBlob(data);
      if (blobUrl) URL.revokeObjectURL(blobUrl);
      const url = URL.createObjectURL(pdfBlob);
      setLabelData(data);
      setBlob(pdfBlob);
      setBlobUrl(url);
      setFilename(name);
      setOpen(true);
    } catch {
      onError?.("No se pudo generar la etiqueta. Reintentá.");
    } finally {
      setBusy(false);
    }
  }

  async function handleShare(mode: "herelabel" | "share") {
    if (!blob) return;
    try {
      const result = await shareOrOpenMpAprobadoLabelPdf(blob, filename);
      if (mode === "herelabel") {
        onToast?.(
          result === "shared"
            ? "Elegí HereLabel en la hoja de compartir"
            : "Etiqueta abierta — usá Compartir hacia HereLabel si hace falta"
        );
      } else {
        onToast?.(result === "shared" ? "Compartido" : "Etiqueta abierta");
      }
    } catch {
      onError?.("No se pudo compartir la etiqueta.");
    }
  }

  async function handleDownload() {
    if (!blob) return;
    try {
      await downloadMpAprobadoLabelPdf(blob, filename);
      onToast?.("Etiqueta descargada");
    } catch {
      onError?.("No se pudo descargar la etiqueta.");
    }
  }

  function close() {
    setOpen(false);
  }

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
          void createLabel();
        }}
        className="shrink-0"
      >
        <Tag className={`size-3.5 ${compactOnMobile ? "sm:mr-1.5" : "mr-1.5"}`} aria-hidden />
        <span className={compactOnMobile ? "hidden sm:inline" : undefined}>
          {busy ? "Generando…" : "Crear etiqueta"}
        </span>
      </Button>

      {open && blobUrl && labelData ? (
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
              >
                <X className="size-4" />
              </button>
            </div>

            <div className="min-h-0 flex-1 overflow-y-auto bg-neutral-200 p-3">
              <MpAprobadoLabelPreview data={labelData} />
            </div>

            <div className="flex flex-wrap gap-2 border-t border-[var(--os-border)] p-3">
              <Button
                type="button"
                size="sm"
                onClick={() => void handleShare("herelabel")}
                data-testid="mp-label-open-herelabel"
              >
                <ExternalLink className="mr-1.5 size-3.5" aria-hidden />
                Abrir en HereLabel
              </Button>
              <Button
                type="button"
                size="sm"
                variant="secondary"
                onClick={() => void handleShare("share")}
                data-testid="mp-label-share"
              >
                <Share2 className="mr-1.5 size-3.5" aria-hidden />
                Compartir
              </Button>
              <Button
                type="button"
                size="sm"
                variant="secondary"
                onClick={() => void handleDownload()}
                data-testid="mp-label-download"
              >
                <Download className="mr-1.5 size-3.5" aria-hidden />
                Descargar etiqueta
              </Button>
            </div>
          </div>
        </div>
      ) : null}
    </>
  );
}
