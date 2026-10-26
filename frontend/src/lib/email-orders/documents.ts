import "server-only";

/**
 * Adjuntos → contenido para la IA. Todo adjunto es NO CONFIABLE: solo se lee como datos (texto de planillas/Word, o el archivo en línea
 * para PDF/imagen), con límites de cantidad y tamaño. No se ejecuta nada ni se abren enlaces.
 */
import { createHash } from "node:crypto";
import * as XLSX from "xlsx";
// jszip llega como dependencia de exceljs (ya instalada y fijada en el lock); se usa solo para leer .docx.
import JSZip from "jszip";
import type { GmailAttachmentRef } from "./gateway";

export const MAX_ATTACHMENTS = 5;
export const MAX_ATTACHMENT_BYTES = 8 * 1024 * 1024;
export const MAX_INLINE_TOTAL = 14 * 1024 * 1024;
const MAX_TEXT_PER_DOC = 20_000;

export type DocMeta = { filename: string; mimeType: string; size: number; sha256: string; used: boolean; note?: string };
export type DocContent = { meta: DocMeta; text?: string; inline?: { mimeType: string; base64: string } };

const ext = (n: string) => (n.toLowerCase().match(/\.([a-z0-9]+)$/)?.[1] ?? "");
const KIND = (a: { filename: string; mimeType: string }): "excel" | "word" | "pdf" | "image" | "text" | null => {
  const e = ext(a.filename);
  const m = a.mimeType.toLowerCase();
  if (e === "xlsx" || e === "xls" || e === "xlsm" || /spreadsheetml|ms-excel/.test(m)) return "excel";
  if (e === "docx" || /wordprocessingml/.test(m)) return "word";
  if (e === "pdf" || m === "application/pdf") return "pdf";
  if (["png", "jpg", "jpeg", "webp"].includes(e) || /^image\/(png|jpeg|webp)$/.test(m)) return "image";
  if (e === "csv" || e === "txt" || m === "text/csv" || m === "text/plain") return "text";
  return null;
};

export async function docxToText(buf: Buffer): Promise<string> {
  const zip = await JSZip.loadAsync(buf);
  const xml = await zip.file("word/document.xml")?.async("string");
  if (!xml) return "";
  return xml
    .replace(/<w:tab\/>/g, "\t").replace(/<\/w:p>/g, "\n").replace(/<\/w:tc>/g, " | ")
    .replace(/<[^>]+>/g, "").replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/\n\s*\n+/g, "\n").trim();
}

export function excelToText(buf: Buffer): string {
  const wb = XLSX.read(buf, { type: "buffer", cellDates: true });
  let out = "";
  for (const name of wb.SheetNames.slice(0, 4)) {
    const csv = XLSX.utils.sheet_to_csv(wb.Sheets[name]!, { blankrows: false });
    if (csv.trim()) out += `# Hoja: ${name}\n${csv}\n`;
    if (out.length > MAX_TEXT_PER_DOC) break;
  }
  return out;
}

export async function loadDocuments(
  refs: GmailAttachmentRef[],
  fetchBytes: (ref: GmailAttachmentRef) => Promise<Buffer>
): Promise<DocContent[]> {
  const out: DocContent[] = [];
  let inlineTotal = 0;
  for (const ref of refs) {
    const meta: DocMeta = { filename: ref.filename, mimeType: ref.mimeType, size: ref.size, sha256: "", used: false };
    const kind = KIND(ref);
    if (out.filter((d) => d.meta.used).length >= MAX_ATTACHMENTS) { out.push({ meta: { ...meta, note: "Se superó el máximo de adjuntos por correo." } }); continue; }
    if (!kind) { out.push({ meta: { ...meta, note: "Tipo de archivo no soportado (no se abrió)." } }); continue; }
    if (ref.size > MAX_ATTACHMENT_BYTES) { out.push({ meta: { ...meta, note: "Archivo demasiado grande (no se abrió)." } }); continue; }
    try {
      const bytes = await fetchBytes(ref);
      meta.sha256 = createHash("sha256").update(bytes).digest("hex");
      meta.size = bytes.length;
      if (bytes.length > MAX_ATTACHMENT_BYTES) { out.push({ meta: { ...meta, note: "Archivo demasiado grande (no se abrió)." } }); continue; }
      if (kind === "excel") out.push({ meta: { ...meta, used: true }, text: excelToText(bytes).slice(0, MAX_TEXT_PER_DOC) });
      else if (kind === "word") out.push({ meta: { ...meta, used: true }, text: (await docxToText(bytes)).slice(0, MAX_TEXT_PER_DOC) });
      else if (kind === "text") out.push({ meta: { ...meta, used: true }, text: bytes.toString("utf8").slice(0, MAX_TEXT_PER_DOC) });
      else {
        if (inlineTotal + bytes.length > MAX_INLINE_TOTAL) { out.push({ meta: { ...meta, note: "Se superó el tamaño total permitido." } }); continue; }
        inlineTotal += bytes.length;
        const mime = kind === "pdf" ? "application/pdf" : ref.mimeType.startsWith("image/") ? ref.mimeType : `image/${ext(ref.filename) === "jpg" ? "jpeg" : ext(ref.filename)}`;
        out.push({ meta: { ...meta, used: true }, inline: { mimeType: mime, base64: bytes.toString("base64") } });
      }
    } catch (err) {
      out.push({ meta: { ...meta, note: `No se pudo leer el archivo (${err instanceof Error ? err.message.slice(0, 80) : "error"}).` } });
    }
  }
  return out;
}
