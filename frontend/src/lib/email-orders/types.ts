/** Tipos y reglas PURAS de la importación de pedidos desde email (sin I/O). */
import { normalizeFecha } from "@/lib/production-pedidos/types";

export const DRAFT_STATUSES = ["PENDIENTE", "APROBANDO", "APROBADO", "DESCARTADO", "REVISADO"] as const;
export type DraftStatus = (typeof DRAFT_STATUSES)[number];
export type MailKind = "pedido_nuevo" | "modificacion" | "consulta" | "no_relacionado";
export type DraftKind = "NUEVO" | "MODIFICACION";

export type DraftItem = {
  id: string;
  /** Se incluye al aprobar (Producción puede destildar un renglón). */
  include: boolean;
  producto: string;
  codigo: string;
  cantidad: number | null;
  unidad: string;
  presentacion: string;
  /** Volumen/peso por unidad para el cálculo de KG del pedido (solo si se leyó con claridad en ml/cc/l). */
  ml: number | null;
  observaciones: string;
  productSuggestions: string[];
  productMatched: boolean;
  doubts: string[];
  /** Pedido creado a partir de este renglón (idempotencia de la aprobación). */
  createdPedidoId?: string;
};

export type DraftPayload = {
  cliente: string;
  clienteMatched: boolean;
  clienteSuggestions: string[];
  /** N.º de pedido / orden de compra del cliente (va a «N° OC»). Nunca se inventa. */
  nroPedido: string;
  fechaSolicitud: string;
  fechaEntrega: string;
  observaciones: string;
  summary: string;
  items: DraftItem[];
  doubts: string[];
};

export type RawExtraction = {
  kind: MailKind;
  confidence: "alta" | "media" | "baja";
  summary: string;
  cliente: string;
  nroPedido: string;
  fechaSolicitud: string;
  fechaEntrega: string;
  observaciones: string;
  items: Array<{ producto: string; codigo: string; cantidad: number | null; unidad: string; presentacion: string; observaciones: string; unclear: string[] }>;
  unclear: string[];
};

const str = (v: unknown, max = 300) => (typeof v === "string" ? v.replace(/\s+/g, " ").trim().slice(0, max) : typeof v === "number" && Number.isFinite(v) ? String(v) : "");
const KINDS: MailKind[] = ["pedido_nuevo", "modificacion", "consulta", "no_relacionado"];
export const MAX_ITEMS = 50;
const MAX_QTY = 100_000_000;

/** Valida lo que devolvió la IA: nunca se confía en ella. Todo lo que no cumple queda vacío (no se inventa). null = respuesta inservible. */
export function sanitizeEmailExtraction(raw: unknown): RawExtraction | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const r = raw as Record<string, unknown>;
  const kind = KINDS.includes(r.kind as MailKind) ? (r.kind as MailKind) : null;
  if (!kind) return null;
  const conf = r.confidence === "alta" || r.confidence === "media" || r.confidence === "baja" ? r.confidence : "baja";
  const date = (v: unknown) => normalizeFecha(str(v, 20)) ?? "";
  const items = (Array.isArray(r.items) ? r.items : []).slice(0, MAX_ITEMS).flatMap((x) => {
    if (!x || typeof x !== "object") return [];
    const o = x as Record<string, unknown>;
    const q = typeof o.cantidad === "number" ? o.cantidad : Number(String(o.cantidad ?? "").replace(/\./g, "").replace(",", "."));
    const cantidad = Number.isFinite(q) && q > 0 && q <= MAX_QTY ? q : null;
    const producto = str(o.producto, 200);
    const codigo = str(o.codigo, 60);
    if (!producto && !codigo && cantidad == null) return [];
    return [{
      producto, codigo, cantidad, unidad: str(o.unidad, 20), presentacion: str(o.presentacion, 80), observaciones: str(o.observaciones, 300),
      unclear: (Array.isArray(o.unclearFields) ? o.unclearFields : []).map((u) => str(u, 30)).filter(Boolean).slice(0, 10),
    }];
  });
  return {
    kind, confidence: conf, summary: str(r.summary, 300), cliente: str(r.cliente, 160), nroPedido: str(r.nroPedido, 60),
    fechaSolicitud: date(r.fechaSolicitud), fechaEntrega: date(r.fechaEntrega), observaciones: str(r.observaciones, 500), items,
    unclear: (Array.isArray(r.unclearFields) ? r.unclearFields : []).map((u) => str(u, 30)).filter(Boolean).slice(0, 12),
  };
}

/** «250 ml», «1,5 L», «30 cc» → ml. Gramos/kg NO se convierten (no se asume densidad). */
export function parseMl(presentacion: string): number | null {
  const m = /(\d+(?:[.,]\d+)?)\s*(ml|cc|cm3|l|lt|lts|litros?)\b/i.exec(presentacion);
  if (!m) return null;
  const n = Number(m[1]!.replace(",", "."));
  if (!Number.isFinite(n) || n <= 0) return null;
  return /^(l|lt|lts|litros?)$/i.test(m[2]!) ? n * 1000 : n;
}

/** Validación para APROBAR: devuelve los problemas que impiden crear pedidos. */
export function validateForApproval(p: DraftPayload): string[] {
  const errs: string[] = [];
  if (!p.cliente.trim()) errs.push("Falta el cliente.");
  const inc = p.items.filter((i) => i.include && !i.createdPedidoId);
  if (!p.items.some((i) => i.include)) errs.push("No hay productos incluidos.");
  inc.forEach((i, n) => {
    if (!i.producto.trim()) errs.push(`Producto ${n + 1}: falta el producto.`);
    if (!(i.cantidad != null && i.cantidad > 0)) errs.push(`Producto ${n + 1}: falta una cantidad válida.`);
  });
  if (p.fechaSolicitud && !normalizeFecha(p.fechaSolicitud)) errs.push("La fecha de solicitud no es válida.");
  return errs;
}

/** Valida/normaliza un borrador editado por una persona (el servidor nunca confía en el cuerpo del pedido). */
export function sanitizeDraftPayload(raw: unknown, fallback: DraftPayload): DraftPayload {
  const o = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  const rawItems = Array.isArray(o.items) ? o.items.slice(0, MAX_ITEMS) : fallback.items;
  const prev = new Map(fallback.items.map((i) => [i.id, i]));
  const items = rawItems.map((x, n): DraftItem => {
    const it = (x && typeof x === "object" ? x : {}) as Record<string, unknown>;
    const id = str(it.id, 40) || `i${n}`;
    const before = prev.get(id);
    const q = typeof it.cantidad === "number" ? it.cantidad : Number(String(it.cantidad ?? "").replace(",", "."));
    const presentacion = str(it.presentacion, 80);
    const mlRaw = it.ml == null || it.ml === "" ? parseMl(presentacion) : Number(String(it.ml).replace(",", "."));
    return {
      id, include: it.include !== false, producto: str(it.producto, 200), codigo: str(it.codigo, 60),
      cantidad: Number.isFinite(q) && q > 0 && q <= MAX_QTY ? q : null, unidad: str(it.unidad, 20), presentacion,
      ml: mlRaw != null && Number.isFinite(mlRaw) && mlRaw > 0 ? mlRaw : null, observaciones: str(it.observaciones, 300),
      productSuggestions: before?.productSuggestions ?? [], productMatched: before?.productMatched ?? false, doubts: before?.doubts ?? [],
      createdPedidoId: before?.createdPedidoId, // lo que ya se creó no lo decide el navegador
    };
  });
  return {
    cliente: str(o.cliente, 160), clienteMatched: fallback.clienteMatched && str(o.cliente, 160) === fallback.cliente, clienteSuggestions: fallback.clienteSuggestions,
    nroPedido: str(o.nroPedido, 60), fechaSolicitud: normalizeFecha(str(o.fechaSolicitud, 20)) ?? "", fechaEntrega: normalizeFecha(str(o.fechaEntrega, 20)) ?? "",
    observaciones: str(o.observaciones, 500), summary: fallback.summary, items, doubts: fallback.doubts,
  };
}
