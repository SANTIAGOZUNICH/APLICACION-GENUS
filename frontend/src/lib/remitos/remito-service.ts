import { randomUUID } from "node:crypto";
import { desc, eq } from "drizzle-orm";
import { getDb, isDatabaseConfigured } from "@/lib/db/client";
import { isFeatureMemoryAllowed } from "@/lib/db/feature-schema";
import {
  remitoFiles,
  remitoLines,
  remitos,
  remitoVersions,
  remitoWorkLinks,
} from "@/lib/db/schema";
import {
  assertRemitoWritesEnabled,
  isRemitoSchemaReady,
  RemitoSchemaPendingError,
} from "@/lib/db/remito-schema";
import { OrdersForbiddenError, OrdersNotFoundError, OrdersValidationError } from "@/lib/orders/types";
import type { SectorId } from "@/types/operational/sector";
import { normalizeClientId, remitoGroupKey } from "./grouping";
import { computeCajasProduct } from "./packing-math";
import { buildRemitoPdf, REMITO_PDF_MIME } from "./remito-pdf";
import { buildRemitoXlsx, REMITO_XLSX_MIME } from "./remito-xlsx";
import {
  assertPrivateFileStorageConfigured,
  FILE_STORAGE_NOT_CONFIGURED,
  getFileStorage,
  remitoStorageKey,
  STORAGE_PROVIDER_VERCEL_BLOB_PRIVATE,
} from "@/lib/storage/file-storage";
import {
  canAccessRemitos,
  type RemitoApprovalInput,
  type RemitoDraftPatch,
  type RemitoEditGeneratedOptions,
  type RemitoGenerateOptions,
  type RemitoLine,
  type RemitoListFilters,
  type RemitoRecord,
  type RemitoStatus,
  type RemitoUpsertResult,
  type RemitoVersionInfo,
  type RemitoWorkItemStatus,
} from "./types";

export type RemitoActor = { email: string; sector: SectorId };

type MemVersion = {
  id: string;
  remitoId: string;
  version: number;
  motivo: string | null;
  driveFileIdXlsx: string | null;
  driveFileIdPdf: string | null;
  snapshot: Record<string, unknown>;
  createdBy: string;
  createdAt: string;
};

type Mem = {
  remitos: RemitoRecord[];
  workLinks: Map<string, string>; // workItemId -> remitoId
  blobs: Map<string, Buffer>; // driveFileId -> bytes
  versions: MemVersion[];
  files: Array<{
    id: string;
    remitoId: string;
    versionId: string | null;
    kind: "xlsx" | "pdf";
    driveFileId: string;
    fileName: string;
    mimeType: string;
    sizeBytes: number;
    createdBy: string;
    createdAt: string;
  }>;
};

const g = globalThis as unknown as { __genusRemitosMem?: Mem };

function mem(): Mem {
  if (!g.__genusRemitosMem) {
    g.__genusRemitosMem = {
      remitos: [],
      workLinks: new Map(),
      blobs: new Map(),
      versions: [],
      files: [],
    };
  }
  return g.__genusRemitosMem;
}

function assertAccess(actor: RemitoActor) {
  if (!canAccessRemitos(actor.sector)) {
    throw new OrdersForbiddenError("Solo PRODUCCIÓN puede acceder a Remitos.");
  }
}

function parseUnits(input: RemitoApprovalInput): {
  totalUnits: number;
  cajas1: number;
  unidades1: number;
  cajas2: number;
  unidades2: number;
} {
  const totalUnits = Math.max(0, Number(input.totalUnits) || 0);
  let cajas1 = input.cajas1 != null ? Math.max(0, Math.floor(input.cajas1)) : null;
  let unidades1 = input.unidades1 != null ? Math.max(0, Math.floor(input.unidades1)) : null;
  let cajas2 = input.cajas2 != null ? Math.max(0, Math.floor(input.cajas2)) : null;
  let unidades2 = input.unidades2 != null ? Math.max(0, Math.floor(input.unidades2)) : null;

  if (cajas1 == null || unidades1 == null) {
    const upc1 = input.unitsPerCaja1 ?? 0;
    if (upc1 > 0) {
      cajas1 = Math.floor(totalUnits / upc1);
      unidades1 = upc1;
      const packed = computeCajasProduct(cajas1, unidades1) ?? 0;
      const rem = Math.round((totalUnits - packed) * 1000) / 1000;
      if (rem > 0 && cajas2 == null && unidades2 == null) {
        cajas2 = 0;
        unidades2 = rem;
      }
    } else {
      cajas1 = 0;
      unidades1 = totalUnits;
    }
  }
  if (cajas2 == null) cajas2 = 0;
  if (unidades2 == null) unidades2 = 0;

  return {
    totalUnits,
    cajas1: cajas1 ?? 0,
    unidades1: unidades1 ?? 0,
    cajas2,
    unidades2,
  };
}

function recomputeTotals(lines: RemitoLine[]): {
  totalUnits: number;
  totalCajas: number;
  totalBultos: number;
} {
  const totalUnits = lines.reduce((s, l) => s + l.totalUnits, 0);
  const totalCajas = lines.reduce((s, l) => s + l.cajas1 + l.cajas2, 0);
  return { totalUnits, totalCajas, totalBultos: totalCajas };
}

function normalizeDeliveryDate(raw: string): string {
  const s = String(raw ?? "").trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
  const d = new Date(s);
  if (!Number.isNaN(d.getTime())) return d.toISOString().slice(0, 10);
  throw new OrdersValidationError("deliveryDate inválida (usar YYYY-MM-DD).");
}

function emptyRemitoVersions(): RemitoVersionInfo[] {
  return [];
}

function withVersions(remito: RemitoRecord, versions: RemitoVersionInfo[]): RemitoRecord {
  return { ...remito, versions, lines: [...remito.lines] };
}

export class RemitoService {
  async list(actor: RemitoActor, filters: RemitoListFilters = {}): Promise<RemitoRecord[]> {
    assertAccess(actor);
    const all = await this.loadAll();
    return all.filter((r) => this.matchesFilters(r, filters));
  }

  async get(actor: RemitoActor, id: string): Promise<RemitoRecord | null> {
    assertAccess(actor);
    return this.findById(id);
  }

  async findByWorkItemId(workItemId: string): Promise<RemitoRecord | null> {
    const remitoId = await this.findRemitoIdByWorkItem(String(workItemId ?? "").trim());
    if (!remitoId) return null;
    return this.findById(remitoId);
  }

  async statusForWorkItem(
    actor: RemitoActor,
    workItemId: string
  ): Promise<RemitoWorkItemStatus> {
    assertAccess(actor);
    const remito = await this.findByWorkItemId(workItemId);
    if (!remito) return { status: "none", remitoId: null };
    if (remito.status === "BORRADOR") return { status: "draft", remitoId: remito.id };
    if (remito.status === "GENERADO") return { status: "generated", remitoId: remito.id };
    return { status: "none", remitoId: remito.id };
  }

  /**
   * Tras aprobación Calidad (salida/envasado): agrega al borrador del
   * cliente+fecha. Si el remito ya está GENERADO, no muta y ofrece nueva versión.
   *
   * `options.systemHook`: permite al pipeline de Calidad invocar el upsert
   * sin sector PRODUCCIÓN (RBAC de UI/API sigue siendo solo PRODUCCIÓN).
   */
  async upsertDraftFromApproval(
    actor: RemitoActor,
    input: RemitoApprovalInput,
    options?: { systemHook?: boolean }
  ): Promise<RemitoUpsertResult> {
    if (!options?.systemHook) assertAccess(actor);
    await assertRemitoWritesEnabled();

    const workItemId = String(input.workItemId ?? "").trim();
    if (!workItemId) throw new OrdersValidationError("workItemId obligatorio.");
    const clientDisplay = (input.clientDisplay ?? input.clientId).trim();
    const clientIdNormalized = normalizeClientId(input.clientId || clientDisplay);
    if (!clientIdNormalized) throw new OrdersValidationError("clientId obligatorio.");
    const deliveryDate = normalizeDeliveryDate(input.deliveryDate);
    const product = String(input.product ?? "").trim();
    if (!product) throw new OrdersValidationError("product obligatorio.");
    const qty = parseUnits(input);
    const lote = String(input.lote ?? "").trim();
    const vto = String(input.vto ?? "").trim();
    const now = new Date().toISOString();

    const existingLinkRemitoId = await this.findRemitoIdByWorkItem(workItemId);
    if (existingLinkRemitoId) {
      const existing = await this.findById(existingLinkRemitoId);
      if (existing) {
        return { remito: existing, created: false, duplicateWorkItem: true };
      }
    }

    const group = remitoGroupKey(clientIdNormalized, deliveryDate);
    const all = await this.loadAll();
    const draft = all
      .filter(
        (r) =>
          remitoGroupKey(r.clientIdNormalized, r.deliveryDate) === group &&
          r.status === "BORRADOR"
      )
      .sort((a, b) => b.version - a.version)[0];

    const generated = all
      .filter(
        (r) =>
          remitoGroupKey(r.clientIdNormalized, r.deliveryDate) === group &&
          r.status === "GENERADO"
      )
      .sort((a, b) => b.version - a.version)[0];

    if (generated && !draft) {
      return {
        remito: { ...generated, offersNewVersion: true },
        created: false,
        immutableOfferNewVersion: true,
      };
    }

    if (draft) {
      const line: RemitoLine = {
        id: randomUUID(),
        remitoId: draft.id,
        workItemId,
        product,
        lote,
        vto,
        totalUnits: qty.totalUnits,
        cajas1: qty.cajas1,
        unidades1: qty.unidades1,
        cajas2: qty.cajas2,
        unidades2: qty.unidades2,
        sortOrder: draft.lines.length,
      };
      draft.lines.push(line);
      const totals = recomputeTotals(draft.lines);
      draft.totalUnits = totals.totalUnits;
      draft.totalCajas = totals.totalCajas;
      draft.totalBultos = totals.totalBultos;
      draft.updatedBy = actor.email;
      draft.updatedAt = now;
      await this.persistRemito(draft);
      await this.persistLine(line);
      await this.persistWorkLink(draft.id, workItemId);
      return { remito: await this.attachVersions(draft), created: false };
    }

    const id = randomUUID();
    const line: RemitoLine = {
      id: randomUUID(),
      remitoId: id,
      workItemId,
      product,
      lote,
      vto,
      totalUnits: qty.totalUnits,
      cajas1: qty.cajas1,
      unidades1: qty.unidades1,
      cajas2: qty.cajas2,
      unidades2: qty.unidades2,
      sortOrder: 0,
    };
    const totals = recomputeTotals([line]);
    const remito: RemitoRecord = {
      id,
      remitoNumber: null,
      displayName: null,
      clientIdNormalized,
      clientDisplay,
      deliveryDate,
      status: "BORRADOR",
      version: generated ? generated.version + 1 : 1,
      totalUnits: totals.totalUnits,
      totalCajas: totals.totalCajas,
      totalBultos: totals.totalBultos,
      snapshot: {},
      createdBy: actor.email,
      createdBySector: actor.sector,
      updatedBy: actor.email,
      generatedBy: null,
      createdAt: now,
      updatedAt: now,
      generatedAt: null,
      lines: [line],
      versions: emptyRemitoVersions(),
    };
    await this.persistRemito(remito);
    await this.persistLine(line);
    await this.persistWorkLink(id, workItemId);
    return { remito, created: true };
  }

  /**
   * Edita borrador libremente. No muta work items originales;
   * `applyToWorkItem` solo queda auditado (confirmación en UI).
   */
  async updateDraft(
    actor: RemitoActor,
    remitoId: string,
    patch: RemitoDraftPatch
  ): Promise<RemitoRecord> {
    assertAccess(actor);
    await assertRemitoWritesEnabled();
    const remito = await this.findById(remitoId);
    if (!remito) throw new OrdersNotFoundError("Remito no encontrado.");
    if (remito.status !== "BORRADOR") {
      throw new OrdersValidationError("Solo se pueden editar remitos en BORRADOR.");
    }

    const now = new Date().toISOString();
    if (patch.clientDisplay != null) {
      remito.clientDisplay = String(patch.clientDisplay).trim() || remito.clientDisplay;
      remito.clientIdNormalized = normalizeClientId(remito.clientDisplay);
    }
    if (patch.deliveryDate != null) {
      remito.deliveryDate = normalizeDeliveryDate(patch.deliveryDate);
    }
    if (patch.lines?.length) {
      for (const pl of patch.lines) {
        const line = remito.lines.find((l) => l.id === pl.id);
        if (!line) continue;
        if (pl.product != null) line.product = String(pl.product).trim();
        if (pl.lote != null) line.lote = String(pl.lote).trim();
        if (pl.vto != null) line.vto = String(pl.vto).trim();
        if (pl.totalUnits != null) line.totalUnits = Math.max(0, Number(pl.totalUnits) || 0);
        if (pl.cajas1 != null) line.cajas1 = Math.max(0, Math.floor(pl.cajas1));
        if (pl.unidades1 != null) line.unidades1 = Math.max(0, Math.floor(pl.unidades1));
        if (pl.cajas2 != null) line.cajas2 = Math.max(0, Math.floor(pl.cajas2));
        if (pl.unidades2 != null) line.unidades2 = Math.max(0, Math.floor(pl.unidades2));
      }
      const totals = recomputeTotals(remito.lines);
      remito.totalUnits = totals.totalUnits;
      remito.totalCajas = totals.totalCajas;
      remito.totalBultos = totals.totalBultos;
    }
    if (patch.applyToWorkItem) {
      remito.snapshot = {
        ...remito.snapshot,
        applyToWorkItemRequested: true,
        applyToWorkItemAt: now,
        applyToWorkItemBy: actor.email,
      };
    }
    remito.updatedBy = actor.email;
    remito.updatedAt = now;
    await this.persistRemito(remito);
    return this.attachVersions(remito);
  }

  async generate(
    actor: RemitoActor,
    remitoId: string,
    options: RemitoGenerateOptions
  ): Promise<RemitoRecord> {
    assertAccess(actor);
    await assertRemitoWritesEnabled();
    const remito = await this.findById(remitoId);
    if (!remito) throw new OrdersNotFoundError("Remito no encontrado.");
    if (remito.status !== "BORRADOR") {
      throw new OrdersValidationError("Solo se pueden generar remitos en BORRADOR.");
    }
    if (remito.lines.length === 0) {
      throw new OrdersValidationError("El remito no tiene líneas.");
    }
    const displayName = String(options.displayName ?? "").trim();
    if (!displayName) {
      throw new OrdersValidationError("displayName obligatorio para generar.");
    }

    // Sin Blob privado no se generan archivos ni se marca GENERADO.
    if (!isFeatureMemoryAllowed()) {
      try {
        assertPrivateFileStorageConfigured();
      } catch {
        throw new OrdersValidationError(FILE_STORAGE_NOT_CONFIGURED);
      }
    }

    const now = new Date().toISOString();
    const remitoNumber =
      remito.remitoNumber ??
      `R-${remito.deliveryDate.replace(/-/g, "")}-${remito.clientIdNormalized.slice(0, 8)}-${String(
        remito.version
      ).padStart(3, "0")}`;

    const fileBase =
      String(options.filename ?? "").trim().replace(/\.(xlsx|pdf)$/i, "") || displayName;

    const snapshot = {
      clientDisplay: remito.clientDisplay,
      deliveryDate: remito.deliveryDate,
      displayName,
      lines: remito.lines,
      totals: {
        totalUnits: remito.totalUnits,
        totalCajas: remito.totalCajas,
        totalBultos: remito.totalBultos,
      },
      generatedAt: now,
    };

    const withMeta: RemitoRecord = {
      ...remito,
      remitoNumber,
      displayName,
      snapshot,
      status: "GENERADO",
      generatedBy: actor.email,
      generatedAt: now,
      updatedBy: actor.email,
      updatedAt: now,
    };

    // Generar archivos ANTES de marcar GENERADO. Si Blob falla, no persistimos GENERADO.
    const xlsx = await buildRemitoXlsx(withMeta);
    const pdf = await buildRemitoPdf(withMeta);

    const year = remito.deliveryDate.slice(0, 4) || String(new Date().getFullYear());
    const storage = getFileStorage();
    const keyXlsx = remitoStorageKey({
      year,
      remitoId: withMeta.id,
      version: withMeta.version,
      kind: "xlsx",
    });
    const keyPdf = remitoStorageKey({
      year,
      remitoId: withMeta.id,
      version: withMeta.version,
      kind: "pdf",
    });
    const uploaded: string[] = [];

    try {
      const putX = await storage.put({
        storageKey: keyXlsx,
        bytes: xlsx,
        contentType: REMITO_XLSX_MIME,
      });
      uploaded.push(putX.storageKey);
      const putP = await storage.put({
        storageKey: keyPdf,
        bytes: pdf,
        contentType: REMITO_PDF_MIME,
      });
      uploaded.push(putP.storageKey);

      await this.persistRemito(withMeta);
      const versionId = randomUUID();
      await this.persistVersion({
        id: versionId,
        remitoId: withMeta.id,
        version: withMeta.version,
        motivo: null,
        driveFileIdXlsx: putX.storageKey,
        driveFileIdPdf: putP.storageKey,
        snapshot: {
          ...snapshot,
          storageProvider: STORAGE_PROVIDER_VERCEL_BLOB_PRIVATE,
          sha256Xlsx: putX.sha256,
          sha256Pdf: putP.sha256,
        },
        createdBy: actor.email,
        createdAt: now,
      });
      await this.persistFileMeta({
        id: randomUUID(),
        remitoId: withMeta.id,
        versionId,
        kind: "xlsx",
        driveFileId: putX.storageKey,
        fileName: `${fileBase}.xlsx`,
        mimeType: REMITO_XLSX_MIME,
        sizeBytes: xlsx.length,
        createdBy: actor.email,
        createdAt: now,
      });
      await this.persistFileMeta({
        id: randomUUID(),
        remitoId: withMeta.id,
        versionId,
        kind: "pdf",
        driveFileId: putP.storageKey,
        fileName: `${fileBase}.pdf`,
        mimeType: REMITO_PDF_MIME,
        sizeBytes: pdf.length,
        createdBy: actor.email,
        createdAt: now,
      });
    } catch (err) {
      for (const key of uploaded) {
        try {
          await storage.delete(key);
        } catch {
          /* compensación */
        }
      }
      // No marcar GENERADO: el remito en store sigue en BORRADOR.
      if (err instanceof Error && err.message.includes(FILE_STORAGE_NOT_CONFIGURED)) {
        throw new OrdersValidationError(FILE_STORAGE_NOT_CONFIGURED);
      }
      throw err;
    }

    return this.attachVersions(withMeta);
  }

  /**
   * Edita un remito GENERADO: crea nueva versión con motivo obligatorio.
   * Versiones anteriores permanecen descargables. Conserva remitoNumber.
   */
  async editGenerated(
    actor: RemitoActor,
    remitoId: string,
    options: RemitoEditGeneratedOptions
  ): Promise<RemitoRecord> {
    assertAccess(actor);
    await assertRemitoWritesEnabled();
    const remito = await this.findById(remitoId);
    if (!remito) throw new OrdersNotFoundError("Remito no encontrado.");
    if (remito.status !== "GENERADO") {
      throw new OrdersValidationError("editGenerated requiere remito GENERADO.");
    }
    const motivo = String(options.motivo ?? "").trim();
    if (!motivo) throw new OrdersValidationError("motivo obligatorio.");

    const now = new Date().toISOString();
    if (options.displayName != null) {
      const dn = String(options.displayName).trim();
      if (dn) remito.displayName = dn;
    }
    if (options.clientDisplay != null) {
      remito.clientDisplay = String(options.clientDisplay).trim() || remito.clientDisplay;
      remito.clientIdNormalized = normalizeClientId(remito.clientDisplay);
    }
    if (options.deliveryDate != null) {
      remito.deliveryDate = normalizeDeliveryDate(options.deliveryDate);
    }
    if (options.lines?.length) {
      for (const pl of options.lines) {
        const line = remito.lines.find((l) => l.id === pl.id);
        if (!line) continue;
        if (pl.product != null) line.product = String(pl.product).trim();
        if (pl.lote != null) line.lote = String(pl.lote).trim();
        if (pl.vto != null) line.vto = String(pl.vto).trim();
        if (pl.totalUnits != null) line.totalUnits = Math.max(0, Number(pl.totalUnits) || 0);
        if (pl.cajas1 != null) line.cajas1 = Math.max(0, Math.floor(pl.cajas1));
        if (pl.unidades1 != null) line.unidades1 = Math.max(0, Math.floor(pl.unidades1));
        if (pl.cajas2 != null) line.cajas2 = Math.max(0, Math.floor(pl.cajas2));
        if (pl.unidades2 != null) line.unidades2 = Math.max(0, Math.floor(pl.unidades2));
      }
      const totals = recomputeTotals(remito.lines);
      remito.totalUnits = totals.totalUnits;
      remito.totalCajas = totals.totalCajas;
      remito.totalBultos = totals.totalBultos;
    }

    remito.version = remito.version + 1;
    remito.updatedBy = actor.email;
    remito.updatedAt = now;
    remito.generatedBy = actor.email;
    remito.generatedAt = now;

    const displayName = remito.displayName || remito.clientDisplay;
    const fileBase =
      String(options.filename ?? "").trim().replace(/\.(xlsx|pdf)$/i, "") ||
      `${displayName}-v${remito.version}`;

    const snapshot = {
      clientDisplay: remito.clientDisplay,
      deliveryDate: remito.deliveryDate,
      displayName: remito.displayName,
      motivo,
      lines: remito.lines,
      totals: {
        totalUnits: remito.totalUnits,
        totalCajas: remito.totalCajas,
        totalBultos: remito.totalBultos,
      },
      generatedAt: now,
    };
    remito.snapshot = snapshot;

    const xlsx = await buildRemitoXlsx(remito);
    const pdf = await buildRemitoPdf(remito);
    if (!isFeatureMemoryAllowed()) {
      try {
        assertPrivateFileStorageConfigured();
      } catch {
        throw new OrdersValidationError(FILE_STORAGE_NOT_CONFIGURED);
      }
    }
    const storage = getFileStorage();
    const year = remito.deliveryDate.slice(0, 4) || String(new Date().getFullYear());
    const keyXlsx = remitoStorageKey({
      year,
      remitoId: remito.id,
      version: remito.version,
      kind: "xlsx",
    });
    const keyPdf = remitoStorageKey({
      year,
      remitoId: remito.id,
      version: remito.version,
      kind: "pdf",
    });
    const uploaded: string[] = [];

    try {
      const putX = await storage.put({
        storageKey: keyXlsx,
        bytes: xlsx,
        contentType: REMITO_XLSX_MIME,
      });
      uploaded.push(putX.storageKey);
      const putP = await storage.put({
        storageKey: keyPdf,
        bytes: pdf,
        contentType: REMITO_PDF_MIME,
      });
      uploaded.push(putP.storageKey);

      await this.persistRemito(remito);
      const versionId = randomUUID();
      await this.persistVersion({
        id: versionId,
        remitoId: remito.id,
        version: remito.version,
        motivo,
        driveFileIdXlsx: putX.storageKey,
        driveFileIdPdf: putP.storageKey,
        snapshot: {
          ...snapshot,
          storageProvider: STORAGE_PROVIDER_VERCEL_BLOB_PRIVATE,
          sha256Xlsx: putX.sha256,
          sha256Pdf: putP.sha256,
        },
        createdBy: actor.email,
        createdAt: now,
      });
      await this.persistFileMeta({
        id: randomUUID(),
        remitoId: remito.id,
        versionId,
        kind: "xlsx",
        driveFileId: putX.storageKey,
        fileName: `${fileBase}.xlsx`,
        mimeType: REMITO_XLSX_MIME,
        sizeBytes: xlsx.length,
        createdBy: actor.email,
        createdAt: now,
      });
      await this.persistFileMeta({
        id: randomUUID(),
        remitoId: remito.id,
        versionId,
        kind: "pdf",
        driveFileId: putP.storageKey,
        fileName: `${fileBase}.pdf`,
        mimeType: REMITO_PDF_MIME,
        sizeBytes: pdf.length,
        createdBy: actor.email,
        createdAt: now,
      });
    } catch (err) {
      for (const key of uploaded) {
        try {
          await storage.delete(key);
        } catch {
          /* compensación */
        }
      }
      throw err;
    }

    return this.attachVersions(remito);
  }

  async renameDisplayName(
    actor: RemitoActor,
    remitoId: string,
    displayName: string
  ): Promise<RemitoRecord> {
    assertAccess(actor);
    await assertRemitoWritesEnabled();
    const remito = await this.findById(remitoId);
    if (!remito) throw new OrdersNotFoundError("Remito no encontrado.");
    const name = String(displayName ?? "").trim();
    if (!name) throw new OrdersValidationError("displayName obligatorio.");
    remito.displayName = name;
    remito.updatedBy = actor.email;
    remito.updatedAt = new Date().toISOString();
    await this.persistRemito(remito);
    return this.attachVersions(remito);
  }

  async listVersions(actor: RemitoActor, remitoId: string): Promise<RemitoVersionInfo[]> {
    assertAccess(actor);
    const remito = await this.findById(remitoId);
    if (!remito) throw new OrdersNotFoundError("Remito no encontrado.");
    return remito.versions;
  }

  /**
   * Nueva versión a partir de un GENERADO + líneas nuevas (borrador vacío
   * o desde approval con immutableOfferNewVersion).
   */
  async newVersion(
    actor: RemitoActor,
    remitoId: string,
    extraLines: RemitoApprovalInput[] = []
  ): Promise<RemitoRecord> {
    assertAccess(actor);
    await assertRemitoWritesEnabled();
    const base = await this.findById(remitoId);
    if (!base) throw new OrdersNotFoundError("Remito no encontrado.");
    if (base.status !== "GENERADO") {
      throw new OrdersValidationError("newVersion requiere remito GENERADO.");
    }

    const now = new Date().toISOString();
    const id = randomUUID();
    const lines: RemitoLine[] = [];
    for (const input of extraLines) {
      const qty = parseUnits(input);
      const workItemId = String(input.workItemId).trim();
      if (await this.findRemitoIdByWorkItem(workItemId)) {
        continue;
      }
      lines.push({
        id: randomUUID(),
        remitoId: id,
        workItemId,
        product: String(input.product).trim(),
        lote: String(input.lote ?? "").trim(),
        vto: String(input.vto ?? "").trim(),
        totalUnits: qty.totalUnits,
        cajas1: qty.cajas1,
        unidades1: qty.unidades1,
        cajas2: qty.cajas2,
        unidades2: qty.unidades2,
        sortOrder: lines.length,
      });
    }
    const totals = recomputeTotals(lines);
    const remito: RemitoRecord = {
      id,
      remitoNumber: null,
      displayName: null,
      clientIdNormalized: base.clientIdNormalized,
      clientDisplay: base.clientDisplay,
      deliveryDate: base.deliveryDate,
      status: "BORRADOR",
      version: base.version + 1,
      totalUnits: totals.totalUnits,
      totalCajas: totals.totalCajas,
      totalBultos: totals.totalBultos,
      snapshot: { previousRemitoId: base.id },
      createdBy: actor.email,
      createdBySector: actor.sector,
      updatedBy: actor.email,
      generatedBy: null,
      createdAt: now,
      updatedAt: now,
      generatedAt: null,
      lines,
      versions: emptyRemitoVersions(),
    };
    await this.persistRemito(remito);
    for (const line of lines) {
      await this.persistLine(line);
      await this.persistWorkLink(id, line.workItemId);
    }
    return remito;
  }

  async annul(actor: RemitoActor, remitoId: string): Promise<RemitoRecord> {
    assertAccess(actor);
    await assertRemitoWritesEnabled();
    const remito = await this.findById(remitoId);
    if (!remito) throw new OrdersNotFoundError("Remito no encontrado.");
    if (remito.status === "ANULADO") return remito;
    remito.status = "ANULADO";
    remito.updatedBy = actor.email;
    remito.updatedAt = new Date().toISOString();
    await this.persistRemito(remito);
    return this.attachVersions(remito);
  }

  async archive(actor: RemitoActor, remitoId: string): Promise<RemitoRecord> {
    assertAccess(actor);
    await assertRemitoWritesEnabled();
    const remito = await this.findById(remitoId);
    if (!remito) throw new OrdersNotFoundError("Remito no encontrado.");
    remito.status = "ARCHIVADO";
    remito.updatedBy = actor.email;
    remito.updatedAt = new Date().toISOString();
    await this.persistRemito(remito);
    return this.attachVersions(remito);
  }

  async download(
    actor: RemitoActor,
    remitoId: string,
    format: "pdf" | "xlsx",
    version?: number
  ): Promise<{ bytes: Buffer; fileName: string; mimeType: string }> {
    assertAccess(actor);
    const remito = await this.findById(remitoId);
    if (!remito) throw new OrdersNotFoundError("Remito no encontrado.");

    const versions = await this.loadVersionsFor(remitoId);
    const targetVersion =
      version != null
        ? versions.find((v) => v.version === version)
        : [...versions].sort((a, b) => b.version - a.version)[0];

    const storageKey =
      format === "pdf"
        ? targetVersion?.driveFileIdPdf
        : targetVersion?.driveFileIdXlsx;

    // Preferir Blob privado por storage key en metadata de versión / files.
    let key = storageKey ?? null;
    if (!key) {
      const store = mem();
      let versionId: string | null = targetVersion?.id ?? null;
      if (version != null && !versionId) {
        const v = store.versions.find(
          (x) => x.remitoId === remitoId && x.version === version
        );
        if (!v) throw new OrdersNotFoundError(`Versión ${version} no encontrada.`);
        versionId = v.id;
        key =
          format === "pdf" ? v.driveFileIdPdf : v.driveFileIdXlsx;
      }
      const file = store.files
        .filter(
          (f) =>
            f.remitoId === remitoId &&
            f.kind === format &&
            (versionId == null || f.versionId === versionId)
        )
        .sort((a, b) => b.createdAt.localeCompare(a.createdAt))[0];
      if (file?.driveFileId) key = file.driveFileId;
    }

    const base =
      remito.displayName || remito.remitoNumber || `remito-${remito.id.slice(0, 8)}`;
    const mimeType = format === "pdf" ? REMITO_PDF_MIME : REMITO_XLSX_MIME;

    if (key) {
      const storage = getFileStorage();
      const got = await storage.get(key);
      return {
        bytes: got.bytes,
        fileName: `${base}.${format}`,
        mimeType,
      };
    }

    // Fallback regeneración solo en tests sin storage key.
    if (isFeatureMemoryAllowed()) {
      const bytes =
        format === "pdf" ? await buildRemitoPdf(remito) : await buildRemitoXlsx(remito);
      return { bytes, fileName: `${base}.${format}`, mimeType };
    }

    throw new OrdersNotFoundError(
      "Archivo de remito no encontrado en almacenamiento privado."
    );
  }

  // —— persistence helpers ——

  private matchesFilters(r: RemitoRecord, filters: RemitoListFilters): boolean {
    if (filters.status && r.status !== filters.status) return false;
    if (filters.tab === "borradores" && r.status !== "BORRADOR") return false;
    if (filters.tab === "generados" && r.status !== "GENERADO") return false;
    if (filters.tab === "anulados" && r.status !== "ANULADO" && r.status !== "ARCHIVADO")
      return false;
    if (filters.clientId && r.clientIdNormalized !== normalizeClientId(filters.clientId))
      return false;
    if (filters.deliveryDate && r.deliveryDate !== filters.deliveryDate) return false;
    if (filters.q) {
      const q = filters.q.trim().toLowerCase();
      const hay = [
        r.clientDisplay,
        r.displayName ?? "",
        r.remitoNumber ?? "",
        r.deliveryDate,
        ...r.lines.flatMap((l) => [l.product, l.lote, l.vto]),
      ]
        .join(" ")
        .toLowerCase();
      if (!hay.includes(q)) return false;
    }
    return true;
  }

  private async attachVersions(remito: RemitoRecord): Promise<RemitoRecord> {
    const versions = await this.loadVersionsFor(remito.id);
    return withVersions(remito, versions);
  }

  private async loadVersionsFor(remitoId: string): Promise<RemitoVersionInfo[]> {
    if (isFeatureMemoryAllowed() || !isDatabaseConfigured() || !(await isRemitoSchemaReady())) {
      return mem()
        .versions.filter((v) => v.remitoId === remitoId)
        .sort((a, b) => a.version - b.version)
        .map((v) => ({
          id: v.id,
          version: v.version,
          motivo: v.motivo,
          createdBy: v.createdBy,
          createdAt: v.createdAt,
          downloadable: Boolean(v.driveFileIdXlsx || v.driveFileIdPdf),
          driveFileIdXlsx: v.driveFileIdXlsx,
          driveFileIdPdf: v.driveFileIdPdf,
        }));
    }
    try {
      const db = getDb();
      const rows = await db
        .select()
        .from(remitoVersions)
        .where(eq(remitoVersions.remitoId, remitoId));
      return rows
        .sort((a, b) => a.version - b.version)
        .map((v) => ({
          id: v.id,
          version: v.version,
          motivo: v.motivo ?? null,
          createdBy: v.createdBy,
          createdAt: v.createdAt.toISOString(),
          downloadable: Boolean(v.driveFileIdXlsx || v.driveFileIdPdf),
          driveFileIdXlsx: v.driveFileIdXlsx,
          driveFileIdPdf: v.driveFileIdPdf,
        }));
    } catch {
      return mem()
        .versions.filter((v) => v.remitoId === remitoId)
        .map((v) => ({
          id: v.id,
          version: v.version,
          motivo: v.motivo,
          createdBy: v.createdBy,
          createdAt: v.createdAt,
          downloadable: Boolean(v.driveFileIdXlsx || v.driveFileIdPdf),
          driveFileIdXlsx: v.driveFileIdXlsx,
          driveFileIdPdf: v.driveFileIdPdf,
        }));
    }
  }

  private async loadAll(): Promise<RemitoRecord[]> {
    if (isDatabaseConfigured() && (await isRemitoSchemaReady()) && !isFeatureMemoryAllowed()) {
      try {
        return await this.loadAllFromDb();
      } catch {
        if (!isFeatureMemoryAllowed()) return [];
      }
    }
    const store = mem();
    const out: RemitoRecord[] = [];
    for (const r of store.remitos) {
      out.push(await this.attachVersions({ ...r, lines: [...r.lines] }));
    }
    return out;
  }

  private async loadAllFromDb(): Promise<RemitoRecord[]> {
    const db = getDb();
    const rows = await db.select().from(remitos).orderBy(desc(remitos.updatedAt));
    const lineRows = await db.select().from(remitoLines);
    const versionRows = await db.select().from(remitoVersions);
    const byRemito = new Map<string, RemitoLine[]>();
    for (const l of lineRows) {
      const list = byRemito.get(l.remitoId) ?? [];
      list.push({
        id: l.id,
        remitoId: l.remitoId,
        workItemId: l.workItemId,
        product: l.product,
        lote: l.lote,
        vto: l.vto,
        totalUnits: l.totalUnits,
        cajas1: l.cajas1,
        unidades1: l.unidades1,
        cajas2: l.cajas2,
        unidades2: l.unidades2,
        sortOrder: l.sortOrder,
      });
      byRemito.set(l.remitoId, list);
    }
    const versionsByRemito = new Map<string, RemitoVersionInfo[]>();
    for (const v of versionRows) {
      const list = versionsByRemito.get(v.remitoId) ?? [];
      list.push({
        id: v.id,
        version: v.version,
        motivo: v.motivo ?? null,
        createdBy: v.createdBy,
        createdAt: v.createdAt.toISOString(),
        downloadable: Boolean(v.driveFileIdXlsx || v.driveFileIdPdf),
        driveFileIdXlsx: v.driveFileIdXlsx,
        driveFileIdPdf: v.driveFileIdPdf,
      });
      versionsByRemito.set(v.remitoId, list);
    }
    return rows.map((r) => ({
      id: r.id,
      remitoNumber: r.remitoNumber,
      displayName: r.displayName ?? null,
      clientIdNormalized: r.clientIdNormalized,
      clientDisplay: r.clientDisplay,
      deliveryDate: String(r.deliveryDate),
      status: r.status as RemitoStatus,
      version: r.version,
      totalUnits: r.totalUnits,
      totalCajas: r.totalCajas,
      totalBultos: r.totalBultos,
      snapshot: (r.snapshot ?? {}) as Record<string, unknown>,
      createdBy: r.createdBy,
      createdBySector: r.createdBySector,
      updatedBy: r.updatedBy,
      generatedBy: r.generatedBy,
      createdAt: r.createdAt.toISOString(),
      updatedAt: r.updatedAt.toISOString(),
      generatedAt: r.generatedAt ? r.generatedAt.toISOString() : null,
      lines: (byRemito.get(r.id) ?? []).sort((a, b) => a.sortOrder - b.sortOrder),
      versions: (versionsByRemito.get(r.id) ?? []).sort((a, b) => a.version - b.version),
    }));
  }

  private async findById(id: string): Promise<RemitoRecord | null> {
    const all = await this.loadAll();
    return all.find((r) => r.id === id) ?? null;
  }

  private async findRemitoIdByWorkItem(workItemId: string): Promise<string | null> {
    if (isFeatureMemoryAllowed() || !isDatabaseConfigured()) {
      return mem().workLinks.get(workItemId) ?? null;
    }
    if (!(await isRemitoSchemaReady())) {
      return mem().workLinks.get(workItemId) ?? null;
    }
    try {
      const db = getDb();
      const rows = await db
        .select()
        .from(remitoWorkLinks)
        .where(eq(remitoWorkLinks.workItemId, workItemId))
        .limit(1);
      return rows[0]?.remitoId ?? null;
    } catch {
      return mem().workLinks.get(workItemId) ?? null;
    }
  }

  private async persistRemito(remito: RemitoRecord): Promise<void> {
    if (isFeatureMemoryAllowed() || !(await isRemitoSchemaReady())) {
      const store = mem();
      const idx = store.remitos.findIndex((r) => r.id === remito.id);
      const copy = {
        ...remito,
        displayName: remito.displayName ?? null,
        lines: [...remito.lines],
        versions: [...(remito.versions ?? [])],
      };
      if (idx >= 0) store.remitos[idx] = copy;
      else store.remitos.push(copy);
      return;
    }
    const db = getDb();
    const values = {
      id: remito.id,
      remitoNumber: remito.remitoNumber,
      displayName: remito.displayName,
      clientIdNormalized: remito.clientIdNormalized,
      clientDisplay: remito.clientDisplay,
      deliveryDate: remito.deliveryDate,
      status: remito.status,
      version: remito.version,
      totalUnits: remito.totalUnits,
      totalCajas: remito.totalCajas,
      totalBultos: remito.totalBultos,
      snapshot: remito.snapshot,
      createdBy: remito.createdBy,
      createdBySector: remito.createdBySector,
      updatedBy: remito.updatedBy,
      generatedBy: remito.generatedBy,
      generatedAt: remito.generatedAt ? new Date(remito.generatedAt) : null,
      updatedAt: new Date(remito.updatedAt),
      createdAt: new Date(remito.createdAt),
      audit: {},
    };
    const existing = await db
      .select({ id: remitos.id })
      .from(remitos)
      .where(eq(remitos.id, remito.id))
      .limit(1);
    if (existing.length) {
      await db.update(remitos).set(values).where(eq(remitos.id, remito.id));
    } else {
      await db.insert(remitos).values(values);
    }
  }

  private async persistLine(line: RemitoLine): Promise<void> {
    if (isFeatureMemoryAllowed() || !(await isRemitoSchemaReady())) {
      const remito = mem().remitos.find((r) => r.id === line.remitoId);
      if (remito && !remito.lines.some((l) => l.id === line.id)) {
        remito.lines.push(line);
      }
      return;
    }
    const db = getDb();
    await db.insert(remitoLines).values({
      id: line.id,
      remitoId: line.remitoId,
      workItemId: line.workItemId,
      product: line.product,
      lote: line.lote,
      vto: line.vto,
      totalUnits: line.totalUnits,
      cajas1: line.cajas1,
      unidades1: line.unidades1,
      cajas2: line.cajas2,
      unidades2: line.unidades2,
      sortOrder: line.sortOrder,
    });
  }

  private async persistWorkLink(remitoId: string, workItemId: string): Promise<void> {
    if (isFeatureMemoryAllowed() || !(await isRemitoSchemaReady())) {
      mem().workLinks.set(workItemId, remitoId);
      return;
    }
    const db = getDb();
    await db.insert(remitoWorkLinks).values({ remitoId, workItemId });
  }

  private async persistVersion(v: MemVersion): Promise<void> {
    if (isFeatureMemoryAllowed() || !(await isRemitoSchemaReady())) {
      mem().versions.push(v);
      return;
    }
    const db = getDb();
    await db.insert(remitoVersions).values({
      id: v.id,
      remitoId: v.remitoId,
      version: v.version,
      motivo: v.motivo,
      driveFileIdXlsx: v.driveFileIdXlsx,
      driveFileIdPdf: v.driveFileIdPdf,
      snapshot: v.snapshot,
      createdBy: v.createdBy,
      createdAt: new Date(v.createdAt),
    });
  }

  private async persistFileMeta(f: Mem["files"][number]): Promise<void> {
    if (isFeatureMemoryAllowed() || !(await isRemitoSchemaReady())) {
      mem().files.push(f);
      return;
    }
    try {
      const db = getDb();
      await db.insert(remitoFiles).values({
        id: f.id,
        remitoId: f.remitoId,
        versionId: f.versionId,
        kind: f.kind,
        driveFileId: f.driveFileId,
        fileName: f.fileName,
        mimeType: f.mimeType,
        sizeBytes: f.sizeBytes,
        createdBy: f.createdBy,
        createdAt: new Date(f.createdAt),
      });
    } catch (err) {
      try {
        await getFileStorage().delete(f.driveFileId);
      } catch {
        /* compensación */
      }
      throw err;
    }
  }
}

let singleton: RemitoService | null = null;
export function getRemitoService(): RemitoService {
  if (!singleton) singleton = new RemitoService();
  return singleton;
}

export function resetRemitoMemoryForTests(): void {
  g.__genusRemitosMem = {
    remitos: [],
    workLinks: new Map(),
    blobs: new Map(),
    versions: [],
    files: [],
  };
  singleton = null;
}

export { RemitoSchemaPendingError };
