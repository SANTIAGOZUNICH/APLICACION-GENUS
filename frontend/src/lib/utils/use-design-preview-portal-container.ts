"use client";

import { useState } from "react";

/**
 * Contenedor de portal para Dialog/Drawer/Tooltip/combobox dentro del Twin OS.
 * Sin esto, Radix Portal (y createPortal) montan en document.body — fuera del
 * scope de .design-preview-root — y las var(--os-*)/var(--genus-*) caen al
 * fallback global de Track A (claro), aunque el resto de la app sea oscura.
 * Fuera del Twin OS (Track A) devuelve undefined y Radix usa su default
 * (document.body), sin cambiar el comportamiento existente.
 */
export function useDesignPreviewPortalContainer(): HTMLElement | undefined {
  const [container] = useState<HTMLElement | undefined>(() =>
    typeof document === "undefined"
      ? undefined
      : (document.querySelector<HTMLElement>(".design-preview-root") ?? undefined)
  );
  return container;
}
