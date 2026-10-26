import "server-only";

/** Acceso de SOLO LECTURA a Gmail. Interfaz mínima para poder probar el servicio con un buzón simulado. Nunca borra, mueve ni responde. */
import { gmailWithRefreshToken } from "./gmail-oauth";

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
export type ListOptions = { max: number; afterDate?: string; beforeDate?: string };
export interface GmailGateway {
  accountEmail(): Promise<string>;
  listRecent(opts: ListOptions): Promise<Array<{ id: string; threadId: string }>>;
  getMessage(id: string): Promise<GmailMessage>;
  getAttachment(messageId: string, attachmentId: string): Promise<Buffer>;
}

export const MAX_MESSAGES_PER_RUN = 10;

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

export function createGmailGateway(refreshToken: string, account: string): GmailGateway {
  const { gmail } = gmailWithRefreshToken(refreshToken);
  const header = (hs: Array<{ name?: string | null; value?: string | null }> | undefined, n: string) => hs?.find((h) => (h.name ?? "").toLowerCase() === n)?.value ?? "";
  return {
    async accountEmail() {
      const r = await gmail.users.getProfile({ userId: "me" });
      return String(r.data.emailAddress ?? "").toLowerCase();
    },
    async listRecent(opts) {
      const parts = ["in:inbox", `-from:${account}`];
      if (opts.afterDate) parts.push(`after:${opts.afterDate.replace(/-/g, "/")}`);
      if (opts.beforeDate) parts.push(`before:${opts.beforeDate.replace(/-/g, "/")}`);
      const r = await gmail.users.messages.list({ userId: "me", q: parts.join(" "), maxResults: Math.min(Math.max(1, opts.max), MAX_MESSAGES_PER_RUN) });
      return (r.data.messages ?? []).flatMap((m) => (m.id ? [{ id: m.id, threadId: m.threadId ?? m.id }] : []));
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
