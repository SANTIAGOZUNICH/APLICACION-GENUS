/** Cálculos puros Control semanal MP (sin I/O). */

export type MpControlLineEstado =
  | "Disponible"
  | "Parcial"
  | "Sin stock"
  | "Sin código";

export function kgNecesariosFromPct(
  formulaPct: number | null | undefined,
  quantityKg: number | null | undefined
): number | null {
  if (formulaPct == null || quantityKg == null) return null;
  if (!Number.isFinite(formulaPct) || !Number.isFinite(quantityKg)) return null;
  return Math.round(((formulaPct * quantityKg) / 100) * 1000) / 1000;
}

export function calcLineEstado(params: {
  codigo: string;
  kgNecesarios: number | null;
  stockActual: number | null;
}): MpControlLineEstado {
  if (!params.codigo.trim()) return "Sin código";
  const need = params.kgNecesarios ?? 0;
  const stock = params.stockActual ?? 0;
  if (stock <= 0 && need > 0) return "Sin stock";
  if (stock < need) return "Parcial";
  return "Disponible";
}

export function enrichControlLine(params: {
  codigo: string;
  materiaPrima: string;
  formulaPct: number | null;
  quantityKg: number | null;
  stockActual: number | null;
  kgEditados?: number | null;
  lote?: string;
  preparado?: boolean;
  observacion?: string;
  sortOrder?: number;
}): {
  codigo: string;
  materiaPrima: string;
  formulaPct: number | null;
  kgNecesarios: number | null;
  kgEditados: number | null;
  stockActual: number | null;
  stockProyectado: number | null;
  diferencia: number | null;
  estado: MpControlLineEstado;
  lote: string;
  preparado: boolean;
  observacion: string;
  sortOrder: number;
} {
  const kgNec = kgNecesariosFromPct(params.formulaPct, params.quantityKg);
  const effective =
    params.kgEditados != null && Number.isFinite(params.kgEditados)
      ? params.kgEditados
      : kgNec;
  const stock = params.stockActual;
  const diferencia =
    stock != null && effective != null
      ? Math.round((stock - effective) * 1000) / 1000
      : null;
  const stockProyectado =
    stock != null && effective != null
      ? Math.round((stock - effective) * 1000) / 1000
      : null;
  return {
    codigo: params.codigo,
    materiaPrima: params.materiaPrima,
    formulaPct: params.formulaPct,
    kgNecesarios: kgNec,
    kgEditados: params.kgEditados ?? null,
    stockActual: stock,
    stockProyectado,
    diferencia,
    estado: calcLineEstado({
      codigo: params.codigo,
      kgNecesarios: effective,
      stockActual: stock,
    }),
    lote: params.lote ?? "",
    preparado: params.preparado ?? false,
    observacion: params.observacion ?? "",
    sortOrder: params.sortOrder ?? 0,
  };
}
