"use client";

import { NativeOrdersListView } from "./native-orders-list-view";

interface OeListViewProps {
  readOnly?: boolean;
  /** true cuando se embebe dentro de otra pantalla que ya provee el TwinShell (ej. Producción). */
  embedded?: boolean;
}

/** Listado OE nativo — crear/completar/entregar en Genus OS + documentos históricos. */
export function OeListView({ readOnly = false, embedded = false }: OeListViewProps = {}) {
  return (
    <NativeOrdersListView
      type="OE"
      readOnly={readOnly}
      embedded={embedded}
      title="Órdenes de Elaboración"
    />
  );
}
