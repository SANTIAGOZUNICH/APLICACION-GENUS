/**
 * Banco privado de fórmulas — servicio en memoria (tests) / Neon (import).
 * No expone listado completo del banco.
 */

import { createHash, randomUUID } from "node:crypto";
import {
  normalizeSearchKey,
  looksLikeCopyName,
  isPendingClient,
  isPendingProduct,
  type FormulaProductRecord,
  type FormulaSnapshot,
  type FormulaVersionRecord,
  type ParsedFormulaDraft,
} from "./types";
import {
  findUniqueExactProduct,
  listActiveFormulaOptions,
  type FormulaOption,
} from "./formula-options";

export class FormulaBankForbiddenError extends Error {
  status = 403;
  code = "FORBIDDEN";
  constructor(message: string) {
    super(message);
    this.name = "FormulaBankForbiddenError";
  }
}

export class FormulaBankNotFoundError extends Error {
  status = 404;
  code = "NOT_FOUND";
  constructor(message: string) {
    super(message);
    this.name = "FormulaBankNotFoundError";
  }
}

export class MemoryFormulaBank {
  products: FormulaProductRecord[] = [];
  versions: FormulaVersionRecord[] = [];
  importRunHashes = new Set<string>();

  reset() {
    this.products = [];
    this.versions = [];
    this.importRunHashes = new Set();
  }
}

export class FormulaBankService {
  constructor(private readonly store: MemoryFormulaBank) {}

  hasImportedArchive(hash: string) {
    return this.store.importRunHashes.has(hash);
  }

  markArchiveImported(hash: string) {
    this.store.importRunHashes.add(hash);
  }

  /** Opciones activas para combobox (sin ingredientes/%/procedimiento). */
  listActiveOptions(): FormulaOption[] {
    return listActiveFormulaOptions(this.store.products, this.store.versions);
  }

  /**
   * Resultado de resolución por cliente+producto.
   * Coincidencia exacta normalizada (display o alias). Nunca fuzzy silencioso.
   */
  resolveLookup(
    client: string,
    product: string
  ):
    | { kind: "found"; snapshot: FormulaSnapshot }
    | { kind: "conflict"; code: string; message: string; reason?: string }
    | {
        kind: "not_found";
        message: string;
        reason?:
          | "name_mismatch"
          | "no_active"
          | "pending_client"
          | "pending_product"
          | "review_required"
          | "ambiguous";
      } {
    const nc = normalizeSearchKey(client);
    const np = normalizeSearchKey(product);
    if (!nc || !np) {
      return {
        kind: "not_found",
        reason: "name_mismatch",
        message: "No se encontró por diferencia de nombre.",
      };
    }
    if (isPendingClient(client)) {
      return {
        kind: "not_found",
        reason: "pending_client",
        message: "Cliente pendiente: la fórmula no está disponible para OE.",
      };
    }
    if (isPendingProduct(product)) {
      return {
        kind: "not_found",
        reason: "pending_product",
        message: "Producto pendiente: la fórmula no está disponible para OE.",
      };
    }

    // 1) Match canónico display normalizado
    let prod = this.store.products.find(
      (p) => p.normalizedClient === nc && p.normalizedProduct === np
    );

    // 2) Alias exacto único (filename/sheet/código) — sin fuzzy
    if (!prod) {
      const options = this.listActiveOptions();
      const byAlias = findUniqueExactProduct(options, client, product);
      if (byAlias) {
        prod = this.store.products.find((p) => p.id === byAlias.productId);
      } else {
        const clientHits = options.filter(
          (o) => normalizeSearchKey(o.client) === nc
        );
        const multi = clientHits.filter((o) => {
          const keys = [o.productLabel, o.code, ...o.aliases].map(normalizeSearchKey);
          return keys.includes(np);
        });
        if (multi.length > 1) {
          return {
            kind: "not_found",
            reason: "ambiguous",
            message: "Hay varias coincidencias: elegí una.",
          };
        }
      }
    }

    if (!prod) {
      return {
        kind: "not_found",
        reason: "name_mismatch",
        message: "No se encontró por diferencia de nombre.",
      };
    }
    return this.resolveProductRecord(prod);
  }

  /** Resolución inequívoca por productId (selector). */
  resolveByProductId(
    productId: string
  ):
    | { kind: "found"; snapshot: FormulaSnapshot }
    | { kind: "conflict"; code: string; message: string; reason?: string }
    | {
        kind: "not_found";
        message: string;
        reason?:
          | "name_mismatch"
          | "no_active"
          | "pending_client"
          | "pending_product"
          | "review_required"
          | "ambiguous";
      } {
    const prod = this.store.products.find((p) => p.id === productId);
    if (!prod) {
      return {
        kind: "not_found",
        reason: "no_active",
        message: "Producto sin fórmula activa.",
      };
    }
    return this.resolveProductRecord(prod);
  }

  private resolveProductRecord(
    prod: FormulaProductRecord
  ):
    | { kind: "found"; snapshot: FormulaSnapshot }
    | { kind: "conflict"; code: string; message: string; reason?: string }
    | {
        kind: "not_found";
        message: string;
        reason?:
          | "name_mismatch"
          | "no_active"
          | "pending_client"
          | "pending_product"
          | "review_required"
          | "ambiguous";
      } {
    if (isPendingClient(prod.displayClient)) {
      return {
        kind: "not_found",
        reason: "pending_client",
        message: "Cliente pendiente: la fórmula no está disponible para OE.",
      };
    }
    if (!prod.activeVersionId) {
      const tied = this.store.versions.find(
        (v) => v.productId === prod.id && v.conflictCode === "TIED_LATEST_VERSION"
      );
      if (tied) {
        return {
          kind: "conflict",
          code: "TIED_LATEST_VERSION",
          reason: "conflict",
          message:
            "Fórmula excluida por conflicto: existen varias versiones y ninguna fue activada.",
        };
      }
      return {
        kind: "not_found",
        reason: "no_active",
        message: "Producto sin fórmula activa.",
      };
    }
    const ver = this.store.versions.find((v) => v.id === prod.activeVersionId);
    if (!ver || ver.status !== "VIGENTE") {
      return {
        kind: "not_found",
        reason: "no_active",
        message: "Producto sin fórmula activa.",
      };
    }
    if (ver.reviewRequired) {
      return {
        kind: "not_found",
        reason: "review_required",
        message: "Fórmula requiere revisión y no está disponible para OE.",
      };
    }
    return { kind: "found", snapshot: this.toSnapshot(prod, ver) };
  }

  resolveVigente(client: string, product: string): FormulaSnapshot | null {
    const result = this.resolveLookup(client, product);
    return result.kind === "found" ? result.snapshot : null;
  }

  getVersionForAuthorizedOrder(versionId: string): FormulaSnapshot | null {
    const ver = this.store.versions.find((v) => v.id === versionId);
    if (!ver) return null;
    const prod = this.store.products.find((p) => p.id === ver.productId);
    if (!prod) return null;
    return this.toSnapshot(prod, ver);
  }

  /**
   * Incorpora borradores parseados: dedupe hash/semántica, vigencia por fecha archivo.
   * No imprime ingredientes en logs.
   */
  ingestDrafts(
    drafts: ParsedFormulaDraft[],
    opts?: { archiveHash?: string }
  ): {
    inserted: number;
    duplicated: number;
    conflicts: number;
    warnings: number;
    products: number;
  } {
    if (opts?.archiveHash && this.hasImportedArchive(opts.archiveHash)) {
      return {
        inserted: 0,
        duplicated: drafts.length,
        conflicts: 0,
        warnings: 0,
        products: this.store.products.length,
      };
    }

    // Agrupar por semantic hash primero (copias idénticas)
    const bySemantic = new Map<string, ParsedFormulaDraft>();
    for (const d of drafts) {
      const prev = bySemantic.get(d.semanticHash);
      if (!prev) {
        bySemantic.set(d.semanticHash, { ...d, altSourcePaths: [...d.altSourcePaths] });
        continue;
      }
      prev.altSourcePaths = [
        ...new Set([...prev.altSourcePaths, d.sourceFile, ...d.altSourcePaths]),
      ];
      // Preferir no-copia y fecha más reciente al fusionar metadatos
      const prevTime = prev.sourceModifiedAt ? Date.parse(prev.sourceModifiedAt) : 0;
      const curTime = d.sourceModifiedAt ? Date.parse(d.sourceModifiedAt) : 0;
      if (curTime > prevTime || (curTime === prevTime && looksLikeCopyName(prev.sourceFile) && !looksLikeCopyName(d.sourceFile))) {
        bySemantic.set(d.semanticHash, {
          ...d,
          altSourcePaths: prev.altSourcePaths,
        });
      }
    }

    let inserted = 0;
    let duplicated = drafts.length - bySemantic.size;
    let conflicts = 0;
    let warnings = 0;

    // Agrupar por producto normalizado
    const byProduct = new Map<string, ParsedFormulaDraft[]>();
    for (const d of bySemantic.values()) {
      const key = `${normalizeSearchKey(d.displayClient)}||${normalizeSearchKey(d.displayProduct)}`;
      const list = byProduct.get(key) ?? [];
      list.push(d);
      byProduct.set(key, list);
      warnings += d.warnings.length;
    }

    for (const [, list] of byProduct) {
      const client = list[0]!.displayClient;
      const product = list[0]!.displayProduct;
      const nc = normalizeSearchKey(client);
      const np = normalizeSearchKey(product);
      let prod = this.store.products.find(
        (p) => p.normalizedClient === nc && p.normalizedProduct === np
      );
      if (!prod) {
        prod = {
          id: randomUUID(),
          normalizedClient: nc,
          normalizedProduct: np,
          displayClient: client,
          displayProduct: product,
          productCode: list[0]!.productCode || "",
          activeVersionId: null,
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        };
        this.store.products.push(prod);
      }

      // Ordenar por fecha de modificación del archivo (no import)
      const ranked = [...list].sort((a, b) => {
        const ta = a.sourceModifiedAt ? Date.parse(a.sourceModifiedAt) : 0;
        const tb = b.sourceModifiedAt ? Date.parse(b.sourceModifiedAt) : 0;
        return tb - ta;
      });

      const latestTime = ranked[0]?.sourceModifiedAt
        ? Date.parse(ranked[0].sourceModifiedAt)
        : 0;
      const tied = ranked.filter((d) => {
        const t = d.sourceModifiedAt ? Date.parse(d.sourceModifiedAt) : 0;
        return t === latestTime && d.semanticHash !== ranked[0]!.semanticHash;
      });

      let vigenteDraft = ranked[0]!;
      let conflict: string | null = null;

      if (tied.length > 0) {
        // Desempate por evidencia objetiva, en dos etapas:
        // 1) Pestaña secundaria: hoja "Copia de …" o con sufijo "(2)"/"(3)"
        //    (tab duplicada de Excel). Distingue hojas dentro del MISMO archivo.
        // 2) Nombre de archivo copia ("Copia de …", "… (2).xlsx").
        const isSecondarySheet = (d: ParsedFormulaDraft) =>
          looksLikeCopyName(d.sourceSheet ?? "") ||
          /\(\s*\d+\s*\)\s*$/.test(d.sourceSheet ?? "");
        const group = [vigenteDraft, ...tied];
        const primarySheets = group.filter((d) => !isSecondarySheet(d));
        if (primarySheets.length === 1) {
          vigenteDraft = primarySheets[0]!;
        } else {
          const base = primarySheets.length > 1 ? primarySheets : group;
          const nonCopyFile = base.filter((d) => !looksLikeCopyName(d.sourceFile));
          if (nonCopyFile.length === 1) {
            vigenteDraft = nonCopyFile[0]!;
          } else {
            conflict = "TIED_LATEST_VERSION";
            conflicts += 1;
          }
        }
      }

      let versionNum = this.store.versions.filter((v) => v.productId === prod!.id).length;
      let prevId: string | null = prod.activeVersionId;

      for (const d of ranked) {
        if (this.store.versions.some((v) => v.sourceHash === d.sourceHash || v.semanticHash === d.semanticHash)) {
          duplicated += 1;
          continue;
        }
        versionNum += 1;
        const isVigente = !conflict && d.semanticHash === vigenteDraft.semanticHash;
        const ver: FormulaVersionRecord = {
          id: randomUUID(),
          productId: prod.id,
          version: versionNum,
          status: conflict && d.semanticHash === vigenteDraft.semanticHash
            ? "CONFLICTO"
            : isVigente
              ? "VIGENTE"
              : "HISTORICA",
          sourceFile: d.sourceFile,
          sourceSheet: d.sourceSheet,
          sourceModifiedAt: d.sourceModifiedAt,
          sourceHash: d.sourceHash,
          semanticHash: d.semanticHash,
          importedAt: new Date().toISOString(),
          percentageTotal: d.percentageTotal,
          validationStatus: d.warnings.length ? "WARN" : "OK",
          warnings: d.warnings,
          previousVersionId: prevId,
          conflictCode: conflict && d.semanticHash === vigenteDraft.semanticHash ? conflict : null,
          altSourcePaths: d.altSourcePaths,
          sourceConfidence: d.sourceConfidence,
          expressionType: d.expressionType,
          percentageSource: d.percentageSource,
          originalPercentageTotal: d.originalPercentageTotal ?? null,
          reviewRequired: d.reviewRequired ?? false,
          reviewReasons: d.reviewReasons ?? [],
          ingredients: d.ingredients.map((i) => ({ ...i, id: randomUUID() })),
          procedureSteps: d.procedureSteps.map((s) => ({ ...s, id: randomUUID() })),
          specifications: d.specifications.map((s) => ({ ...s, id: randomUUID() })),
        };
        this.store.versions.push(ver);
        inserted += 1;
        if (ver.status === "VIGENTE") {
          // Dejar anteriores HISTORICA
          for (const v of this.store.versions) {
            if (v.productId === prod.id && v.id !== ver.id && v.status === "VIGENTE") {
              v.status = "HISTORICA";
            }
          }
          prod.activeVersionId = ver.id;
          prevId = ver.id;
        }
      }
      prod.updatedAt = new Date().toISOString();
    }

    if (opts?.archiveHash) this.markArchiveImported(opts.archiveHash);

    return {
      inserted,
      duplicated,
      conflicts,
      warnings,
      products: this.store.products.length,
    };
  }

  proposeNewVersionFromOe(input: {
    client: string;
    product: string;
    productCode?: string;
    ingredients: FormulaVersionRecord["ingredients"];
    procedureSteps: FormulaVersionRecord["procedureSteps"];
    reason: string;
    actorEmail: string;
    actorSector: string;
  }): FormulaVersionRecord {
    const nc = normalizeSearchKey(input.client);
    const np = normalizeSearchKey(input.product);
    let prod = this.store.products.find(
      (p) => p.normalizedClient === nc && p.normalizedProduct === np
    );
    if (!prod) {
      prod = {
        id: randomUUID(),
        normalizedClient: nc,
        normalizedProduct: np,
        displayClient: input.client,
        displayProduct: input.product,
        productCode: input.productCode ?? "",
        activeVersionId: null,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };
      this.store.products.push(prod);
    }
    const semantic = createHash("sha256")
      .update(
        JSON.stringify({
          c: nc,
          p: np,
          i: input.ingredients.map((x) => [x.materialName, x.percentage]),
        })
      )
      .digest("hex");
    const ver: FormulaVersionRecord = {
      id: randomUUID(),
      productId: prod.id,
      version: this.store.versions.filter((v) => v.productId === prod!.id).length + 1,
      status: "BORRADOR_PROPUESTA",
      sourceFile: null,
      sourceSheet: null,
      sourceModifiedAt: null,
      sourceHash: `oe-propose:${semantic}`,
      semanticHash: semantic,
      importedAt: new Date().toISOString(),
      percentageTotal: null,
      validationStatus: "OK",
      warnings: [],
      previousVersionId: prod.activeVersionId,
      conflictCode: null,
      altSourcePaths: [],
      ingredients: input.ingredients,
      procedureSteps: input.procedureSteps,
      specifications: [],
    };
    this.store.versions.push(ver);
    void input.reason;
    void input.actorEmail;
    void input.actorSector;
    return ver;
  }

  approveProposal(versionId: string): FormulaVersionRecord {
    const ver = this.store.versions.find((v) => v.id === versionId);
    if (!ver) throw new FormulaBankNotFoundError("Propuesta no encontrada.");
    for (const v of this.store.versions) {
      if (v.productId === ver.productId && v.status === "VIGENTE") v.status = "HISTORICA";
    }
    ver.status = "VIGENTE";
    const prod = this.store.products.find((p) => p.id === ver.productId)!;
    prod.activeVersionId = ver.id;
    prod.updatedAt = new Date().toISOString();
    return ver;
  }

  private toSnapshot(prod: FormulaProductRecord, ver: FormulaVersionRecord): FormulaSnapshot {
    return {
      formulaProductId: prod.id,
      formulaVersionId: ver.id,
      versionHash: ver.semanticHash,
      displayClient: prod.displayClient,
      displayProduct: prod.displayProduct,
      productCode: prod.productCode,
      ingredients: ver.ingredients,
      procedureSteps: ver.procedureSteps,
      specifications: ver.specifications,
      percentageTotal: ver.percentageTotal,
    };
  }
}

export const memoryFormulaBank = new MemoryFormulaBank();
export const formulaBankService = new FormulaBankService(memoryFormulaBank);

export function resetFormulaBankForTests() {
  memoryFormulaBank.reset();
  return new FormulaBankService(memoryFormulaBank);
}
