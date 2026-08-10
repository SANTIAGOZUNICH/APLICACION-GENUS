/**
 * Política universal de lifecycle — Eliminar / Anular / Archivar / Restaurar.
 * Los adapters de dominio delegan aquí las decisiones; la ejecución queda en cada service.
 */

import type { SectorId } from "@/types/operational/sector";

/**
 * Vocabulario de estado "lifecycle" — mezcla deliberada de dominios: OE/OA
 * usan mayúsculas en español (ARCHIVADA/ANULADA para "orden", femenino;
 * ARCHIVADO/ANULADO para otras entidades, masculino), work items nativos
 * usan minúsculas ("cancelado", "pendiente", ver WORK_ITEM_STATUSES en
 * types/operational/work-item.ts). No es un bug de casing — son entidades
 * de dominios distintos con vocabularios reales distintos que comparten
 * este motor de política. Lo que sí era un riesgo real (AUDIT_TRAZABILIDAD,
 * J): cada función repetía la lista de literales por separado, así que
 * agregar una variante en un lugar y olvidarla en otro pasaba desapercibido
 * hasta que alguien lo pisaba en producción. Centralizado acá una sola vez;
 * el comportamiento (qué literales cuentan como qué) no cambió.
 */
const ARCHIVED_STATUSES: ReadonlySet<string> = new Set(["ARCHIVADA", "ARCHIVADO"]);
const ANNULLED_STATUSES: ReadonlySet<string> = new Set(["ANULADA", "ANULADO", "cancelado"]);
const DELETED_STATUSES: ReadonlySet<string> = new Set(["REGISTRO_ELIMINADO"]);
/** Solo canDelete trata "pendiente" como equivalente a borrador — ver nota en esa función. */
const DRAFT_STATUSES: ReadonlySet<string> = new Set(["BORRADOR"]);
const DRAFT_STATUSES_INCLUDING_PENDIENTE: ReadonlySet<string> = new Set(["BORRADOR", "pendiente"]);

function isArchivedStatus(status: string, archived?: boolean): boolean {
  return Boolean(archived) || ARCHIVED_STATUSES.has(status);
}

function isAnnulledStatus(status: string): boolean {
  return ANNULLED_STATUSES.has(status);
}

function isDeletedStatus(status: string, deleted?: boolean): boolean {
  return Boolean(deleted) || DELETED_STATUSES.has(status);
}

function isDraftStatus(status: string, isDraft?: boolean, includePendiente = false): boolean {
  if (isDraft) return true;
  return includePendiente ? DRAFT_STATUSES_INCLUDING_PENDIENTE.has(status) : DRAFT_STATUSES.has(status);
}

export type LifecycleAction =
  | "eliminar"
  | "anular"
  | "archivar"
  | "restaurar"
  | "eliminar_definitivo"
  | "descartar_bandeja"
  | "bloquear";

export type LifecycleEntityKind =
  | "trabajo"
  | "oe"
  | "oa"
  | "calidad_decision"
  | "entrega"
  | "remito"
  | "mp_ingreso"
  | "mp_ajuste"
  | "mp_compra"
  | "mp_control"
  | "me_ingreso"
  | "me_salida"
  | "coa_folder"
  | "coa_file"
  | "coa_version"
  | "procedimiento_folder"
  | "procedimiento_file"
  | "procedimiento_version"
  | "metrica"
  | "lote"
  | "aviso"
  | "pedido"
  | "formula"
  | "plantilla"
  | "documento";

export type LifecycleVisibilityFilter =
  | "activos"
  | "archivados"
  | "anulados"
  | "todos";

export type LifecycleActor = {
  email: string;
  sector: SectorId;
  name?: string;
};

export type LifecycleReference = {
  kind: LifecycleEntityKind | string;
  id: string;
  label: string;
};

export type DeletionImpact = {
  summary: string;
  stockReversals?: Array<{ codigo: string; quantityKg: number; unit?: string }>;
  blobKeys?: string[];
  preservesAudit: boolean;
  createsStub?: boolean;
  references: LifecycleReference[];
  warnings: string[];
};

export type LifecycleDecision = {
  action: LifecycleAction;
  allowed: boolean;
  requireReason: boolean;
  requireDoubleConfirm: boolean;
  reason: string;
  impact?: DeletionImpact;
  httpStatusIfDenied?: 403 | 409 | 422;
};

export type LifecycleEntityState = {
  kind: LifecycleEntityKind;
  id: string;
  status: string;
  archived?: boolean;
  deleted?: boolean;
  isDraft?: boolean;
  hasProgress?: boolean;
  hasGeneratedVersion?: boolean;
  referencedBy?: LifecycleReference[];
  ownerSector?: SectorId;
  createdByEmail?: string;
};

export function requireReasonFor(action: LifecycleAction): boolean {
  // Ofrece campo de motivo (siempre opcional en UI/API).
  return (
    action === "anular" ||
    action === "eliminar_definitivo" ||
    action === "eliminar" ||
    action === "archivar" ||
    action === "restaurar"
  );
}

export function canDelete(entity: LifecycleEntityState): LifecycleDecision {
  if (isDeletedStatus(entity.status, entity.deleted)) {
    return block("Ya fue eliminado.");
  }
  if (isArchivedStatus(entity.status, entity.archived)) {
    return block("Está archivado. Restaurá antes o usá eliminar definitivo si aplica.");
  }
  if (isAnnulledStatus(entity.status)) {
    return block("Está anulado. No se elimina el historial legal.");
  }

  const refs = entity.referencedBy ?? [];
  if (refs.length > 0 && !entity.isDraft) {
    return {
      action: "bloquear",
      allowed: false,
      requireReason: false,
      requireDoubleConfirm: false,
      reason: `No se puede eliminar: tiene ${refs.length} referencia(s). Usá Anular o Archivar.`,
      impact: emptyImpact(refs),
      httpStatusIfDenied: 409,
    };
  }

  if (isDraftStatus(entity.status, entity.isDraft, true)) {
    if (entity.hasProgress) {
      return {
        action: "anular",
        allowed: true,
        requireReason: true,
        requireDoubleConfirm: false,
        reason: "Tiene avance. Preferí anular/cancelar (motivo opcional).",
      };
    }
    return {
      action: "eliminar",
      allowed: true,
      requireReason: true,
      requireDoubleConfirm: false,
      reason: "Borrador o pendiente sin consecuencias — se puede eliminar.",
      impact: {
        summary: "Desaparecerá del listado. No hay reverso de stock.",
        preservesAudit: true,
        references: [],
        warnings: [],
      },
    };
  }

  return {
    action: "bloquear",
    allowed: false,
    requireReason: false,
    requireDoubleConfirm: false,
    reason: "Registro confirmado: usá Anular o Archivar. No hay hard delete.",
    httpStatusIfDenied: 409,
  };
}

export function canAnnul(entity: LifecycleEntityState): LifecycleDecision {
  if (isDraftStatus(entity.status, entity.isDraft)) {
    return {
      action: "eliminar",
      allowed: true,
      requireReason: true,
      requireDoubleConfirm: false,
      reason: "Es borrador: preferí Eliminar.",
    };
  }
  if (isAnnulledStatus(entity.status)) {
    return block("Ya está anulado (idempotente).");
  }
  if (isDeletedStatus(entity.status, entity.deleted)) {
    return block("Registro eliminado — no se anula.");
  }
  return {
    action: "anular",
    allowed: true,
    requireReason: true,
    requireDoubleConfirm: false,
    reason: "Anular conserva auditoría y revierte efectos derivados una sola vez.",
    impact: {
      summary:
        "Se marcará ANULADO/ANULADA, se revertirán efectos de stock si aplica y se conservará el historial.",
      preservesAudit: true,
      references: entity.referencedBy ?? [],
      warnings: [],
    },
  };
}

export function canArchive(entity: LifecycleEntityState): LifecycleDecision {
  if (isArchivedStatus(entity.status, entity.archived)) {
    return block("Ya está archivado.");
  }
  if (isDeletedStatus(entity.status, entity.deleted)) {
    return block("Eliminado — no se archiva.");
  }
  if (isDraftStatus(entity.status, entity.isDraft)) {
    return {
      action: "eliminar",
      allowed: true,
      requireReason: true,
      requireDoubleConfirm: false,
      reason: "Borrador: preferí Eliminar en lugar de archivar.",
    };
  }
  return {
    action: "archivar",
    allowed: true,
    requireReason: false,
    requireDoubleConfirm: false,
    reason: "Ocultar del listado activo sin modificar stock ni estados legales.",
    impact: {
      summary: "Quedará en Archivados. Se puede restaurar. Sin reverso de stock.",
      preservesAudit: true,
      references: [],
      warnings: [],
    },
  };
}

export function canRestore(entity: LifecycleEntityState): LifecycleDecision {
  if (!isArchivedStatus(entity.status, entity.archived)) {
    return block("Solo se restauran registros archivados.");
  }
  if (isDeletedStatus(entity.status, entity.deleted)) {
    return block("Eliminado definitivamente — no se restaura.");
  }
  return {
    action: "restaurar",
    allowed: true,
    requireReason: false,
    requireDoubleConfirm: false,
    reason: "Volverá al listado de activos.",
  };
}

export function canHardDelete(entity: LifecycleEntityState): LifecycleDecision {
  const refs = entity.referencedBy ?? [];
  if (refs.length > 0) {
    return {
      action: "bloquear",
      allowed: false,
      requireReason: false,
      requireDoubleConfirm: false,
      reason: "Hay referencias legales. No se ofrece eliminar definitivo.",
      impact: emptyImpact(refs),
      httpStatusIfDenied: 409,
    };
  }
  if (!isArchivedStatus(entity.status, entity.archived)) {
    return block("Eliminar definitivo solo desde Archivados, cuando sea seguro.");
  }
  return {
    action: "eliminar_definitivo",
    allowed: true,
    requireReason: true,
    requireDoubleConfirm: true,
    reason: "Eliminación excepcional con stub de auditoría.",
    impact: {
      summary: "Se conservará stub REGISTRO_ELIMINADO (hash, actor, fecha, motivo).",
      preservesAudit: true,
      createsStub: true,
      references: [],
      warnings: ["Acción irreversible en el listado operativo."],
    },
  };
}

export function getDeletionImpact(
  entity: LifecycleEntityState,
  extras?: Partial<DeletionImpact>
): DeletionImpact {
  const base = canDelete(entity).impact ?? emptyImpact(entity.referencedBy ?? []);
  return {
    ...base,
    ...extras,
    references: extras?.references ?? base.references,
    warnings: [...(base.warnings ?? []), ...(extras?.warnings ?? [])],
    stockReversals: extras?.stockReversals ?? base.stockReversals,
    blobKeys: extras?.blobKeys ?? base.blobKeys,
  };
}

export function referencedBy(
  refs: LifecycleReference[] | undefined
): LifecycleReference[] {
  return refs ?? [];
}

/** Resuelve la mejor acción primaria para el menú Acciones. */
export function resolvePrimaryLifecycleAction(
  entity: LifecycleEntityState
): LifecycleDecision {
  if (isArchivedStatus(entity.status, entity.archived)) {
    return canRestore(entity);
  }
  const del = canDelete(entity);
  if (del.allowed && del.action === "eliminar") return del;
  const annul = canAnnul(entity);
  if (annul.allowed && annul.action === "anular") return annul;
  const arch = canArchive(entity);
  if (arch.allowed) return arch;
  return del.allowed ? del : annul.allowed ? annul : arch;
}

export function matchesVisibilityFilter(
  filter: LifecycleVisibilityFilter,
  entity: Pick<LifecycleEntityState, "status" | "archived" | "deleted">
): boolean {
  const archived = isArchivedStatus(entity.status, entity.archived);
  const annulled = isAnnulledStatus(entity.status) || isDeletedStatus(entity.status);
  const deleted = isDeletedStatus(entity.status, entity.deleted);

  switch (filter) {
    case "todos":
      return true;
    case "archivados":
      return archived && !deleted;
    case "anulados":
      return annulled;
    case "activos":
    default:
      return !archived && !annulled && !deleted;
  }
}

function block(reason: string): LifecycleDecision {
  return {
    action: "bloquear",
    allowed: false,
    requireReason: false,
    requireDoubleConfirm: false,
    reason,
    httpStatusIfDenied: 409,
  };
}

function emptyImpact(references: LifecycleReference[]): DeletionImpact {
  return {
    summary: "",
    preservesAudit: true,
    references,
    warnings: [],
  };
}
