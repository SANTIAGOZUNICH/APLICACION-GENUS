/**
 * Carga asistida de ingresos ME desde remito.
 *
 *   archivos → IA (propone) → validación estricta → matching contra catálogo real →
 *   PREVIEW editable → confirmación humana → ingreso canónico (InventoryService.upsertMeIngreso)
 *
 * La IA nunca toca stock: la única vía a inventario es `upsertMeIngreso` tras confirmar.
 */
import { createHash, randomUUID } from "node:crypto";
import type { FileStorageAdapter } from "@/lib/storage/file-storage";
import { safeFileName } from "@/lib/storage/file-storage";
import {
  InventoryNotFoundError,
  InventoryValidationError,
  type InventoryActor,
  type InventoryService,
} from "../inventory-service";
import type { MemoryInventoryRepo } from "../memory-repo";
import type { MeIngresoRow } from "../types";
import {
  assertReadable,
  parseRemitoDate,
  validateRemitoExtraction,
} from "./extraction";
import { aliasKey, matchRemitoItem } from "./matching";
import {
  capacityNumbers,
  normalizeKey,
  normalizeRemitoNumber,
  parseCantidadRemito,
} from "./normalize";
import type { RemitoReader, RemitoReaderFile } from "./reader";
import type {
  MeRemitoAlias,
  MeRemitoCorrection,
  MeRemitoDoc,
  MeRemitoFileRef,
  MeRemitoLine,
  RemitoExtractionItem,
} from "./types";

export const REMITO_ALLOWED_TYPES = ["image/jpeg", "image/png", "image/webp", "application/pdf"] as const;
export const REMITO_MAX_FILES = 8;
/** Vercel Functions limita el body a 4.5 MB: el cliente comprime las fotos antes de subir. */
export const REMITO_MAX_TOTAL_BYTES = 4_400_000;
export const MAX_CANTIDAD_LINEA = 10_000_000;

export class RemitoDuplicateError extends InventoryValidationError {
  status = 409;
  code = "REMITO_DUPLICADO";
  duplicate: RemitoDuplicateInfo;
  constructor(duplicate: RemitoDuplicateInfo) {
    super("ESTE REMITO YA FUE CARGADO.");
    this.name = "RemitoDuplicateError";
    this.duplicate = duplicate;
  }
}

export type RemitoDuplicateInfo = {
  docId: string;
  proveedor: string;
  numeroRemito: string;
  confirmedAt: string | null;
  confirmedBy: string | null;
  ingresoIds: string[];
  ingresoNros: string[];
  /** "NUMERO" = proveedor + N° de remito; "ARCHIVO" = mismo documento re-subido. */
  motivo: "NUMERO" | "ARCHIVO";
};

export type RemitoPreview = {
  docId: string | null;
  header: { proveedor: string; numeroRemito: string; fecha: string | null };
  lines: MeRemitoLine[];
  warnings: string[];
  duplicate: RemitoDuplicateInfo | null;
  ia: { provider: string; model: string } | null;
};

export type ConfirmLineInput = {
  lineId: string;
  include: boolean;
  materialId: string | null;
  /** Cantidad FINAL en unidades. */
  cantidad: number | null;
  /** Obligatorio para líneas que requieren conversión (cajas/bultos/kg). */
  conversionConfirmada?: boolean;
};

export type ConfirmInput = {
  docId: string;
  header?: { proveedor?: string; numeroRemito?: string; fecha?: string | null };
  lines: ConfirmLineInput[];
};

export type ConfirmResult = {
  doc: MeRemitoDoc;
  ingresos: MeIngresoRow[];
  stock: Array<{ materialId: string; codigo: string; descripcion: string; stockActual: number; negativo: boolean }>;
};

export type RemitoUploadFile = RemitoReaderFile;

function sniffType(bytes: Buffer): string | null {
  if (bytes.length > 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return "image/jpeg";
  if (bytes.length > 7 && bytes.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])))
    return "image/png";
  if (bytes.length > 4 && bytes.subarray(0, 5).toString("latin1") === "%PDF-") return "application/pdf";
  if (bytes.length > 12 && bytes.subarray(0, 4).toString("latin1") === "RIFF" && bytes.subarray(8, 12).toString("latin1") === "WEBP")
    return "image/webp";
  return null;
}

export function deterministicUuid(seed: string): string {
  const h = createHash("sha256").update(seed).digest("hex");
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-4${h.slice(13, 16)}-a${h.slice(17, 20)}-${h.slice(20, 32)}`;
}

function sha256(bytes: Buffer): string {
  return createHash("sha256").update(bytes).digest("hex");
}

export type RemitoServiceDeps = {
  reader: RemitoReader | (() => RemitoReader);
  storage: FileStorageAdapter | (() => FileStorageAdapter);
  now?: () => Date;
};

export class MeRemitoIngresoService {
  constructor(
    private readonly inv: InventoryService,
    private readonly repo: MemoryInventoryRepo,
    private readonly deps: RemitoServiceDeps
  ) {}

  private now() {
    return (this.deps.now ?? (() => new Date()))();
  }
  private reader(): RemitoReader {
    return typeof this.deps.reader === "function" ? this.deps.reader() : this.deps.reader;
  }
  private storage(): FileStorageAdapter {
    return typeof this.deps.storage === "function" ? this.deps.storage() : this.deps.storage;
  }

  // ─── Duplicados ────────────────────────────────────────────

  findDuplicate(params: {
    proveedorNorm: string;
    numeroRemitoNorm: string;
    filesSha?: string;
    excludeDocId?: string;
  }): RemitoDuplicateInfo | null {
    const confirmed = this.repo.listMeRemitoDocs().filter((d) => d.status === "CONFIRMADO" && d.id !== params.excludeDocId);
    let hit: MeRemitoDoc | undefined;
    let motivo: RemitoDuplicateInfo["motivo"] = "NUMERO";
    if (params.numeroRemitoNorm && params.proveedorNorm) {
      hit = confirmed.find(
        (d) => d.numeroRemitoNorm === params.numeroRemitoNorm && d.proveedorNorm === params.proveedorNorm
      );
    }
    if (!hit && params.filesSha) {
      hit = confirmed.find((d) => d.filesSha === params.filesSha);
      motivo = "ARCHIVO";
    }
    if (!hit) return null;
    const ingresos = this.repo.listMeIngresos().filter((i) => hit!.ingresoIds.includes(i.id));
    return {
      docId: hit.id,
      proveedor: hit.proveedor,
      numeroRemito: hit.numeroRemito,
      confirmedAt: hit.confirmedAt,
      confirmedBy: hit.confirmedBy,
      ingresoIds: hit.ingresoIds,
      ingresoNros: ingresos.map((i) => i.ingresoNro),
      motivo,
    };
  }

  // ─── Analizar (propone, no guarda movimientos) ─────────────

  async analyze(actor: InventoryActor, files: RemitoUploadFile[]): Promise<RemitoPreview> {
    this.inv.assertCanWriteMeIngresos(actor);
    if (files.length === 0) throw new InventoryValidationError("Subí al menos una foto o PDF del remito.");
    if (files.length > REMITO_MAX_FILES) {
      throw new InventoryValidationError(`Máximo ${REMITO_MAX_FILES} páginas por remito.`);
    }
    const total = files.reduce((acc, f) => acc + f.bytes.length, 0);
    if (total > REMITO_MAX_TOTAL_BYTES) {
      throw new InventoryValidationError("Los archivos superan el tamaño máximo permitido (4,4 MB en total).");
    }
    const checked: RemitoUploadFile[] = files.map((f) => {
      const real = sniffType(f.bytes);
      if (!real || !(REMITO_ALLOWED_TYPES as readonly string[]).includes(real)) {
        throw new InventoryValidationError("Solo se aceptan fotos JPG/PNG/WEBP o PDF.");
      }
      return { bytes: f.bytes, contentType: real, name: safeFileName(f.name || "remito") };
    });

    const hashes = checked.map((f) => sha256(f.bytes));
    const filesSha = sha256(Buffer.from([...hashes].sort().join(":")));

    // Mismo documento ya cargado: no se gasta IA ni se vuelve a procesar.
    const sameFile = this.findDuplicate({ proveedorNorm: "", numeroRemitoNorm: "", filesSha });
    if (sameFile) {
      return {
        docId: null,
        header: { proveedor: sameFile.proveedor, numeroRemito: sameFile.numeroRemito, fecha: null },
        lines: [],
        warnings: [],
        duplicate: sameFile,
        ia: null,
      };
    }

    const reader = this.reader();
    const raw = await reader.read(checked);
    const extraction = validateRemitoExtraction(raw, this.now());
    assertReadable(extraction);

    const proveedorNorm = normalizeKey(extraction.proveedor);
    const numeroRemitoNorm = normalizeRemitoNumber(extraction.numeroRemito);
    const duplicate = this.findDuplicate({ proveedorNorm, numeroRemitoNorm });
    const warnings: string[] = [];
    if (duplicate) {
      return {
        docId: null,
        header: { proveedor: extraction.proveedor, numeroRemito: extraction.numeroRemito, fecha: extraction.fecha },
        lines: [],
        warnings,
        duplicate,
        ia: reader.info,
      };
    }
    if (!numeroRemitoNorm) {
      warnings.push("No se pudo leer el número de remito: no se puede garantizar la detección de duplicados.");
    }
    if (!proveedorNorm) warnings.push("No se pudo leer el proveedor: completalo antes de confirmar.");
    if (!extraction.fecha) warnings.push("No se pudo leer la fecha del remito: se usará la fecha de hoy si no la completás.");

    const docId = randomUUID();
    const lines = this.buildLines(docId, extraction.proveedor, extraction.items);

    // Original del remito → storage privado existente (nunca base64 en la base).
    const storage = this.storage();
    const refs: MeRemitoFileRef[] = [];
    for (let i = 0; i < checked.length; i++) {
      const f = checked[i]!;
      const put = await storage.put({
        storageKey: `remitos-ingreso/${docId}/${i + 1}-${f.name}`,
        bytes: f.bytes,
        contentType: f.contentType,
      });
      refs.push({
        storageKey: put.storageKey,
        name: f.name,
        contentType: f.contentType,
        sizeBytes: put.sizeBytes,
        sha256: put.sha256,
      });
    }

    const now = this.now().toISOString();
    const doc: MeRemitoDoc = {
      id: docId,
      status: "ANALIZADO",
      proveedor: extraction.proveedor,
      proveedorNorm,
      numeroRemito: extraction.numeroRemito,
      numeroRemitoNorm,
      fecha: extraction.fecha,
      files: refs,
      filesSha,
      lines,
      warnings,
      ia: reader.info,
      createdBy: actor.email,
      createdAt: now,
      confirmedBy: null,
      confirmedAt: null,
      ingresoIds: [],
      corrections: [],
      confirmedLines: [],
    };
    this.repo.upsertMeRemitoDoc(doc);
    this.inv.recordAudit(actor, "me_remito_ia", docId, "analyze", null, {
      proveedor: doc.proveedor,
      numeroRemito: doc.numeroRemito,
      lineas: lines.length,
      archivos: refs.length,
      ia: doc.ia,
    });
    return {
      docId,
      header: { proveedor: doc.proveedor, numeroRemito: doc.numeroRemito, fecha: doc.fecha },
      lines,
      warnings,
      duplicate: null,
      ia: doc.ia,
    };
  }

  private buildLines(docId: string, proveedor: string, items: RemitoExtractionItem[]): MeRemitoLine[] {
    const catalog = this.repo.listMeMaterials();
    const aliases = this.repo.listMeRemitoAliases();
    const seen = new Set<string>();
    return items.map((item, idx) => {
      const match = matchRemitoItem({ item, proveedor, catalog, aliases });
      const warnings = [...match.warnings];
      const cantidad = parseCantidadRemito(item.cantidadTexto);
      let revisarCantidad = false;
      let requiereConversion = false;

      if (cantidad == null || cantidad <= 0) {
        warnings.push("No se pudo leer la cantidad: ingresala a mano.");
        revisarCantidad = true;
      }
      if (item.unidad !== "UN" && item.unidad !== null) {
        requiereConversion = true;
        warnings.push(
          item.unidad === "OTRO"
            ? `Unidad "${item.unidadOriginal}" desconocida: indicá las unidades a ingresar (REQUIERE CONVERSIÓN).`
            : `Viene en ${item.unidadOriginal || item.unidad}: indicá cuántas UNIDADES ingresan (REQUIERE CONVERSIÓN). No se asume 1 por 1.`
        );
      }
      if (item.unidad === null && item.unidadOriginal === "") {
        warnings.push("El remito no indica unidad: verificá que la cantidad sea en unidades.");
      }
      if (cantidad != null && !requiereConversion && capacityNumbers(item.descripcionOriginal).includes(cantidad)) {
        warnings.push(`La cantidad (${cantidad}) coincide con la medida del envase en la descripción: verificá que no sea la capacidad.`);
        revisarCantidad = true;
      }

      const dupKey = `${normalizeKey(item.descripcionOriginal)}|${item.codigoProveedor}|${cantidad}`;
      let includeDefault = true;
      if (seen.has(dupKey)) {
        warnings.push("Línea idéntica a una anterior (¿repetida entre páginas?): excluida por defecto, revisala.");
        includeDefault = false;
      }
      seen.add(dupKey);

      return {
        id: `${docId.slice(0, 8)}-${idx + 1}`,
        descripcionOriginal: item.descripcionOriginal,
        codigoProveedor: item.codigoProveedor,
        cantidadTexto: item.cantidadTexto,
        cantidadInterpretada: cantidad != null && cantidad > 0 ? cantidad : null,
        unidad: item.unidad,
        unidadOriginal: item.unidadOriginal,
        requiereConversion,
        materialSugeridoId: match.materialId,
        confianza: match.confianza,
        matchSource: match.source,
        candidates: match.candidates,
        warnings,
        revisarCantidad,
        includeDefault,
      };
    });
  }

  // ─── Confirmar (único punto que crea ingresos) ─────────────

  confirm(actor: InventoryActor, input: ConfirmInput): ConfirmResult {
    this.inv.assertCanWriteMeIngresos(actor);
    const doc = this.repo.getMeRemitoDoc(input.docId);
    if (!doc) throw new InventoryNotFoundError("Remito no encontrado. Volvé a analizarlo.");
    if (doc.status === "CONFIRMADO") {
      throw new RemitoDuplicateError({
        docId: doc.id,
        proveedor: doc.proveedor,
        numeroRemito: doc.numeroRemito,
        confirmedAt: doc.confirmedAt,
        confirmedBy: doc.confirmedBy,
        ingresoIds: doc.ingresoIds,
        ingresoNros: this.repo
          .listMeIngresos()
          .filter((i) => doc.ingresoIds.includes(i.id))
          .map((i) => i.ingresoNro),
        motivo: "NUMERO",
      });
    }

    const corrections: MeRemitoCorrection[] = [];
    const proveedor = (input.header?.proveedor ?? doc.proveedor).replace(/\s+/g, " ").trim();
    const numeroRemito = (input.header?.numeroRemito ?? doc.numeroRemito).replace(/\s+/g, " ").trim();
    let fecha = doc.fecha;
    if (input.header && "fecha" in input.header) {
      const raw = input.header.fecha ?? "";
      const parsed = raw ? parseRemitoDate(raw, this.now()) : null;
      if (raw && !parsed) throw new InventoryValidationError("La fecha del remito no es válida.");
      fecha = parsed;
    }
    if (!proveedor) throw new InventoryValidationError("Completá el proveedor del remito.");
    if (proveedor !== doc.proveedor) {
      corrections.push({ lineId: "*", campo: "proveedor", interpretado: doc.proveedor, confirmado: proveedor });
    }
    if (numeroRemito !== doc.numeroRemito) {
      corrections.push({ lineId: "*", campo: "numeroRemito", interpretado: doc.numeroRemito, confirmado: numeroRemito });
    }
    if (fecha !== doc.fecha) {
      corrections.push({ lineId: "*", campo: "fecha", interpretado: doc.fecha, confirmado: fecha });
    }

    const proveedorNorm = normalizeKey(proveedor);
    const numeroRemitoNorm = normalizeRemitoNumber(numeroRemito);
    // El proveedor/N° pudieron corregirse: re-chequear duplicado con los datos CONFIRMADOS.
    const dup = this.findDuplicate({ proveedorNorm, numeroRemitoNorm, excludeDocId: doc.id });
    if (dup) throw new RemitoDuplicateError(dup);

    const byLine = new Map(input.lines.map((l) => [l.lineId, l]));
    const included: Array<{ line: MeRemitoLine; input: ConfirmLineInput; materialId: string; cantidad: number }> = [];
    const confirmedLines: MeRemitoDoc["confirmedLines"] = [];

    for (const line of doc.lines) {
      const li = byLine.get(line.id);
      if (!li || !li.include) {
        confirmedLines.push({ lineId: line.id, incluida: false, materialId: null, cantidad: null, ingresoId: null });
        if (line.includeDefault) {
          corrections.push({ lineId: line.id, campo: "excluida", interpretado: "incluida", confirmado: "excluida" });
        }
        continue;
      }
      if (!li.materialId) {
        throw new InventoryValidationError(`Elegí el material de la línea "${line.descripcionOriginal}" o excluila.`);
      }
      const mat = this.repo.getMeMaterial(li.materialId);
      if (!mat || mat.archived || !mat.codigo.trim()) {
        throw new InventoryValidationError(`El material elegido para "${line.descripcionOriginal}" no existe en el catálogo.`);
      }
      const cantidad = li.cantidad;
      if (cantidad == null || !Number.isFinite(cantidad) || cantidad <= 0 || cantidad > MAX_CANTIDAD_LINEA) {
        throw new InventoryValidationError(`Cantidad inválida en "${line.descripcionOriginal}".`);
      }
      if (line.requiereConversion && !li.conversionConfirmada) {
        throw new InventoryValidationError(
          `"${line.descripcionOriginal}" viene en ${line.unidadOriginal || "otra unidad"}: confirmá las unidades a ingresar.`
        );
      }
      if (!line.includeDefault) {
        corrections.push({ lineId: line.id, campo: "excluida", interpretado: "excluida", confirmado: "incluida" });
      }
      if (cantidad !== line.cantidadInterpretada) {
        corrections.push({ lineId: line.id, campo: "cantidad", interpretado: line.cantidadInterpretada, confirmado: cantidad });
      }
      if (li.materialId !== line.materialSugeridoId) {
        corrections.push({ lineId: line.id, campo: "material", interpretado: line.materialSugeridoId, confirmado: li.materialId });
      }
      included.push({ line, input: li, materialId: li.materialId, cantidad });
    }
    if (included.length === 0) throw new InventoryValidationError("No hay líneas para ingresar.");

    const nowIso = this.now().toISOString();
    const fechaIngreso = fecha ?? nowIso.slice(0, 10);
    const ingresos: MeIngresoRow[] = [];

    for (const { line, materialId, cantidad } of included) {
      const mat = this.repo.getMeMaterial(materialId)!;
      // MISMO flujo canónico de ingreso → ledger → recálculo de stock. Id determinístico:
      // reintentar la confirmación no duplica el movimiento.
      const ingresoId = deterministicUuid(`${doc.id}:${line.id}`);
      const row = this.inv.upsertMeIngreso(actor, {
        id: ingresoId,
        fecha: fechaIngreso,
        proveedor,
        remitoNro: numeroRemito,
        cliente: mat.cliente,
        codigo: mat.codigo,
        descripcionInsumo: mat.descripcion,
        materialId: mat.id,
        bultos: 1,
        cantidad,
        ubicacion: mat.ubicacion,
        source: "REMITO_AI",
        remitoDocumentoId: doc.id,
        remitoLineaId: line.id,
        remitoFecha: fecha,
        descripcionOriginal: line.descripcionOriginal,
        cantidadInterpretada: line.cantidadInterpretada,
        materialSugeridoId: line.materialSugeridoId,
        confirmadoPor: actor.email,
        confirmadoAt: nowIso,
      });
      ingresos.push(row);
      confirmedLines.push({ lineId: line.id, incluida: true, materialId: mat.id, cantidad, ingresoId: row.id });
      this.learnAlias(actor, proveedor, proveedorNorm, line, mat.id, mat.codigo, nowIso);
    }

    const confirmed: MeRemitoDoc = {
      ...doc,
      status: "CONFIRMADO",
      proveedor,
      proveedorNorm,
      numeroRemito,
      numeroRemitoNorm,
      fecha,
      confirmedBy: actor.email,
      confirmedAt: nowIso,
      ingresoIds: ingresos.map((i) => i.id),
      corrections,
      confirmedLines,
    };
    this.repo.upsertMeRemitoDoc(confirmed);
    this.inv.recordAudit(
      actor,
      "me_remito_ia",
      doc.id,
      "confirm",
      { status: "ANALIZADO", lineas: doc.lines.length },
      {
        status: "CONFIRMADO",
        ingresos: ingresos.map((i) => i.id),
        correcciones: corrections.length,
        proveedor,
        numeroRemito,
      }
    );

    const mats = [...new Set(included.map((i) => i.materialId))].map((id) => this.repo.getMeMaterial(id)!);
    return {
      doc: confirmed,
      ingresos,
      stock: mats.map((m) => ({
        materialId: m.id,
        codigo: m.codigo,
        descripcion: m.descripcion,
        stockActual: m.stockActual,
        negativo: m.stockActual < 0,
      })),
    };
  }

  /** Aprende SOLO de líneas que un humano confirmó (guardadas). Tabla auditable, no un modelo. */
  private learnAlias(
    actor: InventoryActor,
    proveedor: string,
    proveedorNorm: string,
    line: MeRemitoLine,
    materialId: string,
    materialCodigo: string,
    at: string
  ) {
    const descripcionNorm = normalizeKey(line.descripcionOriginal);
    if (!proveedorNorm || !descripcionNorm) return;
    const id = deterministicUuid(`alias:${aliasKey(proveedor, line.descripcionOriginal)}`);
    const existing = this.repo.listMeRemitoAliases().find((a) => a.id === id);
    const alias: MeRemitoAlias = existing
      ? {
          ...existing,
          materialId,
          materialCodigo,
          confirmedBy: actor.email,
          confirmedAt: at,
          timesConfirmed: existing.timesConfirmed + 1,
          history:
            existing.materialId === materialId
              ? existing.history
              : [...existing.history, { materialId: existing.materialId, at: existing.confirmedAt, by: existing.confirmedBy }],
        }
      : {
          id,
          proveedorNorm,
          proveedorOriginal: proveedor,
          descripcionNorm,
          descripcionOriginal: line.descripcionOriginal,
          materialId,
          materialCodigo,
          confirmedBy: actor.email,
          confirmedAt: at,
          timesConfirmed: 1,
          history: [],
        };
    this.repo.upsertMeRemitoAlias(alias);
  }

  // ─── Evidencia: documento original ─────────────────────────

  async getDocumentFile(actor: InventoryActor, docId: string, index = 0) {
    this.inv.assertCanReadMeIngresos(actor);
    const doc = this.repo.getMeRemitoDoc(docId);
    const ref = doc?.files[index];
    if (!doc || !ref) throw new InventoryNotFoundError("Documento de remito no encontrado.");
    const file = await this.storage().get(ref.storageKey);
    return { bytes: file.bytes, contentType: ref.contentType, name: ref.name, pages: doc.files.length };
  }
}
