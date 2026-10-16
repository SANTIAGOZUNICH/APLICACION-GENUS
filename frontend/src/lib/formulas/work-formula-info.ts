/**
 * «Ver OE / Fórmula» de un trabajo de Elaboración: la OE vinculada (flujo existente) y el archivo de la fórmula en la
 * carpeta nueva de Drive. Prioridad del documento:
 *  1. el archivo con el que se preparó la OE (histórico: nunca se reemplaza por otro);
 *  2. el vínculo explícito cliente + producto (validado);
 *  3. la única coincidencia fuerte del índice.
 * Las opciones para elegir (casos ambiguos) solo se devuelven a quien puede vincular (Producción / Dirección).
 */
import "server-only";

import { sql } from "drizzle-orm";
import { getDb, isDatabaseConfigured } from "@/lib/db/client";
import { OrdersForbiddenError, OrdersNotFoundError } from "@/lib/orders/types";
import type { DriveIndexFlag, MatchReason } from "./drive-match-rules";
import {
  FormulaSourceError,
  LINK_STATE_MESSAGE,
  formulaDriveLister,
  getIndexStatus,
  getIndexedFile,
  isNewFormulaSourceValidated,
  lookupFormulaForWork,
  type FormulaLink,
} from "./drive-formula-source";

export const FORMULA_VIEW_SECTORS = ["ELABORACION", "PRODUCCION", "DIRECCION", "CALIDAD"] as const;
export const FORMULA_LINK_SECTORS = ["PRODUCCION", "DIRECCION"] as const;
export const canViewWorkFormula = (sector: string) => (FORMULA_VIEW_SECTORS as readonly string[]).includes(sector);
export const canLinkFormula = (sector: string) => (FORMULA_LINK_SECTORS as readonly string[]).includes(sector);

export type FormulaDocument = {
  fileId: string;
  fileName: string;
  clientFolder: string | null;
  subPath: string;
  modifiedTime: string | null;
  mimeType: string | null;
  via: "oe" | "link" | "match";
  /** Se puede descargar por GENUS OS (está en el índice de la carpeta de fórmulas). */
  downloadable: boolean;
  driveUrl: string | null;
};

export type FormulaCandidateView = {
  fileId: string;
  fileName: string;
  clientFolder: string;
  subPath: string;
  modifiedTime: string | null;
  score: number;
  reason: MatchReason;
  flags: DriveIndexFlag[];
  otherClient: string | null;
};

export type WorkFormulaInfo = {
  work: { id: string; client: string; product: string; sector: string };
  oe: { id: string; number: string; status: string; formulaStatus: string | null; formulaMessage: string | null; formulaProduct: string | null } | null;
  document: FormulaDocument | null;
  /** ok: hay documento · ambiguous: varias opciones · not_found · link_invalid · no_index (carpeta nueva sin indexar) */
  status: "ok" | "ambiguous" | "not_found" | "link_invalid" | "unavailable" | "no_index";
  message: string | null;
  link: Pick<FormulaLink, "id" | "fileId" | "fileName" | "linkedBy" | "linkedAt" | "note"> | null;
  candidates: FormulaCandidateView[];
  canLink: boolean;
  index: { validated: boolean; lastSyncAt: string | null; files: number; clients: number; stale: boolean; lastError: string | null };
};

type Row = Record<string, unknown>;

export function driveUrlFor(fileId: string, mimeType: string | null): string | null {
  if (fileId.startsWith("local:")) return null;
  return mimeType === "application/vnd.google-apps.spreadsheet"
    ? `https://docs.google.com/spreadsheets/d/${fileId}/edit`
    : `https://drive.google.com/file/d/${fileId}/view`;
}

export async function getWorkFormulaInfo(actor: { email: string; sector: string }, workItemId: string): Promise<WorkFormulaInfo> {
  if (!canViewWorkFormula(actor.sector)) throw new OrdersForbiddenError("Tu sector no ve las fórmulas de Elaboración.");
  if (!isDatabaseConfigured()) throw new FormulaSourceError("Fórmulas requiere la base de datos.", 503);
  // Los trabajos nativos llegan desde la pantalla como «native:<uuid>».
  workItemId = workItemId.replace(/^native:/, "");
  if (!/^[0-9a-f-]{36}$/i.test(workItemId)) throw new OrdersNotFoundError("Trabajo no encontrado.");
  const db = getDb();
  const [w] = (await db.execute(sql`
    select id, client, product, sector::text as sector, order_id from work_items where id = ${workItemId}::uuid limit 1`)).rows as Row[];
  if (!w) throw new OrdersNotFoundError("Trabajo no encontrado.");
  const work = { id: String(w.id), client: String(w.client ?? ""), product: String(w.product ?? ""), sector: String(w.sector) };

  const [o] = (await db.execute(sql`
    select id, order_number, status::text as status, form_data from operational_orders
     where type = 'OE' and deleted_at is null and (id = ${w.order_id ?? null}::uuid or linked_work_item_id = ${workItemId})
     order by (id = ${w.order_id ?? null}::uuid) desc nulls last, created_at desc limit 1`)).rows as Row[];
  const fd = (o?.form_data ?? null) as { autoPrep?: { formula?: { status?: string; message?: string; driveFileId?: string; displayProduct?: string; source?: string } } } | null;
  const apf = fd?.autoPrep?.formula ?? null;
  const oe = o
    ? { id: String(o.id), number: String(o.order_number), status: String(o.status), formulaStatus: apf?.status ?? null, formulaMessage: apf?.message ?? null, formulaProduct: apf?.displayProduct ?? null }
    : null;

  const canLink = canLinkFormula(actor.sector);
  const st = await getIndexStatus().catch(() => null);
  const index = {
    validated: Boolean(st?.validated),
    lastSyncAt: st?.lastOk?.at ?? null,
    files: st?.lastOk?.files ?? 0,
    clients: st?.lastOk?.clients ?? 0,
    stale: st?.stale ?? true,
    lastError: st?.lastRun?.status === "error" ? st.lastRun.error : null,
  };

  // 1) El archivo con el que se preparó la OE (histórico).
  let document: FormulaDocument | null = null;
  if (apf?.status === "ok" && apf.driveFileId) {
    const f = await getIndexedFile(apf.driveFileId).catch(() => null);
    document = {
      fileId: apf.driveFileId,
      fileName: f?.fileName ?? apf.displayProduct ?? "Fórmula de la OE",
      clientFolder: f?.clientFolderName ?? null,
      subPath: f?.subPath ?? "",
      modifiedTime: f?.modifiedTime ?? null,
      mimeType: f?.mimeType ?? null,
      via: "oe",
      downloadable: Boolean(f),
      driveUrl: driveUrlFor(apf.driveFileId, f?.mimeType ?? null),
    };
  }

  if (!(await isNewFormulaSourceValidated())) {
    return {
      work,
      oe,
      document,
      status: document ? "ok" : "no_index",
      message: document
        ? null
        : index.lastError
          ? `La carpeta nueva de fórmulas todavía no se pudo indexar: ${index.lastError}`
          : "La carpeta nueva de fórmulas todavía no se indexó. Producción: «Actualizar índice».",
      link: null,
      candidates: [],
      canLink,
      index,
    };
  }

  if (!work.client.trim() || !work.product.trim()) {
    return { work, oe, document, status: document ? "ok" : "not_found", message: document ? null : "El trabajo no tiene cliente y producto.", link: null, candidates: [], canLink, index };
  }

  const lookup = await lookupFormulaForWork(work.client, work.product);
  const link = lookup.kind === "linked" || lookup.kind === "link_invalid" ? lookup.link : null;
  const linkView = link ? { id: link.id, fileId: link.fileId, fileName: link.fileName, linkedBy: link.linkedBy, linkedAt: link.linkedAt, note: link.note } : null;
  const toCandidates = (): FormulaCandidateView[] =>
    canLink && lookup.kind === "match"
      ? lookup.decision.candidates.map((c) => ({
          fileId: c.fileId,
          fileName: c.fileName,
          clientFolder: c.clientFolderName,
          subPath: c.subPath,
          modifiedTime: c.modifiedTime,
          score: c.score,
          reason: c.reason,
          flags: c.flags,
          otherClient: c.otherClient ?? null,
        }))
      : [];

  if (lookup.kind === "link_invalid") {
    return { work, oe, document, status: "link_invalid", message: `Fórmula vinculada «${lookup.link.fileName}»: ${lookup.message}`, link: linkView, candidates: [], canLink, index };
  }
  if (lookup.kind === "linked") {
    const f = lookup.file;
    document ??= { fileId: f.fileId, fileName: f.fileName, clientFolder: f.clientFolderName, subPath: f.subPath, modifiedTime: f.modifiedTime, mimeType: f.mimeType, via: "link", downloadable: true, driveUrl: driveUrlFor(f.fileId, f.mimeType) };
    return { work, oe, document, status: "ok", message: null, link: linkView, candidates: [], canLink, index };
  }
  const d = lookup.decision;
  if (d.kind === "one") {
    const f = d.file;
    if (!document) {
      // Antes de ofrecer el archivo se confirma que GENUS OS lo puede leer (sin acceso → aviso, nunca otro archivo).
      const state = await formulaDriveLister().fileState(f.fileId);
      if (state !== "ok") {
        return { work, oe, document, status: "unavailable", message: `Archivo «${f.fileName}»: ${LINK_STATE_MESSAGE[state]}`, link: null, candidates: toCandidates(), canLink, index };
      }
    }
    document ??= { fileId: f.fileId, fileName: f.fileName, clientFolder: f.clientFolderName, subPath: f.subPath, modifiedTime: f.modifiedTime, mimeType: f.mimeType, via: "match", downloadable: true, driveUrl: driveUrlFor(f.fileId, f.mimeType) };
    return { work, oe, document, status: "ok", message: null, link: null, candidates: toCandidates(), canLink, index };
  }
  return {
    work,
    oe,
    document,
    status: document ? "ok" : d.kind === "ambiguous" ? "ambiguous" : "not_found",
    message: document ? null : d.message,
    link: null,
    candidates: toCandidates(),
    canLink,
    index,
  };
}
