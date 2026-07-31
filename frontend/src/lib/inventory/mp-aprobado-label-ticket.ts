import { createHmac, timingSafeEqual } from "node:crypto";
import {
  mapMpIngresoToLabelData,
  mpAprobadoLabelFilename,
  type MpAprobadoLabelData,
  type MpAprobadoLabelSource,
} from "@/lib/inventory/mp-aprobado-label";

/** TTL del ticket de descarga nativa (Safari iOS). */
export const MP_LABEL_TICKET_TTL_MS = 90_000;

export type MpLabelDownloadTicketPayload = {
  v: 1;
  exp: number;
  email: string;
  sector: string;
  data: MpAprobadoLabelData;
  filename: string;
};

/**
 * Secreto de firma: reutiliza vars ya presentes en Preview.
 * No inventa un esquema de auth nuevo ni expone el valor al cliente.
 */
export function resolveMpLabelTicketSecret(): string {
  const candidates = [
    process.env.MP_LABEL_DOWNLOAD_SECRET,
    process.env.BLOB_READ_WRITE_TOKEN,
    process.env.POSTGRES_URL,
    process.env.DATABASE_URL,
  ];
  for (const c of candidates) {
    const t = c?.trim();
    if (t) return t;
  }
  return "genus-os-mp-label-ticket-v1";
}

function b64url(buf: Buffer | string): string {
  const b = Buffer.isBuffer(buf) ? buf : Buffer.from(buf, "utf8");
  return b
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/g, "");
}

function fromB64url(s: string): Buffer {
  const pad = s.length % 4 === 0 ? "" : "=".repeat(4 - (s.length % 4));
  const b64 = s.replace(/-/g, "+").replace(/_/g, "/") + pad;
  return Buffer.from(b64, "base64");
}

function signBody(body: string, secret: string): string {
  return b64url(createHmac("sha256", secret).update(body).digest());
}

export function issueMpLabelDownloadTicket(input: {
  email: string;
  sector: string;
  source: MpAprobadoLabelSource;
  filename?: string;
  nowMs?: number;
  ttlMs?: number;
}): { token: string; expiresAt: number; filename: string; data: MpAprobadoLabelData } {
  const now = input.nowMs ?? Date.now();
  const ttl = input.ttlMs ?? MP_LABEL_TICKET_TTL_MS;
  const data = mapMpIngresoToLabelData(input.source);
  const filename =
    (input.filename && input.filename.trim()) || mpAprobadoLabelFilename(data);
  const payload: MpLabelDownloadTicketPayload = {
    v: 1,
    exp: now + ttl,
    email: input.email.trim().toLowerCase(),
    sector: input.sector.trim().toUpperCase(),
    data,
    filename,
  };
  const body = b64url(JSON.stringify(payload));
  const sig = signBody(body, resolveMpLabelTicketSecret());
  return { token: `${body}.${sig}`, expiresAt: payload.exp, filename, data };
}

export function verifyMpLabelDownloadTicket(
  token: string,
  opts?: { nowMs?: number }
): MpLabelDownloadTicketPayload {
  const raw = token.trim();
  const dot = raw.lastIndexOf(".");
  if (dot <= 0 || dot === raw.length - 1) {
    throw new Error("Ticket inválido.");
  }
  const body = raw.slice(0, dot);
  const sig = raw.slice(dot + 1);
  const expected = signBody(body, resolveMpLabelTicketSecret());
  const a = Buffer.from(sig);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !timingSafeEqual(a, b)) {
    throw new Error("Ticket no firmado o alterado.");
  }
  let payload: MpLabelDownloadTicketPayload;
  try {
    payload = JSON.parse(fromB64url(body).toString("utf8")) as MpLabelDownloadTicketPayload;
  } catch {
    throw new Error("Ticket corrupto.");
  }
  if (payload.v !== 1 || typeof payload.exp !== "number" || !payload.data) {
    throw new Error("Ticket con formato inválido.");
  }
  const now = opts?.nowMs ?? Date.now();
  if (now > payload.exp) {
    throw new Error("Ticket expirado.");
  }
  return payload;
}

/** URL relativa same-origin para descarga nativa Safari. */
export function mpLabelTicketDownloadPath(token: string): string {
  return `/api/v1/mp-labels/aprobado/download?t=${encodeURIComponent(token)}`;
}
