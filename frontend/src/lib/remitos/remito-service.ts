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
  trashRemitoDriveFile,
  uploadRemitoDriveFile,
  getRemitosFolderId,
} from "./drive-write";
import {
  canAccessRemitos,
  type RemitoApprovalInput,
  type RemitoLine,
  type RemitoListFilters,
  type RemitoRecord,
  type RemitoStatus,
  type RemitoUpsertResult,
} from "./types";

export type RemitoActor = { email: string; sector: SectorId };

type Mem = {
  remitos: RemitoRecord[];
  workLinks: Map<string, string>; // workItemId -> remitoId
  blobs: Map<string, Buffer>; // driveFileId -> bytes
  versions: Array<{
    id: string;
    remitoId: string;
    version: number;
    driveFileIdXlsx: string | null;
    driveFileIdPdf: string | null;
    snapshot: Record<string, unknown>;
    createdBy: string;
    createdAt: string;
  }>;
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
      // Cajas enteras × unidades/caja; remanente va a bloque 2 si aplica.
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

  /**
   * Tras aprobación Calidad (salida/envasado): agrega al borrador del
   * cliente+fecha. Si el remito ya está GENERADO, no muta y ofrece nueva versión.
   * Soft-fail externo si schema pending (caller atrapa).
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

    // ¿Work item ya vinculado?
    const existingLinkRemitoId = await this.findRemitoIdByWorkItem(workItemId);
    if (existingLinkRemitoId) {
      const existing = await this.findById(existingLinkRemitoId);
      if (existing) {
        return { remito: existing, created: false, duplicateWorkItem: true };
      }
    }

    // Buscar borrador abierto para cliente+fecha (máxima versión BORRADOR)
    const group = remitoGroupKey(clientIdNormalized, deliveryDate);
    const all = await this.loadAll();
    const draft = all
      .filter(
        (r) =>
          remitoGroupKey(r.clientIdNormalized, r.deliveryDate) === group &&
          r.status === "BORRADOR"
      )
      .sort((a, b) => b.version - a.version)[0];

    // ¿Hay GENERADO inmutable para mismo grupo?
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
      return { remito: draft, created: false };
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
    };
    await this.persistRemito(remito);
    await this.persistLine(line);
    await this.persistWorkLink(id, workItemId);
    return { remito, created: true };
  }

  async generate(actor: RemitoActor, remitoId: string): Promise<RemitoRecord> {
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

    const now = new Date().toISOString();
    const remitoNumber =
      remito.remitoNumber ??
      `R-${remito.deliveryDate.replace(/-/g, "")}-${remito.clientIdNormalized.slice(0, 8)}-v${remito.version}`;

    const snapshot = {
      clientDisplay: remito.clientDisplay,
      deliveryDate: remito.deliveryDate,
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
      snapshot,
      status: "GENERADO",
      generatedBy: actor.email,
      generatedAt: now,
      updatedBy: actor.email,
      updatedAt: now,
    };

    const xlsx = await buildRemitoXlsx(withMeta);
    const pdf = await buildRemitoPdf(withMeta);

    let driveXlsx = `mem-xlsx-${randomUUID()}`;
    let drivePdf = `mem-pdf-${randomUUID()}`;
    const uploaded: string[] = [];

    try {
      if (getRemitosFolderId() && !isFeatureMemoryAllowed()) {
        driveXlsx = await uploadRemitoDriveFile({
          fileName: `${remitoNumber}.xlsx`,
          mimeType: REMITO_XLSX_MIME,
          bytes: xlsx,
        });
        uploaded.push(driveXlsx);
        drivePdf = await uploadRemitoDriveFile({
          fileName: `${remitoNumber}.pdf`,
          mimeType: REMITO_PDF_MIME,
          bytes: pdf,
        });
        uploaded.push(drivePdf);
      } else if (isFeatureMemoryAllowed()) {
        mem().blobs.set(driveXlsx, xlsx);
        mem().blobs.set(drivePdf, pdf);
      } else if (getRemitosFolderId()) {
        driveXlsx = await uploadRemitoDriveFile({
          fileName: `${remitoNumber}.xlsx`,
          mimeType: REMITO_XLSX_MIME,
          bytes: xlsx,
        });
        uploaded.push(driveXlsx);
        drivePdf = await uploadRemitoDriveFile({
          fileName: `${remitoNumber}.pdf`,
          mimeType: REMITO_PDF_MIME,
          bytes: pdf,
        });
        uploaded.push(drivePdf);
      }

      await this.persistRemito(withMeta);
      const versionId = randomUUID();
      await this.persistVersion({
        id: versionId,
        remitoId: withMeta.id,
        version: withMeta.version,
        driveFileIdXlsx: driveXlsx,
        driveFileIdPdf: drivePdf,
        snapshot,
        createdBy: actor.email,
        createdAt: now,
      });
      await this.persistFileMeta({
        id: randomUUID(),
        remitoId: withMeta.id,
        versionId,
        kind: "xlsx",
        driveFileId: driveXlsx,
        fileName: `${remitoNumber}.xlsx`,
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
        driveFileId: drivePdf,
        fileName: `${remitoNumber}.pdf`,
        mimeType: REMITO_PDF_MIME,
        sizeBytes: pdf.length,
        createdBy: actor.email,
        createdAt: now,
      });
    } catch (err) {
      for (const id of uploaded) {
        await trashRemitoDriveFile(id);
      }
      throw err;
    }

    return withMeta;
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
    return remito;
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
    return remito;
  }

  async download(
    actor: RemitoActor,
    remitoId: string,
    format: "pdf" | "xlsx"
  ): Promise<{ bytes: Buffer; fileName: string; mimeType: string }> {
    assertAccess(actor);
    const remito = await this.findById(remitoId);
    if (!remito) throw new OrdersNotFoundError("Remito no encontrado.");

    const store = mem();
    const file = store.files
      .filter((f) => f.remitoId === remitoId && f.kind === format)
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt))[0];

    if (file && store.blobs.has(file.driveFileId)) {
      return {
        bytes: store.blobs.get(file.driveFileId)!,
        fileName: file.fileName,
        mimeType: file.mimeType,
      };
    }

    // Regenerar on-the-fly (borrador o sin blob)
    const bytes =
      format === "pdf" ? await buildRemitoPdf(remito) : await buildRemitoXlsx(remito);
    const base = remito.remitoNumber ?? `remito-${remito.id.slice(0, 8)}`;
    return {
      bytes,
      fileName: `${base}.${format}`,
      mimeType: format === "pdf" ? REMITO_PDF_MIME : REMITO_XLSX_MIME,
    };
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
        r.remitoNumber ?? "",
        ...r.lines.map((l) => l.product),
      ]
        .join(" ")
        .toLowerCase();
      if (!hay.includes(q)) return false;
    }
    return true;
  }

  private async loadAll(): Promise<RemitoRecord[]> {
    if (isDatabaseConfigured() && (await isRemitoSchemaReady()) && !isFeatureMemoryAllowed()) {
      try {
        return await this.loadAllFromDb();
      } catch {
        if (!isFeatureMemoryAllowed()) return [];
      }
    }
    return mem().remitos.map((r) => ({ ...r, lines: [...r.lines] }));
  }

  private async loadAllFromDb(): Promise<RemitoRecord[]> {
    const db = getDb();
    const rows = await db.select().from(remitos).orderBy(desc(remitos.updatedAt));
    const lineRows = await db.select().from(remitoLines);
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
    return rows.map((r) => ({
      id: r.id,
      remitoNumber: r.remitoNumber,
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
      if (idx >= 0) store.remitos[idx] = { ...remito, lines: [...remito.lines] };
      else store.remitos.push({ ...remito, lines: [...remito.lines] });
      return;
    }
    const db = getDb();
    const values = {
      id: remito.id,
      remitoNumber: remito.remitoNumber,
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

  private async persistVersion(v: Mem["versions"][number]): Promise<void> {
    if (isFeatureMemoryAllowed() || !(await isRemitoSchemaReady())) {
      mem().versions.push(v);
      return;
    }
    const db = getDb();
    await db.insert(remitoVersions).values({
      id: v.id,
      remitoId: v.remitoId,
      version: v.version,
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
      await trashRemitoDriveFile(f.driveFileId);
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
