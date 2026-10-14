/**
 * Fotos/archivos de remito de los ingresos de MP y ME (servidor).
 * - Archivo en Blob privado (getFileStorage), nunca en el disco temporal de Vercel; acá la referencia en Neon.
 * - Asociado al id del ingreso (que no cambia al editarlo): editar un ingreso no pierde fotos.
 * - Quién y cuándo lo adjuntó; quitar una foto es soft-delete (el archivo se conserva).
 * - Nunca toca cantidades, movimientos ni stock.
 */
import "server-only";

import { randomUUID } from "node:crypto";
import { and, asc, eq, isNull, sql } from "drizzle-orm";
import { getDb, isDatabaseConfigured } from "@/lib/db/client";
import { invMeIngresos, invMpIngresos, inventoryIngresoAdjuntos } from "@/lib/db/schema";
import { getFileStorage, safeFileName, STORAGE_PROVIDER_VERCEL_BLOB_PRIVATE } from "@/lib/storage/file-storage";
import { InventoryForbiddenError, InventoryNotFoundError, InventoryValidationError } from "@/lib/inventory/inventory-service";
import type { SectorId } from "@/types/operational/sector";
import {
  ADJUNTO_MAX_PER_INGRESO,
  canManageAdjuntos,
  canViewAdjuntos,
  sniffImageType,
  validateAdjuntoFile,
  type IngresoAdjunto,
  type IngresoAdjuntoModule,
} from "@/lib/inventory/ingreso-adjuntos-rules";

export type AdjuntoActor = { email: string; sector: SectorId };

type Row = IngresoAdjunto & { storageKey: string; sha256: string; deletedAt: string | null; deletedBy: string | null };

/** Persistencia: Neon en la app; memoria en las pruebas unitarias. */
export interface AdjuntosStore {
  ingresoExists(module: IngresoAdjuntoModule, ingresoId: string): Promise<boolean>;
  list(module: IngresoAdjuntoModule, ingresoId: string): Promise<Row[]>;
  countActive(module: IngresoAdjuntoModule, ingresoId: string): Promise<number>;
  /** Fotos activas por ingreso, de todo el módulo (para marcar las filas con remito). */
  countsByIngreso(module: IngresoAdjuntoModule): Promise<Record<string, number>>;
  insert(row: Row): Promise<void>;
  get(id: string): Promise<Row | null>;
  softDelete(id: string, by: string): Promise<void>;
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function toPublic(r: Row): IngresoAdjunto {
  return {
    id: r.id,
    module: r.module,
    ingresoId: r.ingresoId,
    fileName: r.fileName,
    contentType: r.contentType,
    sizeBytes: r.sizeBytes,
    uploadedBy: r.uploadedBy,
    uploadedBySector: r.uploadedBySector,
    uploadedAt: r.uploadedAt,
  };
}

export class IngresoAdjuntosService {
  constructor(private readonly store: AdjuntosStore) {}

  private async requireIngreso(module: IngresoAdjuntoModule, ingresoId: string) {
    if (!UUID_RE.test(ingresoId) || !(await this.store.ingresoExists(module, ingresoId))) {
      throw new InventoryNotFoundError(module === "MP" ? "No se encontró el ingreso de MP." : "No se encontró el ingreso de ME.");
    }
  }

  async list(actor: AdjuntoActor, module: IngresoAdjuntoModule, ingresoId: string): Promise<IngresoAdjunto[]> {
    if (!canViewAdjuntos(actor.sector, module)) throw new InventoryForbiddenError("No tenés permiso para ver estos remitos.");
    if (!UUID_RE.test(ingresoId)) return [];
    return (await this.store.list(module, ingresoId)).filter((r) => !r.deletedAt).map(toPublic);
  }

  async counts(actor: AdjuntoActor, module: IngresoAdjuntoModule): Promise<Record<string, number>> {
    if (!canViewAdjuntos(actor.sector, module)) throw new InventoryForbiddenError("No tenés permiso para ver estos remitos.");
    return this.store.countsByIngreso(module);
  }

  async upload(
    actor: AdjuntoActor,
    params: { module: IngresoAdjuntoModule; ingresoId: string; fileName: string; contentType: string; bytes: Uint8Array }
  ): Promise<IngresoAdjunto> {
    if (!canManageAdjuntos(actor.sector, params.module)) {
      throw new InventoryForbiddenError("No tenés permiso para adjuntar remitos en este módulo.");
    }
    await this.requireIngreso(params.module, params.ingresoId);
    const valid = validateAdjuntoFile({ name: params.fileName, type: params.contentType, size: params.bytes.length });
    if (!valid.ok) throw new InventoryValidationError(valid.message);
    const sniffed = sniffImageType(params.bytes);
    if (!sniffed) throw new InventoryValidationError(`«${params.fileName}» no es una imagen JPG, PNG o HEIC válida.`);
    if ((await this.store.countActive(params.module, params.ingresoId)) >= ADJUNTO_MAX_PER_INGRESO) {
      throw new InventoryValidationError(`Este ingreso ya tiene ${ADJUNTO_MAX_PER_INGRESO} fotos (máximo).`);
    }
    const id = randomUUID();
    const storageKey = `ingresos-remitos/${params.module.toLowerCase()}/${params.ingresoId}/${id}-${safeFileName(params.fileName)}`;
    const storage = getFileStorage();
    const put = await storage.put({ storageKey, bytes: params.bytes, contentType: sniffed });
    const row: Row = {
      id,
      module: params.module,
      ingresoId: params.ingresoId,
      fileName: params.fileName.slice(0, 200),
      contentType: sniffed,
      sizeBytes: put.sizeBytes,
      sha256: put.sha256,
      storageKey,
      uploadedBy: actor.email,
      uploadedBySector: actor.sector,
      uploadedAt: new Date().toISOString(),
      deletedAt: null,
      deletedBy: null,
    };
    try {
      await this.store.insert(row);
    } catch (err) {
      // Sin referencia guardada, el archivo no sirve: se borra para no dejar basura.
      await storage.delete(storageKey).catch(() => {});
      throw err;
    }
    return toPublic(row);
  }

  async download(actor: AdjuntoActor, id: string): Promise<{ adjunto: IngresoAdjunto; bytes: Buffer }> {
    const row = UUID_RE.test(id) ? await this.store.get(id) : null;
    if (!row || row.deletedAt) throw new InventoryNotFoundError("Foto no encontrada.");
    if (!canViewAdjuntos(actor.sector, row.module)) throw new InventoryForbiddenError("No tenés permiso para ver este remito.");
    const file = await getFileStorage().get(row.storageKey);
    return { adjunto: toPublic(row), bytes: file.bytes };
  }

  async remove(actor: AdjuntoActor, id: string): Promise<void> {
    const row = UUID_RE.test(id) ? await this.store.get(id) : null;
    if (!row) throw new InventoryNotFoundError("Foto no encontrada.");
    if (!canManageAdjuntos(actor.sector, row.module)) throw new InventoryForbiddenError("No tenés permiso para quitar esta foto.");
    if (row.deletedAt) return; // idempotente
    await this.store.softDelete(id, actor.email);
  }
}

class DbAdjuntosStore implements AdjuntosStore {
  async ingresoExists(module: IngresoAdjuntoModule, ingresoId: string) {
    const table = module === "MP" ? invMpIngresos : invMeIngresos;
    const [row] = await getDb().select({ id: table.id }).from(table).where(eq(table.id, ingresoId)).limit(1);
    return Boolean(row);
  }
  async list(module: IngresoAdjuntoModule, ingresoId: string) {
    const rows = await getDb()
      .select()
      .from(inventoryIngresoAdjuntos)
      .where(and(eq(inventoryIngresoAdjuntos.module, module), eq(inventoryIngresoAdjuntos.ingresoId, ingresoId)))
      .orderBy(asc(inventoryIngresoAdjuntos.uploadedAt));
    return rows.map(fromDb);
  }
  async countActive(module: IngresoAdjuntoModule, ingresoId: string) {
    const [r] = await getDb()
      .select({ n: sql<number>`count(*)::int` })
      .from(inventoryIngresoAdjuntos)
      .where(
        and(
          eq(inventoryIngresoAdjuntos.module, module),
          eq(inventoryIngresoAdjuntos.ingresoId, ingresoId),
          isNull(inventoryIngresoAdjuntos.deletedAt)
        )
      );
    return Number(r?.n ?? 0);
  }
  async countsByIngreso(module: IngresoAdjuntoModule) {
    const rows = await getDb()
      .select({ ingresoId: inventoryIngresoAdjuntos.ingresoId, n: sql<number>`count(*)::int` })
      .from(inventoryIngresoAdjuntos)
      .where(and(eq(inventoryIngresoAdjuntos.module, module), isNull(inventoryIngresoAdjuntos.deletedAt)))
      .groupBy(inventoryIngresoAdjuntos.ingresoId);
    return Object.fromEntries(rows.map((r) => [r.ingresoId, Number(r.n)]));
  }
  async insert(row: Row) {
    await getDb().insert(inventoryIngresoAdjuntos).values({
      id: row.id,
      module: row.module,
      ingresoId: row.ingresoId,
      storageProvider: STORAGE_PROVIDER_VERCEL_BLOB_PRIVATE,
      storageKey: row.storageKey,
      fileName: row.fileName,
      contentType: row.contentType,
      sizeBytes: row.sizeBytes,
      sha256: row.sha256,
      uploadedBy: row.uploadedBy,
      uploadedBySector: row.uploadedBySector,
      uploadedAt: new Date(row.uploadedAt),
    });
  }
  async get(id: string) {
    const [r] = await getDb().select().from(inventoryIngresoAdjuntos).where(eq(inventoryIngresoAdjuntos.id, id)).limit(1);
    return r ? fromDb(r) : null;
  }
  async softDelete(id: string, by: string) {
    await getDb()
      .update(inventoryIngresoAdjuntos)
      .set({ deletedAt: new Date(), deletedBy: by })
      .where(and(eq(inventoryIngresoAdjuntos.id, id), isNull(inventoryIngresoAdjuntos.deletedAt)));
  }
}

function fromDb(r: typeof inventoryIngresoAdjuntos.$inferSelect): Row {
  return {
    id: r.id,
    module: r.module as IngresoAdjuntoModule,
    ingresoId: r.ingresoId,
    fileName: r.fileName,
    contentType: r.contentType,
    sizeBytes: r.sizeBytes,
    sha256: r.sha256,
    storageKey: r.storageKey,
    uploadedBy: r.uploadedBy,
    uploadedBySector: r.uploadedBySector,
    uploadedAt: r.uploadedAt.toISOString(),
    deletedAt: r.deletedAt ? r.deletedAt.toISOString() : null,
    deletedBy: r.deletedBy,
  };
}

/** Solo pruebas unitarias. */
export class MemoryAdjuntosStore implements AdjuntosStore {
  rows: Row[] = [];
  ingresos = new Set<string>();
  async ingresoExists(module: IngresoAdjuntoModule, ingresoId: string) {
    return this.ingresos.has(`${module}:${ingresoId}`);
  }
  async list(module: IngresoAdjuntoModule, ingresoId: string) {
    return this.rows.filter((r) => r.module === module && r.ingresoId === ingresoId);
  }
  async countActive(module: IngresoAdjuntoModule, ingresoId: string) {
    return (await this.list(module, ingresoId)).filter((r) => !r.deletedAt).length;
  }
  async countsByIngreso(module: IngresoAdjuntoModule) {
    const out: Record<string, number> = {};
    for (const r of this.rows) if (r.module === module && !r.deletedAt) out[r.ingresoId] = (out[r.ingresoId] ?? 0) + 1;
    return out;
  }
  async insert(row: Row) {
    this.rows.push(row);
  }
  async get(id: string) {
    return this.rows.find((r) => r.id === id) ?? null;
  }
  async softDelete(id: string, by: string) {
    const r = this.rows.find((x) => x.id === id);
    if (r && !r.deletedAt) Object.assign(r, { deletedAt: new Date().toISOString(), deletedBy: by });
  }
}

export function getIngresoAdjuntosService(): IngresoAdjuntosService {
  if (!isDatabaseConfigured()) {
    throw new InventoryValidationError("No hay conexión con la base de datos: no se pueden guardar fotos.");
  }
  return new IngresoAdjuntosService(new DbAdjuntosStore());
}
