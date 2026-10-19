import type { OeContent, OeMaterialRow } from "@/lib/orders/types";
import { OrdersValidationError } from "@/lib/orders/types";
import {
  computeKgRealUtilizado,
  formulaFingerprint,
} from "@/lib/orders/content";

/**
 * KG REAL UTILIZADO: número no negativo. La diferencia con lo teórico se deriva (ajuste) y su observación es opcional:
 * cargar kg reales distintos de los teóricos es lo normal y no pide confirmaciones.
 */
export function validateAjusteRows(materials: OeMaterialRow[]): string[] {
  const errors: string[] = [];
  for (const m of materials) {
    if (m.kgReal != null && (!Number.isFinite(m.kgReal) || m.kgReal < 0)) {
      errors.push(`KG REAL UTILIZADO de «${m.materiaPrima || "materia prima"}» no puede ser negativo.`);
    }
  }
  return errors;
}

export function assertAjusteValid(content: OeContent): void {
  const errors = [...validateAjusteRows(content.materials), ...(content.sheets ?? []).flatMap((s) => validateAjusteRows(s.materials))];
  if (errors.length) {
    throw new OrdersValidationError(errors.join(" "));
  }
}

export function didFormulaChange(before: OeContent, after: OeContent): boolean {
  return formulaFingerprint(before) !== formulaFingerprint(after);
}

/**
 * Elaboración: solo datos de lo que hizo — KG REAL UTILIZADO, LOTE MP, CÓDIGO MP (si falta o hay que corregirlo) y
 * la observación; puede agregar/quitar filas de LOTE ADICIONAL de una MP. Nunca cambia la fórmula (MP, código,
 * %, kg a pesar) ni agrega/quita filas de la fórmula.
 */
export function applyElaboracionMaterialPatch(
  current: OeContent,
  incoming: OeContent,
  actorEmail: string
): OeContent {
  const byId = new Map(incoming.materials.map((m) => [m.id, m]));
  const now = new Date().toISOString();
  const formulaRows = current.materials.filter((m) => !m.parentRowId);
  const patchRow = (m: OeMaterialRow, next: OeMaterialRow | undefined): OeMaterialRow => {
    if (!next) return m;
    const kgReal = next.kgReal == null ? null : Number(next.kgReal);
    const changed =
      kgReal !== m.kgReal ||
      (next.ajusteMotivo ?? "") !== m.ajusteMotivo ||
      (next.lote ?? "") !== m.lote ||
      (next.codigoMp ?? "") !== m.codigoMp;
    return {
      ...m,
      kgReal,
      ajusteMotivo: next.ajusteMotivo ?? "",
      lote: next.lote ?? "",
      codigoMp: next.codigoMp ?? "",
      ajusteAt: changed ? now : m.ajusteAt,
      ajusteBy: changed ? actorEmail : m.ajusteBy,
    };
  };
  const materials: OeMaterialRow[] = [];
  for (const row of formulaRows) {
    const patched = patchRow(row, byId.get(row.id));
    materials.push(patched);
    // Lotes adicionales de esta MP, en el orden en que vienen; heredan MP y códigos de la fila de la fórmula.
    for (const child of incoming.materials.filter((x) => x.parentRowId === row.id)) {
      const before = current.materials.find((x) => x.id === child.id && x.parentRowId === row.id);
      const base: OeMaterialRow = before ?? { ...child, ajusteAt: null, ajusteBy: null, kgReal: null, lote: "" };
      materials.push({
        ...patchRow(base, child),
        materiaPrima: patched.materiaPrima,
        codigo: patched.codigo,
        codigoMp: patched.codigoMp,
        parentRowId: row.id,
        formulaPct: null,
        kgAPesar: null,
      });
    }
  }
  return {
    ...current,
    header: {
      ...current.header,
      // Elaboración puede completar datos operativos de cabecera (incl. cantidad a elaborar)
      date: incoming.header.date,
      lot: incoming.header.lot,
      client: incoming.header.client,
      vigencia: incoming.header.vigencia,
      envaseCubica: incoming.header.envaseCubica,
      equipoCalefactor: incoming.header.equipoCalefactor,
      quantityKg: incoming.header.quantityKg ?? current.header.quantityKg,
      productName: current.header.productName,
      code: current.header.code,
    },
    materials,
    cleaning: incoming.cleaning,
    samples: incoming.samples,
    processControl: {
      ...incoming.processControl,
      aspectoSpec: current.processControl.aspectoSpec,
      colorSpec: current.processControl.colorSpec,
      olorSpec: current.processControl.olorSpec,
      phSpec: current.processControl.phSpec,
      viscosidadSpec: current.processControl.viscosidadSpec,
    },
    qualityControl: incoming.qualityControl,
  };
}

export function summarizeAjusteTotals(content: OeContent) {
  const teorico = content.totals.kgSum ?? 0;
  const ajustes = content.totals.ajusteSum ?? 0;
  const real = content.totals.kgRealSum ?? 0;
  const diferenciaPct = content.totals.diferenciaPct;
  return { teorico, ajustes, real, diferenciaPct };
}

export { computeKgRealUtilizado };
