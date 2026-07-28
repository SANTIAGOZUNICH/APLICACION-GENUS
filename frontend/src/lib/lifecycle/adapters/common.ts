import type { LifecycleEntityState } from "../policy";
import { canAnnul, canArchive, canDelete, canHardDelete, canRestore } from "../policy";

/** Entregados: archive/annul/hard-delete stub. */
export function deliveryToLifecycleState(d: {
  id: string;
  status: string;
  archived?: boolean;
}): LifecycleEntityState {
  return {
    kind: "entrega",
    id: d.id,
    status: d.status,
    archived: Boolean(d.archived) || d.status === "ARCHIVADO",
    deleted: d.status === "REGISTRO_ELIMINADO",
  };
}

export function deliveryLifecycleActions(d: {
  id: string;
  status: string;
  archived?: boolean;
}) {
  const s = deliveryToLifecycleState(d);
  return {
    anular: canAnnul(s),
    archivar: canArchive(s),
    restaurar: canRestore(s),
    eliminarDefinitivo: canHardDelete(s),
  };
}

export function remitoToLifecycleState(r: {
  id: string;
  status: string;
}): LifecycleEntityState {
  return {
    kind: "remito",
    id: r.id,
    status: r.status,
    isDraft: r.status === "BORRADOR",
    archived: r.status === "ARCHIVADO",
    hasGeneratedVersion: r.status === "GENERADO",
  };
}

export function remitoLifecycleActions(r: { id: string; status: string }) {
  const s = remitoToLifecycleState(r);
  return {
    eliminar: canDelete(s),
    anular: canAnnul(s),
    archivar: canArchive(s),
    restaurar: canRestore(s),
  };
}

export function mpIngresoToLifecycleState(r: {
  id: string;
  status: string;
}): LifecycleEntityState {
  return {
    kind: "mp_ingreso",
    id: r.id,
    status: r.status,
    isDraft: r.status === "BORRADOR",
  };
}

export function formulaLifecycleActions(f: {
  id: string;
  usedByOe: boolean;
  active: boolean;
}) {
  const s: LifecycleEntityState = {
    kind: "formula",
    id: f.id,
    status: f.active ? "ACTIVA" : "ARCHIVADA",
    archived: !f.active,
    referencedBy: f.usedByOe
      ? [{ kind: "oe", id: "ref", label: "OE que usa esta fórmula" }]
      : [],
  };
  return {
    eliminar: canDelete(s),
    archivar: canArchive(s),
    restaurar: canRestore(s),
  };
}

export function plantillaLifecycleActions(t: {
  id: string;
  status: string;
}) {
  const s: LifecycleEntityState = {
    kind: "plantilla",
    id: t.id,
    status: t.status,
    archived: t.status === "OBSOLETA",
  };
  return {
    archivar: canArchive(s),
    restaurar: canRestore(s),
    eliminar: canDelete({ ...s, isDraft: false }),
  };
}

export function metricaLifecycleActions(m: {
  id: string;
  deletedAt: string | null;
}) {
  const s: LifecycleEntityState = {
    kind: "metrica",
    id: m.id,
    status: m.deletedAt ? "ARCHIVADO" : "ACTIVO",
    archived: Boolean(m.deletedAt),
  };
  return {
    archivar: canArchive(s),
    restaurar: canRestore(s),
    eliminar: canDelete(s),
  };
}

export function avisoLifecycleActions(a: {
  id: string;
  archivedAt: string | null;
}) {
  const s: LifecycleEntityState = {
    kind: "aviso",
    id: a.id,
    status: a.archivedAt ? "ARCHIVADO" : "ACTIVO",
    archived: Boolean(a.archivedAt),
  };
  return {
    archivar: canArchive(s),
    restaurar: canRestore(s),
  };
}

/** Control semanal MP v2 — borrador eliminar; confirmado anular/archivar; archivado restaurar. */
export function mpControlToLifecycleState(c: {
  id: string;
  status: string;
  linkedOeId?: string | null;
}): LifecycleEntityState {
  const refs = c.linkedOeId
    ? [{ kind: "oe" as const, id: c.linkedOeId, label: `OE vinculada (${c.linkedOeId})` }]
    : [];
  return {
    kind: "mp_control",
    id: c.id,
    status: c.status,
    isDraft: c.status === "BORRADOR",
    archived: c.status === "ARCHIVADO",
    referencedBy: refs,
  };
}

export function mpControlLifecycleActions(c: {
  id: string;
  status: string;
  linkedOeId?: string | null;
}) {
  const s = mpControlToLifecycleState(c);
  return {
    eliminar: canDelete(s),
    anular: canAnnul(s),
    archivar: canArchive(s),
    restaurar: canRestore(s),
  };
}

/** Saldo de inventario: nunca eliminar; solo ajuste / anular origen. */
export function mpStockLifecycleActions(s: { id: string; codigo: string }) {
  const entity: LifecycleEntityState = {
    kind: "mp_ajuste",
    id: s.id,
    status: "CONFIRMADO",
    referencedBy: [{ kind: "mp_ingreso", id: s.codigo, label: `Stock ${s.codigo}` }],
  };
  return {
    eliminar: canDelete(entity),
    anular: canAnnul(entity),
  };
}
