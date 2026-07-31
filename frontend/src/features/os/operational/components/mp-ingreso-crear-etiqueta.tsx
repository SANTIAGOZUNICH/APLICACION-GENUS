"use client";

import { useState } from "react";
import { Download, Tag, ExternalLink, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { MpIngresoRow } from "@/lib/inventory/types";
import {
  HERELABEL_IMPORT_INSTRUCTION,
  type MpAprobadoLabelData,
  type MpAprobadoLabelSource,
} from "@/lib/inventory/mp-aprobado-label";
import { buildMpAprobadoLabelFromIngreso } from "@/lib/inventory/mp-aprobado-label-pdf";
import {
  downloadMpAprobadoLabelFromApi,
  openHereLabelOfficialPage,
} from "@/lib/inventory/mp-aprobado-label-download";
import { MpAprobadoLabelPreview } from "@/features/os/operational/components/mp-aprobado-label-preview";

type Props = {
  row: MpAprobadoLabelSource | MpIngresoRow;
  onError?: (message: string) => void;
  onToast?: (message: string) => void;
  compactOnMobile?: boolean;
};

/**
 * Crea la etiqueta PDF APROBADO MATERIA PRIMA y abre vista previa.
 * Descarga vía API (octet-stream) — no navega al PDF.
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
  const [downloading, setDownloading] = useState(false);
  const [filename, setFilename] = useState("ETIQUETA-MP.pdf");
  const [labelData, setLabelData] = useState<MpAprobadoLabelData | null>(null);

  function createLabel() {
    setBusy(true);
    try {
      const { data, filename: name } = buildMpAprobadoLabelFromIngreso(row);
      setLabelData(data);
      setFilename(name);
      setOpen(true);
    } catch {
      onError?.("No se pudo generar la etiqueta. Reintentá.");
    } finally {
      setBusy(false);
    }
  }

  async function handleDownload() {
    if (!labelData || downloading) return;
    setDownloading(true);
    try {
      await downloadMpAprobadoLabelFromApi(labelData);
      onToast?.("Etiqueta descargada");
    } catch {
      onError?.("No se pudo descargar la etiqueta.");
    } finally {
      setDownloading(false);
    }
  }

  function handleOpenHereLabel() {
    onToast?.(HERELABEL_IMPORT_INSTRUCTION);
    openHereLabelOfficialPage();
  }

  function close() {
    if (downloading) return;
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
                disabled={downloading}
              >
                <X className="size-4" />
              </button>
            </div>

            <div className="min-h-0 flex-1 overflow-y-auto bg-neutral-200 p-3">
              <MpAprobadoLabelPreview data={labelData} />
              <p className="mt-3 text-center text-[12px] leading-snug text-[var(--os-muted)]">
                {HERELABEL_IMPORT_INSTRUCTION}
              </p>
            </div>

            <div className="flex flex-col gap-2 border-t border-[var(--os-border)] p-3 sm:flex-row sm:flex-wrap">
              <Button
                type="button"
                size="sm"
                onClick={() => void handleDownload()}
                data-testid="mp-label-download"
                disabled={downloading}
                className="w-full sm:w-auto"
              >
                <Download className="mr-1.5 size-3.5" aria-hidden />
                {downloading ? "Descargando…" : "Descargar etiqueta"}
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
