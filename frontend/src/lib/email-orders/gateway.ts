import "server-only";

/** Acceso de SOLO LECTURA a Gmail. Interfaz mínima para poder probar el servicio con un buzón simulado. Nunca borra, mueve ni responde. */
import { gmailWithRefreshToken } from "./gmail-oauth";
import { VERIFICATION_HEADERS } from "./recipient";

export type GmailAttachmentRef = { attachmentId: string; filename: string; mimeType: string; size: number };
export type GmailMessage = {
  id: string;
  threadId: string;
  from: string;
  subject: string;
  date: string | null;
  bodyText: string;
  /** Enlaces que figuran en el correo: se muestran, NUNCA se abren. */
  links: string[];
  attachments: GmailAttachmentRef[];
};
export type GmailHeaders = { id: string; threadId: string; date: string | null; headers: Array<{ name: string; value: string }> };
export interface GmailGateway {
  accountEmail(): Promise<string>;
  /** IDs de los correos candidatos (más recientes primero), hasta `scan`. NO decide nada: cada uno se verifica por encabezados. */
  listCandidates(opts: { scan: number; afterDate?: string; beforeDate?: string; label?: string }): Promise<Array<{ id: string; threadId: string }>>;
  /** Solo metadatos (encabezados de destinatario): sin asunto, cuerpo ni adjuntos. */
  getHeaders(id: string): Promise<GmailHeaders>;
  getMessage(id: string): Promise<GmailMessage>;
  getAttachment(messageId: string, attachmentId: string): Promise<Buffer>;
}

export const MAX_MESSAGES_PER_RUN = 10;
/** Cuántos correos recientes se revisan (solo encabezados) para encontrar hasta 10 dirigidos a pedidos@. */
export const MAX_SCAN_PER_RUN = 100;

const b64 = (s: string) => Buffer.from(s.replace(/-/g, "+").replace(/_/g, "/"), "base64");
export function htmlToText(html: string): string {
  return html
    .replace(/<(script|style)[\s\S]*?<\/\1>/gi, " ")
    .replace(/<br\s*\/?>|<\/(p|div|tr|li|h\d)>/gi, "\n")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ").replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&#39;/g, "'")
    .replace(/[ \t]+/g, " ").replace(/\n\s*\n+/g, "\n").trim();
}
export function extractLinks(text: string): string[] {
  return [...new Set((text.match(/https?:\/\/[^\s<>"')\]]+/gi) ?? []).map((u) => u.replace(/[.,;]+$/, "")))].slice(0, 10);
}

type Part = { mimeType?: string | null; filename?: string | null; body?: { data?: string | null; attachmentId?: string | null; size?: number | null } | null; parts?: Part[] | null };
/** Recorre el MIME: cuerpo (texto o HTML→texto) y adjuntos con nombre. Función pura, probada. */
export function parseMimeTree(root: Part): { text: string; html: string; attachments: GmailAttachmentRef[] } {
  let text = "";
  let html = "";
  const attachments: GmailAttachmentRef[] = [];
  const walk = (p: Part) => {
    const mime = (p.mimeType ?? "").toLowerCase();
    if (p.filename && p.body?.attachmentId) {
      attachments.push({ attachmentId: p.body.attachmentId, filename: p.filename, mimeType: mime || "application/octet-stream", size: Number(p.body.size ?? 0) });
    } else if (mime === "text/plain" && p.body?.data) text += `${b64(p.body.data).toString("utf8")}\n`;
    else if (mime === "text/html" && p.body?.data) html += `${b64(p.body.data).toString("utf8")}\n`;
    for (const c of p.parts ?? []) walk(c);
  };
  walk(root);
  return { text, html, attachments };
}

export function createGmailGateway(refreshToken: string): GmailGateway {
  const { gmail } = gmailWithRefreshToken(refreshToken);
  const header = (hs: Array<{ name?: string | null; value?: string | null }> | undefined, n: string) => hs?.find((h) => (h.name ?? "").toLowerCase() === n)?.value ?? "";
  return {
    async accountEmail() {
      const r = await gmail.users.getProfile({ userId: "me" });
      return String(r.data.emailAddress ?? "").toLowerCase();
    },
    async listCandidates(opts) {
      const parts = ["in:inbox"];
      if (opts.label) parts.push(`label:${opts.label.replace(/\s+/g, "-")}`);
      if (opts.afterDate) parts.push(`after:${opts.afterDate.replace(/-/g, "/")}`);
      if (opts.beforeDate) parts.push(`before:${opts.beforeDate.replace(/-/g, "/")}`);
      const out: Array<{ id: string; threadId: string }> = [];
      let pageToken: string | undefined;
      const scan = Math.min(Math.max(1, opts.scan), MAX_SCAN_PER_RUN);
      do {
        const r = await gmail.users.messages.list({ userId: "me", q: parts.join(" "), maxResults: Math.min(100, scan - out.length), pageToken });
        for (const m of r.data.messages ?? []) if (m.id) out.push({ id: m.id, threadId: m.threadId ?? m.id });
        pageToken = r.data.nextPageToken ?? undefined;
      } while (pageToken && out.length < scan);
      return out.slice(0, scan);
    },
    async getHeaders(id) {
      const r = await gmail.users.messages.get({ userId: "me", id, format: "metadata", metadataHeaders: [...VERIFICATION_HEADERS] });
      const headers = (r.data.payload?.headers ?? []).flatMap((h) => (h.name ? [{ name: h.name, value: h.value ?? "" }] : []));
      return { id, threadId: r.data.threadId ?? id, date: r.data.internalDate ? new Date(Number(r.data.internalDate)).toISOString() : null, headers };
    },
    async getMessage(id) {
      const r = await gmail.users.messages.get({ userId: "me", id, format: "full" });
      const m = r.data;
      const tree = parseMimeTree((m.payload ?? {}) as Part);
      const bodyText = (tree.text.trim() || htmlToText(tree.html)).slice(0, 20_000);
      return {
        id, threadId: m.threadId ?? id, from: header(m.payload?.headers, "from"), subject: header(m.payload?.headers, "subject"),
        date: m.internalDate ? new Date(Number(m.internalDate)).toISOString() : null,
        bodyText, links: extractLinks(`${tree.text}\n${tree.html}`), attachments: tree.attachments,
      };
    },
    async getAttachment(messageId, attachmentId) {
      const r = await gmail.users.messages.attachments.get({ userId: "me", messageId, id: attachmentId });
      return b64(String(r.data.data ?? ""));
    },
  };
}
