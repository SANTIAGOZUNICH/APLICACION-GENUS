/** Aviso a Producción por una observación de entrega — parte PURA (sin I/O). El id es determinístico: un reintento/replay no duplica. */
import { createHash } from "node:crypto";
import { circuitSectorLabel, formatCircuitDateTime, uuidFromKey } from "@/lib/planning/circuit/movements";

export const OBSERVATION_NOTIFICATION_KIND = "observacion_entrega";
export const OBSERVATION_NOTIFICATION_SECTORS = ["PRODUCCION", "DIRECCION"] as const;
const MAX_TEXT = 400;

export type ObservationNotificationSource = "LINEA" | "TRANSFERENCIA" | "ENVIO_ENVASADO" | "ENVIO_CODIFICADO";

export interface ObservationNotificationInput {
  source: ObservationNotificationSource;
  /** Id de la línea / transferencia (o clave del envío): entra al id determinístico. */
  eventKey: string;
  workItemId: string;
  sector: string;
  actorName: string;
  observation: string;
  at: Date;
  client?: string | null;
  product?: string | null;
  pedido?: string | null;
  orderRef?: string | null;
  lote?: string | null;
  quantity?: number | string | null;
  unit?: string | null;
  tipo?: "PARCIAL" | "TOTAL" | null;
  /** Texto del destino (p. ej. «Codificado» o «Envasado»). */
  destination?: string | null;
}

export interface ObservationNotificationDraft {
  id: string;
  kind: typeof OBSERVATION_NOTIFICATION_KIND;
  title: string;
  message: string;
  sectors: string[];
  href: string;
}

export function deterministicObservationNotificationId(source: ObservationNotificationSource, eventKey: string): string {
  return uuidFromKey(`observacion:${source}:${eventKey}`);
}

/** null si la observación está vacía (no se avisa). */
export function buildObservationNotification(i: ObservationNotificationInput): ObservationNotificationDraft | null {
  const text = String(i.observation ?? "").replace(/\r\n/g, "\n").trim();
  if (!text) return null;
  const from = circuitSectorLabel(i.sector);
  const parts: string[] = [`Origen: ${from}`];
  if (i.destination) parts.push(`Destino: ${i.destination}`);
  parts.push(`Cliente: ${i.client?.trim() || "—"}`);
  parts.push(`Producto: ${i.product?.trim() || "—"}`);
  if (i.pedido?.trim()) parts.push(`Pedido: ${i.pedido.trim()}`);
  if (i.orderRef?.trim()) parts.push(`OE/OA: ${i.orderRef.trim()}`);
  if (i.lote?.trim()) parts.push(`Lote: ${i.lote.trim()}`);
  if (i.tipo) parts.push(`Entrega ${i.tipo === "PARCIAL" ? "parcial" : "total"}`);
  if (i.quantity != null && String(i.quantity).trim() !== "") parts.push(`Cantidad: ${String(i.quantity).trim()}${i.unit ? ` ${i.unit}` : ""}`);
  parts.push(`Fecha: ${formatCircuitDateTime(i.at)}`);
  parts.push(`Responsable: ${i.actorName || "—"}`);
  parts.push(`Observación: ${text.length > MAX_TEXT ? `${text.slice(0, MAX_TEXT - 1)}…` : text}`);
  const short = createHash("sha256").update(`obs:${i.source}:${i.eventKey}`).digest("hex").slice(0, 8);
  return {
    id: deterministicObservationNotificationId(i.source, i.eventKey),
    kind: OBSERVATION_NOTIFICATION_KIND,
    title: `Observación de ${from}`,
    message: parts.join(" · "),
    sectors: [...OBSERVATION_NOTIFICATION_SECTORS],
    // El sufijo `obs` hace único el href por evento (los tombstones por usuario usan href como clave).
    href: `/mi-trabajo?workItemId=${encodeURIComponent(`native:${i.workItemId}`)}&obs=${short}`,
  };
}
