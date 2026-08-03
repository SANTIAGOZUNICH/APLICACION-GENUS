import type { OeContent, OeMaterialRow } from "@/lib/orders/types";
import { OrdersValidationError } from "@/lib/orders/types";
import {
  computeKgRealUtilizado,
  formulaFingerprint,
  parseAjusteKg,
} from "@/lib/orders/content";

export function validateAjusteRows(materials: OeMaterialRow[]): string[] {
  const errors: string[] = [];
  for (const m of materials) {
    const ajuste = parseAjusteKg(m.ajuste);
    if (ajuste != null && ajuste !== 0 && !m.ajusteMotivo.trim()) {
      errors.push(
        `Motivo de ajuste obligatorio para “${m.materiaPrima || "materia prima"}” (ajuste ≠ 0).`
      );
    }
  }
  return errors;
}

export function assertAjusteValid(content: OeContent): void {
  const errors = validateAjusteRows(content.materials);
  if (errors.length) {
    throw new OrdersValidationError(errors.join(" "));
  }
}

export function didFormulaChange(before: OeContent, after: OeContent): boolean {
  return formulaFingerprint(before) !== formulaFingerprint(after);
}

/** Aplica solo campos operativos (ajuste/lote) sobre materiales existentes; conserva cabecera operativa. */
export function applyElaboracionMaterialPatch(
  current: OeContent,
  incoming: OeContent,
  actorEmail: string
): OeContent {
  const byId = new Map(incoming.materials.map((m) => [m.id, m]));
  const materials = current.materials.map((m) => {
    const next = byId.get(m.id);
    if (!next) return m;
    const ajuste = parseAjusteKg(next.ajuste);
    const changed =
      ajuste !== parseAjusteKg(m.ajuste) ||
      next.ajusteMotivo !== m.ajusteMotivo ||
      next.lote !== m.lote;
    return {
      ...m,
      materiaPrima: m.materiaPrima,
      codigo: m.codigo,
      formulaPct: m.formulaPct,
      kgAPesar: m.kgAPesar,
      ajuste,
      ajusteMotivo: next.ajusteMotivo ?? "",
      lote: next.lote ?? "",
      ajusteAt: changed ? new Date().toISOString() : m.ajusteAt,
      ajusteBy: changed ? actorEmail : m.ajusteBy,
    };
  });
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
