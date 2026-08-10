/**
 * Reconstrucción de Inventario ME agrupando movimientos exclusivamente por CÓDIGO.
 * Idempotente: correr dos veces con los mismos datos produce el mismo resultado.
 */

import { randomUUID } from "node:crypto";
import { hasMeCodigo, normalizeMeCodigo } from "./me-codigo";
import type { MemoryInventoryRepo } from "./memory-repo";
import type { MeIngresoRow, MeMaterial, MeSalidaRow } from "./types";

export type MeRebuildStockRow = {
  codigo: string;
  materialId: string;
  descripcion: string;
  cliente: string;
  ubicacion: string;
  ingresosTotal: number;
  salidasOaTotal: number;
  stockActual: number;
  action: "create" | "update" | "unchanged";
};

export type MeRebuildSkippedMovement = {
  kind: "ingreso" | "salida";
  id: string;
  reason: "empty_codigo";
  descripcion: string;
};

export type MeRebuildArchivedMaterial = {
  materialId: string;
  codigo: string;
  descripcion: string;
  reason: "duplicate_codigo" | "orphan_after_rebuild" | "empty_codigo_no_movements";
};

export type MeInventarioRebuildReport = {
  dryRun: boolean;
  stocks: MeRebuildStockRow[];
  relinkedIngresos: number;
  relinkedSalidas: number;
  archivedMaterials: MeRebuildArchivedMaterial[];
  skippedMovements: MeRebuildSkippedMovement[];
  materialsCreated: number;
  materialsUpdated: number;
  materialsUnchanged: number;
};

function nowIso() {
  return new Date().toISOString();
}

function round6(n: number) {
  return Number(n.toFixed(6));
}

function movementCodigo(
  raw: string | null | undefined,
  materialId: string | null | undefined,
  materialsById: Map<string, MeMaterial>
): string {
  const fromMove = normalizeMeCodigo(raw);
  if (fromMove) return fromMove;
  if (materialId) {
    const mat = materialsById.get(materialId);
    if (mat) return normalizeMeCodigo(mat.codigo);
  }
  return "";
}

type Bucket = {
  codigo: string;
  ingresos: MeIngresoRow[];
  salidas: MeSalidaRow[];
  /** Candidatos materiales ya existentes con este código. */
  existingMaterials: MeMaterial[];
};

/**
 * Calcula y aplica (salvo dryRun) el inventario ME por código.
 * Conserva todos los movimientos; solo reasigna materialId y recalcula stock.
 */
export function rebuildMeInventarioByCodigo(
  repo: MemoryInventoryRepo,
  options: { dryRun?: boolean; actorEmail?: string } = {}
): MeInventarioRebuildReport {
  const dryRun = Boolean(options.dryRun);
  const actorEmail = options.actorEmail ?? "system@rebuild-me-inventario";
  const now = nowIso();

  const materials = repo.listMeMaterials();
  const materialsById = new Map(materials.map((m) => [m.id, m]));
  const ingresos = repo.listMeIngresos();
  const salidas = repo.listMeSalidas();

  const buckets = new Map<string, Bucket>();
  const skippedMovements: MeRebuildSkippedMovement[] = [];

  const ensureBucket = (codigo: string): Bucket => {
    let b = buckets.get(codigo);
    if (!b) {
      b = { codigo, ingresos: [], salidas: [], existingMaterials: [] };
      buckets.set(codigo, b);
    }
    return b;
  };

  for (const m of materials) {
    const c = normalizeMeCodigo(m.codigo);
    if (!c) continue;
    ensureBucket(c).existingMaterials.push(m);
  }

  for (const row of ingresos) {
    if (row.anulado) continue;
    const codigo = movementCodigo(row.codigo, row.materialId, materialsById);
    if (!codigo) {
      skippedMovements.push({
        kind: "ingreso",
        id: row.id,
        reason: "empty_codigo",
        descripcion: row.descripcionInsumo || "",
      });
      continue;
    }
    ensureBucket(codigo).ingresos.push(row);
  }

  for (const row of salidas) {
    if (row.reverted || row.origen !== "OA") continue;
    const codigo = movementCodigo(row.codigo, row.materialId, materialsById);
    if (!codigo) {
      skippedMovements.push({
        kind: "salida",
        id: row.id,
        reason: "empty_codigo",
        descripcion: row.descripcion || "",
      });
      continue;
    }
    ensureBucket(codigo).salidas.push(row);
  }

  const stocks: MeRebuildStockRow[] = [];
  const archivedMaterials: MeRebuildArchivedMaterial[] = [];
  let relinkedIngresos = 0;
  let relinkedSalidas = 0;
  let materialsCreated = 0;
  let materialsUpdated = 0;
  let materialsUnchanged = 0;

  /** materialIds canónicos que deben permanecer activos. */
  const canonicalIds = new Set<string>();

  const sortedCodigos = [...buckets.keys()].sort((a, b) => a.localeCompare(b));

  for (const codigo of sortedCodigos) {
    const bucket = buckets.get(codigo)!;

    // Sin movimientos: no mantener fila de inventario artificial; archivar residuales.
    if (bucket.ingresos.length === 0 && bucket.salidas.length === 0) {
      for (const m of bucket.existingMaterials) {
        if (m.archived) continue;
        archivedMaterials.push({
          materialId: m.id,
          codigo,
          descripcion: m.descripcion,
          reason: "orphan_after_rebuild",
        });
        if (!dryRun) {
          repo.upsertMeMaterial({
            ...m,
            codigo,
            stockActual: 0,
            archived: true,
            archivedAt: now,
            archivedBy: actorEmail,
            archivedReason: `Rebuild ME: orphan_after_rebuild`,
            updatedAt: now,
          });
        }
      }
      continue;
    }

    const ingresosTotal = round6(
      bucket.ingresos.reduce((acc, r) => acc + (r.total ?? 0), 0)
    );
    const salidasOaTotal = round6(
      bucket.salidas.reduce((acc, r) => acc + (r.total ?? r.cantidad ?? 0), 0)
    );
    const stockActual = round6(ingresosTotal - salidasOaTotal);

    // Preferir material no archivado; si hay varios, el de id más antiguo (estable).
    const sortedExisting = [...bucket.existingMaterials].sort((a, b) =>
      a.id.localeCompare(b.id)
    );
    const preferred =
      sortedExisting.find((m) => !m.archived) ?? sortedExisting[0] ?? null;

    const metaIngreso =
      [...bucket.ingresos].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))[0] ??
      null;

    const descripcion =
      preferred?.descripcion?.trim() ||
      metaIngreso?.descripcionInsumo?.trim() ||
      bucket.salidas[0]?.descripcion?.trim() ||
      codigo;
    const cliente =
      preferred?.cliente?.trim() ||
      metaIngreso?.cliente?.trim() ||
      bucket.salidas[0]?.cliente?.trim() ||
      "";
    const ubicacion =
      preferred?.ubicacion?.trim() || metaIngreso?.ubicacion?.trim() || "";

    let action: MeRebuildStockRow["action"] = preferred ? "update" : "create";
    const materialId = preferred?.id ?? randomUUID();

    const nextMaterial: MeMaterial = {
      id: materialId,
      codigo,
      descripcion,
      cliente,
      ubicacion,
      unidad: preferred?.unidad ?? "u",
      cantidadPorBulto: preferred?.cantidadPorBulto ?? null,
      stockActual,
      stockMinimo: preferred?.stockMinimo ?? null,
      puntoReposicion: preferred?.puntoReposicion ?? null,
      responsable: preferred?.responsable ?? "",
      observacion: preferred?.observacion ?? "",
      updatedAt: now,
      archived: false,
      archivedAt: null,
      archivedBy: null,
      archivedReason: null,
    };

    if (preferred) {
      const same =
        normalizeMeCodigo(preferred.codigo) === codigo &&
        preferred.stockActual === stockActual &&
        !preferred.archived &&
        (preferred.descripcion || "") === descripcion &&
        (preferred.cliente || "") === cliente &&
        (preferred.ubicacion || "") === ubicacion;
      if (same) {
        action = "unchanged";
        materialsUnchanged += 1;
      } else {
        materialsUpdated += 1;
      }
    } else {
      materialsCreated += 1;
    }

    canonicalIds.add(materialId);

    if (!dryRun) {
      repo.upsertMeMaterial(nextMaterial);
    }

    // Relink ingresos / salidas al canónico + normalizar codigo en payload.
    for (const row of bucket.ingresos) {
      const needs =
        row.materialId !== materialId || normalizeMeCodigo(row.codigo) !== codigo;
      if (needs) {
        relinkedIngresos += 1;
        if (!dryRun) {
          repo.upsertMeIngreso({
            ...row,
            materialId,
            codigo,
            updatedAt: now,
            updatedBy: actorEmail,
          });
        }
      }
    }
    for (const row of bucket.salidas) {
      const needs =
        row.materialId !== materialId || normalizeMeCodigo(row.codigo) !== codigo;
      if (needs) {
        relinkedSalidas += 1;
        if (!dryRun) {
          repo.upsertMeSalida({
            ...row,
            materialId,
            codigo,
            updatedAt: now,
            updatedBy: actorEmail,
          });
        }
      }
    }

    // Archivar duplicados del mismo código.
    for (const dup of sortedExisting) {
      if (dup.id === materialId) continue;
      archivedMaterials.push({
        materialId: dup.id,
        codigo: normalizeMeCodigo(dup.codigo) || dup.codigo,
        descripcion: dup.descripcion,
        reason: "duplicate_codigo",
      });
      if (!dryRun && !dup.archived) {
        repo.upsertMeMaterial({
          ...dup,
          codigo: normalizeMeCodigo(dup.codigo) || dup.codigo,
          stockActual: 0,
          archived: true,
          archivedAt: now,
          archivedBy: actorEmail,
          archivedReason: `Rebuild ME: duplicado de código ${codigo}`,
          updatedAt: now,
        });
      }
    }

    stocks.push({
      codigo,
      materialId,
      descripcion,
      cliente,
      ubicacion,
      ingresosTotal,
      salidasOaTotal,
      stockActual,
      action,
    });
  }

  // Materiales que quedaron fuera (vacíos o sin movimientos bajo su código).
  for (const m of materials) {
    if (canonicalIds.has(m.id)) continue;
    if (m.archived) continue;

    const codigo = normalizeMeCodigo(m.codigo);
    const stillLinkedIngresos = ingresos.some(
      (r) => !r.anulado && r.materialId === m.id && !hasMeCodigo(movementCodigo(r.codigo, r.materialId, materialsById))
    );
    const stillLinkedSalidas = salidas.some(
      (r) =>
        !r.reverted &&
        r.origen === "OA" &&
        r.materialId === m.id &&
        !hasMeCodigo(movementCodigo(r.codigo, r.materialId, materialsById))
    );

    // Si quedan movimientos sin código ligados, no archivar (requiere acción manual).
    if (stillLinkedIngresos || stillLinkedSalidas) {
      continue;
    }

    const reason: MeRebuildArchivedMaterial["reason"] = !codigo
      ? "empty_codigo_no_movements"
      : "orphan_after_rebuild";

    archivedMaterials.push({
      materialId: m.id,
      codigo: codigo || "(vacío)",
      descripcion: m.descripcion,
      reason,
    });

    if (!dryRun) {
      repo.upsertMeMaterial({
        ...m,
        stockActual: 0,
        archived: true,
        archivedAt: now,
        archivedBy: actorEmail,
        archivedReason: `Rebuild ME: ${reason}`,
        updatedAt: now,
      });
    }
  }

  return {
    dryRun,
    stocks,
    relinkedIngresos,
    relinkedSalidas,
    archivedMaterials,
    skippedMovements,
    materialsCreated,
    materialsUpdated,
    materialsUnchanged,
  };
}
