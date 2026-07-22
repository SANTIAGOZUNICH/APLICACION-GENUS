/**
 * Importación segura del banco de fórmulas: filtro físico + conteos + invariantes.
 * Sin datos reales; usable desde CLI y tests sintéticos.
 */

import {
  isPendingClient,
  type FormulaProductRecord,
  type FormulaVersionRecord,
} from "./types";
import { MemoryFormulaBank } from "./formula-bank-service";

export type SafeImportCounts = {
  versions: number;
  vigentes: number;
  historicas: number;
  conflictos: number;
  pendingClients: number;
  reviewRequired: number;
  activeProducts: number;
  products: number;
};

export class SafeImportAbortError extends Error {
  code: string;
  constructor(code: string, message: string) {
    super(message);
    this.name = "SafeImportAbortError";
    this.code = code;
  }
}

function productById(products: FormulaProductRecord[], id: string) {
  return products.find((p) => p.id === id);
}

/** True si la versión debe excluirse del INSERT seguro. */
export function isBlockedSafeVersion(
  version: FormulaVersionRecord,
  product: FormulaProductRecord | undefined
): boolean {
  if (!product) return true;
  if (version.status === "CONFLICTO") return true;
  if (version.reviewRequired) return true;
  if (isPendingClient(product.displayClient)) return true;
  return false;
}

/**
 * Copia el banco dejando solo versiones/productos seguros.
 * Recalcula activeVersionId; elimina productos huérfanos.
 */
export function filterSafeOnly(source: MemoryFormulaBank): MemoryFormulaBank {
  const out = new MemoryFormulaBank();
  const keptVersions: FormulaVersionRecord[] = [];

  for (const v of source.versions) {
    const prod = productById(source.products, v.productId);
    if (isBlockedSafeVersion(v, prod)) continue;
    keptVersions.push({
      ...v,
      ingredients: v.ingredients.map((i) => ({ ...i })),
      procedureSteps: v.procedureSteps.map((s) => ({ ...s })),
      specifications: v.specifications.map((s) => ({ ...s })),
      warnings: [...v.warnings],
      altSourcePaths: [...v.altSourcePaths],
      reviewReasons: [...(v.reviewReasons ?? [])],
    });
  }

  const productIds = new Set(keptVersions.map((v) => v.productId));
  const keptProducts: FormulaProductRecord[] = [];

  for (const p of source.products) {
    if (!productIds.has(p.id)) continue;
    if (isPendingClient(p.displayClient)) continue;

    const versions = keptVersions.filter((v) => v.productId === p.id);
    if (versions.length === 0) continue;

    const vigente = versions.find((v) => v.status === "VIGENTE") ?? null;
    // Si quedó solo HISTÓRICA (p.ej. hermano de un CONFLICTO filtrado), no promover.
    keptProducts.push({
      ...p,
      activeVersionId: vigente ? vigente.id : null,
    });
  }

  const finalProductIds = new Set(keptProducts.map((p) => p.id));
  out.products = keptProducts;
  out.versions = keptVersions.filter((v) => finalProductIds.has(v.productId));
  out.importRunHashes = new Set(source.importRunHashes);
  return out;
}

export function countSafeBank(store: MemoryFormulaBank): SafeImportCounts {
  const pendientesVersiones = store.versions.filter((v) => {
    const p = productById(store.products, v.productId);
    return p ? isPendingClient(p.displayClient) : true;
  }).length;

  return {
    versions: store.versions.length,
    vigentes: store.versions.filter((v) => v.status === "VIGENTE").length,
    historicas: store.versions.filter((v) => v.status === "HISTORICA").length,
    conflictos: store.versions.filter((v) => v.status === "CONFLICTO").length,
    pendingClients: pendientesVersiones,
    reviewRequired: store.versions.filter((v) => v.reviewRequired).length,
    activeProducts: store.products.filter((p) => {
      if (!p.activeVersionId || isPendingClient(p.displayClient)) return false;
      const v = store.versions.find((x) => x.id === p.activeVersionId);
      return Boolean(v && v.status === "VIGENTE" && !v.reviewRequired);
    }).length,
    products: store.products.length,
  };
}

/** Invariantes del conjunto final seguro (antes o después de escribir). */
export function assertSafeBankInvariants(store: MemoryFormulaBank): SafeImportCounts {
  const counts = countSafeBank(store);

  if (counts.conflictos !== 0) {
    throw new SafeImportAbortError(
      "HAS_CONFLICTO",
      `Conjunto final tiene CONFLICTO=${counts.conflictos}`
    );
  }
  if (counts.reviewRequired !== 0) {
    throw new SafeImportAbortError(
      "HAS_REVIEW_REQUIRED",
      `Conjunto final tiene REVIEW_REQUIRED=${counts.reviewRequired}`
    );
  }
  if (counts.pendingClients !== 0) {
    throw new SafeImportAbortError(
      "HAS_CLIENTE_PENDIENTE",
      `Conjunto final tiene CLIENTE_PENDIENTE=${counts.pendingClients}`
    );
  }

  for (const v of store.versions) {
    if (!store.products.some((p) => p.id === v.productId)) {
      throw new SafeImportAbortError(
        "ORPHAN_VERSION",
        "Versión referencia producto inexistente"
      );
    }
  }

  for (const p of store.products) {
    if (!p.activeVersionId) continue;
    const v = store.versions.find((x) => x.id === p.activeVersionId);
    if (!v || v.productId !== p.id || v.status !== "VIGENTE" || v.reviewRequired) {
      throw new SafeImportAbortError(
        "INVALID_ACTIVE_VERSION",
        "activeVersionId inválido para OE"
      );
    }
  }

  return counts;
}

export function assertExpectedCounts(
  counts: SafeImportCounts,
  expectedVersions: number,
  expectedActive: number
): void {
  if (counts.versions !== expectedVersions) {
    throw new SafeImportAbortError(
      "EXPECTED_VERSIONS_MISMATCH",
      `versions=${counts.versions} expected=${expectedVersions}`
    );
  }
  if (counts.activeProducts !== expectedActive) {
    throw new SafeImportAbortError(
      "EXPECTED_ACTIVE_MISMATCH",
      `active=${counts.activeProducts} expected=${expectedActive}`
    );
  }
  if (counts.vigentes !== expectedActive) {
    throw new SafeImportAbortError(
      "VIGENTES_MISMATCH",
      `vigentes=${counts.vigentes} expectedActive=${expectedActive}`
    );
  }
}
