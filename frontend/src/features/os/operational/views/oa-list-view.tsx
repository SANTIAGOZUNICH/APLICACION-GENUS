"use client";

import type { SectorId } from "@/types/operational/sector";
import { NativeOrdersListView } from "./native-orders-list-view";

interface OaListViewProps {
  /** Si se omite (Calidad/Producción), se listan todas las OA. */
  sectorId?: Extract<SectorId, "ENVASADO_MASIVO" | "ENVASADO_PREMIUM">;
  readOnly?: boolean;
  title?: string;
  /** true cuando se embebe dentro de otra pantalla que ya provee el TwinShell (ej. Producción). */
  embedded?: boolean;
}

/** Listado OA nativo — Masivo/Premium ven/editan solo sus órdenes asignadas. */
export function OaListView({
  sectorId,
  readOnly = false,
  title,
  embedded = false,
}: OaListViewProps) {
  return (
    <NativeOrdersListView
      type="OA"
      oaSector={sectorId}
      readOnly={readOnly}
      embedded={embedded}
      title={title ?? "Órdenes de Acondicionamiento"}
    />
  );
}
