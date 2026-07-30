"use client";

import { Copy } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { MpIngresoRow } from "@/lib/inventory/types";
import {
  copyTextToClipboard,
  formatMpIngresoForHereLabel,
  type MpIngresoHereLabelInput,
} from "@/lib/inventory/format-mp-ingreso-herelabel";

type Props = {
  row: MpIngresoHereLabelInput | MpIngresoRow;
  onCopied?: () => void;
  onError?: (message: string) => void;
  /** Desktop: texto; sm-: icono + tooltip */
  compactOnMobile?: boolean;
};

/**
 * Copia TSV HereLabel al portapapeles. No muta ingreso ni stock.
 */
export function MpIngresoHereLabelCopyButton({
  row,
  onCopied,
  onError,
  compactOnMobile = true,
}: Props) {
  async function handleCopy() {
    try {
      const tsv = formatMpIngresoForHereLabel(row);
      await copyTextToClipboard(tsv);
      onCopied?.();
    } catch {
      onError?.("No se pudo copiar. Reintentá o pegá manualmente.");
    }
  }

  return (
    <Button
      type="button"
      size="sm"
      variant="secondary"
      data-testid="mp-ingreso-copy-herelabel"
      title="Copiar para HereLabel"
      aria-label="Copiar para HereLabel"
      onClick={(e) => {
        e.stopPropagation();
        void handleCopy();
      }}
      className="shrink-0"
    >
      <Copy className={`size-3.5 ${compactOnMobile ? "sm:mr-1.5" : "mr-1.5"}`} aria-hidden />
      <span className={compactOnMobile ? "hidden sm:inline" : undefined}>
        Copiar para HereLabel
      </span>
    </Button>
  );
}
