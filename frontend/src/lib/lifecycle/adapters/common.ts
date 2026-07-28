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
