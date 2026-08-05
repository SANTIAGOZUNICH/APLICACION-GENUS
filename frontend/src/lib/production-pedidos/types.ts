import type { SectorId } from "@/types/operational/sector";
import { computeKg, formatKg, parseOptionalDecimal } from "./kg";

export const PRODUCTION_PEDIDO_STATUSES = [
  "INGRESO",
  "EN_ELABORACION",
  "EN_ENVASADO",
  "LISTO_PARA_ENTREGAR",
  "ENTREGADO",
] as const;

export type ProductionPedidoStatus = (typeof PRODUCTION_PEDIDO_STATUSES)[number];

export const PRODUCTION_PEDIDO_STATUS_LABELS: Record<ProductionPedidoStatus, string> = {
  INGRESO: "INGRESO",
  EN_ELABORACION: "EN ELABORACIÓN",
  EN_ENVASADO: "EN ENVASADO",
  LISTO_PARA_ENTREGAR: "LISTO PARA ENTREGAR",
  ENTREGADO: "ENTREGADO",
};

export type ProductionPedidosActor = {
  email: string;
  sector: SectorId | string;
  roleId?: string | null;
  isSuperadmin?: boolean;
};

/** Solo PRODUCCIÓN y SUPERADMIN (servidor). */
export function canAccessProductionPedidos(actor: ProductionPedidosActor): boolean {
  if (actor.isSuperadmin) return true;
  if (String(actor.roleId ?? "").toUpperCase() === "ROL-SU") return true;
  return String(actor.sector ?? "").toUpperCase() === "PRODUCCION";
}

export type ProductionPedidoRecord = {
  id: string;
  op: string | null;
  fecha: string | null;
  nroOc: string | null;
  cliente: string | null;
  producto: string | null;
  s: string | null;
  q: number | null;
  ml: number | null;
  kg: number | null;
  kgDisplay: string;
  estado: ProductionPedidoStatus | null;
  createdBy: string | null;
  createdBySector: string | null;
  updatedBy: string | null;
  deletedAt: string | null;
  deletedBy: string | null;
  deleteReason: string | null;
  createdAt: string;
  updatedAt: string;
};

export type ProductionPedidoInput = {
  op?: string | null;
  fecha?: string | null;
  nroOc?: string | null;
  cliente?: string | null;
  producto?: string | null;
  s?: string | null;
  q?: number | string | null;
  ml?: number | string | null;
  /** Ignorado: siempre se recalcula. */
  kg?: number | string | null;
  estado?: string | null;
};

export type ProductionPedidoListFilters = {
  op?: string;
  nroOc?: string;
  cliente?: string;
  producto?: string;
  estado?: string;
  fechaFrom?: string;
  fechaTo?: string;
  includeDeleted?: boolean;
};

export function normalizeStatus(raw: string | null | undefined): ProductionPedidoStatus | null {
  if (raw == null) return null;
  const t = String(raw).trim().toUpperCase().replace(/\s+/g, "_");
  if (!t) return null;
  const aliases: Record<string, ProductionPedidoStatus> = {
    INGRESO: "INGRESO",
    EN_ELABORACION: "EN_ELABORACION",
    "EN ELABORACION": "EN_ELABORACION",
    "EN ELABORACIÓN": "EN_ELABORACION",
    ENELABORACION: "EN_ELABORACION",
    EN_PROCESO: "EN_ELABORACION",
    "EN PROCESO": "EN_ELABORACION",
    ENPROCESO: "EN_ELABORACION",
    EN_ENVASADO: "EN_ENVASADO",
    "EN ENVASADO": "EN_ENVASADO",
    ENENVASADO: "EN_ENVASADO",
    LISTO_PARA_ENTREGAR: "LISTO_PARA_ENTREGAR",
    "LISTO PARA ENTREGAR": "LISTO_PARA_ENTREGAR",
    LISTOPARAENTREGAR: "LISTO_PARA_ENTREGAR",
    TERMINADO: "LISTO_PARA_ENTREGAR",
    ENTREGADO: "ENTREGADO",
  };
  const key = t.replace(/ /g, "_");
  return aliases[key] ?? aliases[String(raw).trim().toUpperCase()] ?? null;
}

export function normalizeTextKeepLeadingZeros(raw: string | null | undefined): string | null {
  if (raw == null) return null;
  const t = String(raw).trim();
  return t === "" ? null : t;
}

export function normalizeFecha(raw: string | null | undefined): string | null {
  if (raw == null) return null;
  const t = String(raw).trim();
  if (!t) return null;
  // ISO
  if (/^\d{4}-\d{2}-\d{2}$/.test(t)) return t;
  // DD/MM/YYYY or DD-MM-YYYY
  const m = t.match(/^(\d{1,2})[\/\-.](\d{1,2})[\/\-.](\d{2,4})$/);
  if (m) {
    const d = Number(m[1]);
    const mo = Number(m[2]);
    let y = Number(m[3]);
    if (y < 100) y += 2000;
    if (mo < 1 || mo > 12 || d < 1 || d > 31) return null;
    return `${String(y).padStart(4, "0")}-${String(mo).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
  }
  // Excel serial date (approx)
  if (/^\d+(\.\d+)?$/.test(t.replace(",", "."))) {
    const serial = Number(t.replace(",", "."));
    if (serial > 20000 && serial < 80000) {
      const utc = Date.UTC(1899, 11, 30) + Math.round(serial) * 86400000;
      const dt = new Date(utc);
      const y = dt.getUTCFullYear();
      const mo = dt.getUTCMonth() + 1;
      const d = dt.getUTCDate();
      return `${y}-${String(mo).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
    }
  }
  return null;
}

export function coercePedidoFields(input: ProductionPedidoInput): {
  op: string | null;
  fecha: string | null;
  nroOc: string | null;
  cliente: string | null;
  producto: string | null;
  s: string | null;
  q: number | null;
  ml: number | null;
  kg: number | null;
  estado: ProductionPedidoStatus | null;
  errors: string[];
} {
  const errors: string[] = [];
  const op = normalizeTextKeepLeadingZeros(input.op);
  const nroOc = normalizeTextKeepLeadingZeros(input.nroOc);
  const cliente = normalizeTextKeepLeadingZeros(input.cliente);
  const producto = normalizeTextKeepLeadingZeros(input.producto);
  const s = normalizeTextKeepLeadingZeros(input.s);

  let fecha: string | null = null;
  if (input.fecha != null && String(input.fecha).trim() !== "") {
    fecha = normalizeFecha(String(input.fecha));
    if (!fecha) errors.push("FECHA inválida");
  }

  let q: number | null = null;
  if (input.q != null && String(input.q).trim() !== "") {
    q = parseOptionalDecimal(input.q);
    if (q == null) errors.push("Q inválido");
  }

  let ml: number | null = null;
  if (input.ml != null && String(input.ml).trim() !== "") {
    ml = parseOptionalDecimal(input.ml);
    if (ml == null) errors.push("ML inválido");
  }

  let estado: ProductionPedidoStatus | null = null;
  if (input.estado != null && String(input.estado).trim() !== "") {
    estado = normalizeStatus(String(input.estado));
    if (!estado) errors.push("ESTADO inválido");
  }

  const kg = computeKg(q, ml);
  return { op, fecha, nroOc, cliente, producto, s, q, ml, kg, estado, errors };
}

export function toPublicRecord(row: {
  id: string;
  op: string | null;
  fecha: string | null;
  nroOc: string | null;
  cliente: string | null;
  producto: string | null;
  s: string | null;
  q: number | null;
  ml: number | null;
  kg: number | null;
  estado: ProductionPedidoStatus | null;
  createdBy: string | null;
  createdBySector: string | null;
  updatedBy: string | null;
  deletedAt: string | null;
  deletedBy: string | null;
  deleteReason: string | null;
  createdAt: string;
  updatedAt: string;
}): ProductionPedidoRecord {
  const kg = computeKg(row.q, row.ml);
  return {
    ...row,
    kg,
    kgDisplay: formatKg(kg),
  };
}
