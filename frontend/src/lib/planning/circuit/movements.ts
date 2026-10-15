/**
 * Movimientos del circuito operativo (sin Calidad) y su notificación a Producción — parte PURA (sin I/O).
 * El armado del texto, el enlace y el id determinístico se testean sin base; la inserción vive en
 * circuit-notifications.ts (server-only).
 */
import { createHash } from "node:crypto";

export type CircuitMovementType =
  | "ELABORACION_A_ENVASADO"
  | "ENVASADO_A_CODIFICADO"
  | "ENVASADO_ENTREGA"
  | "CODIFICADO_ENTREGA"
  | "PRODUCCION_ENTREGA"
  | "CODIFICADO_REENVIO"
  | "PENDIENTE_REUBICADO";

export interface CircuitMovement {
  type: CircuitMovementType;
  /** uuid crudo del work item (sin prefijo native:). */
  workItemId: string;
  /** Clave del evento real (idempotencyKey de la acción): entra al id determinístico. */
  eventKey: string;
  fromSector: string;
  /** Destino cuando es una transferencia interna; null para entrega final al cliente. */
  toSector?: string | null;
  client: string | null;
  product: string | null;
  quantity?: string | number | null;
  unit?: string | null;
  lote?: string | null;
  at: Date;
  actorName: string;
  actorEmail?: string | null;
  /** Entregas parciales: acumulado y saldo. */
  delivered?: number | null;
  pending?: number | null;
  complete?: boolean | null;
}

export const CIRCUIT_NOTIFICATION_KIND = "circuito_movimiento";
/** Producción es la destinataria; Dirección supervisa el mismo circuito (mismo criterio de permisos que Producción). */
export const CIRCUIT_NOTIFICATION_SECTORS = ["PRODUCCION", "DIRECCION"] as const;

const SECTOR_LABEL: Record<string, string> = {
  ELABORACION: "Elaboración",
  ENVASADO_MASIVO: "Envasado Masivo",
  ENVASADO_PREMIUM: "Envasado Premium",
  CODIFICADO: "Codificado",
  PRODUCCION: "Producción",
  DIRECCION: "Dirección",
};

export function circuitSectorLabel(sector: string | null | undefined): string {
  return SECTOR_LABEL[String(sector ?? "").toUpperCase()] ?? String(sector ?? "—");
}

const MOVEMENT_LABEL: Record<CircuitMovementType, string> = {
  ELABORACION_A_ENVASADO: "Envío a Envasado",
  ENVASADO_A_CODIFICADO: "Envío a Codificado",
  ENVASADO_ENTREGA: "Entrega final desde Envasado",
  CODIFICADO_ENTREGA: "Entrega final desde Codificado",
  PRODUCCION_ENTREGA: "Entrega final registrada por Producción",
  CODIFICADO_REENVIO: "Reenvío a Codificado",
  PENDIENTE_REUBICADO: "Trabajo pendiente reubicado",
};

export function circuitMovementLabel(type: CircuitMovementType): string {
  return MOVEMENT_LABEL[type];
}

/** uuid v5-like determinístico a partir de una clave (sha256) — mismo patrón que approval-envasado-notify. */
export function uuidFromKey(key: string): string {
  const hex = createHash("sha256").update(key).digest("hex");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-5${hex.slice(13, 16)}-${((Number.parseInt(hex[16], 16) & 0x3) | 0x8).toString(16)}${hex.slice(17, 20)}-${hex.slice(20, 32)}`;
}

export function deterministicCircuitNotificationId(
  type: CircuitMovementType,
  workItemId: string,
  eventKey: string
): string {
  return uuidFromKey(`circuito:${type}:${workItemId}:${eventKey}`);
}

export function formatCircuitDateTime(at: Date): string {
  try {
    return new Intl.DateTimeFormat("es-AR", {
      timeZone: "America/Argentina/Buenos_Aires",
      day: "2-digit",
      month: "2-digit",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
    }).format(at);
  } catch {
    return at.toISOString();
  }
}

function qtyText(m: CircuitMovement): string | null {
  if (m.quantity == null || String(m.quantity).trim() === "") return null;
  return `${String(m.quantity).trim()}${m.unit ? ` ${m.unit}` : ""}`;
}

export interface CircuitNotificationDraft {
  id: string;
  kind: typeof CIRCUIT_NOTIFICATION_KIND;
  title: string;
  message: string;
  sectors: string[];
  href: string;
}

export function buildCircuitNotification(m: CircuitMovement): CircuitNotificationDraft {
  const from = circuitSectorLabel(m.fromSector);
  const to = m.toSector ? circuitSectorLabel(m.toSector) : null;
  const delivering =
    m.type === "ENVASADO_ENTREGA" ||
    m.type === "CODIFICADO_ENTREGA" ||
    m.type === "PRODUCCION_ENTREGA";
  const partial = delivering && m.complete === false;
  const title = delivering
    ? partial
      ? `Entrega parcial — ${from}`
      : `Entrega final — ${from}`
    : to
      ? `${from} → ${to}`
      : circuitMovementLabel(m.type);
  const parts: string[] = [`Movimiento: ${circuitMovementLabel(m.type)}${partial ? " (parcial)" : ""}`];
  parts.push(`Origen: ${from}`);
  if (to) parts.push(`Destino: ${to}`);
  else if (delivering) parts.push("Destino: cliente");
  parts.push(`Cliente: ${m.client?.trim() || "—"}`);
  parts.push(`Producto: ${m.product?.trim() || "—"}`);
  const q = qtyText(m);
  if (q) parts.push(`Cantidad: ${q}`);
  if (partial && m.pending != null) parts.push(`Saldo pendiente: ${m.pending}`);
  if (m.lote?.trim()) parts.push(`Lote: ${m.lote.trim()}`);
  parts.push(`Fecha: ${formatCircuitDateTime(m.at)}`);
  parts.push(`Responsable: ${m.actorName || m.actorEmail || "—"}`);
  const short = createHash("sha256").update(`${m.type}:${m.eventKey}`).digest("hex").slice(0, 8);
  return {
    id: deterministicCircuitNotificationId(m.type, m.workItemId, m.eventKey),
    kind: CIRCUIT_NOTIFICATION_KIND,
    title,
    message: parts.join(" · "),
    sectors: [...CIRCUIT_NOTIFICATION_SECTORS],
    // El sufijo `mov` hace único el href por evento (los tombstones por usuario usan href: como clave).
    href: `/mi-trabajo?workItemId=${encodeURIComponent(`native:${m.workItemId}`)}&mov=${short}`,
  };
}
