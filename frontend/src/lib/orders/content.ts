import type {
  OaContent,
  OaMaterialRow,
  OeContent,
  OeMaterialRow,
  OeProcedureStep,
  OrderContent,
} from "@/lib/orders/types";
import { OA_ETIQUETADO_LEGAL_TEXT } from "@/lib/orders/types";

/** UUID compatible con Node y browser (sin importar node:crypto). */
function rowId(): string {
  if (typeof globalThis.crypto !== "undefined" && "randomUUID" in globalThis.crypto) {
    return globalThis.crypto.randomUUID();
  }
  return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    const v = c === "x" ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}

export function emptyOeMaterial(partial?: Partial<OeMaterialRow>): OeMaterialRow {
  return {
    id: rowId(),
    materiaPrima: "",
    codigo: "",
    formulaPct: null,
    kgAPesar: null,
    ajuste: "",
    lote: "",
    ...partial,
  };
}

export function emptyOaMaterial(nro: number, partial?: Partial<OaMaterialRow>): OaMaterialRow {
  return {
    id: rowId(),
    nro,
    codigo: "",
    nombreInsumo: "",
    recibidos: "",
    desechados: "",
    usados: "",
    fecha: "",
    responsable: "",
    ...partial,
  };
}

export function createEmptyOeContent(overrides?: Partial<OeContent["header"]>): OeContent {
  return {
    kind: "OE",
    title: "OE",
    productType: "PT",
    header: {
      productName: overrides?.productName ?? "",
      code: overrides?.code ?? "",
      date: overrides?.date ?? "",
      quantityKg: overrides?.quantityKg ?? null,
      lot: overrides?.lot ?? "",
      vigencia: overrides?.vigencia ?? "",
      client: overrides?.client ?? "",
      envaseCubica: overrides?.envaseCubica ?? "",
      equipoCalefactor: overrides?.equipoCalefactor ?? "",
    },
    materials: [],
    totals: {
      formulaPctSum: null,
      kgSum: null,
      cantidadReal: null,
      mermaPct: null,
      cantidadObtenida: null,
    },
    cleaning: { notes: "" },
    samples: { notes: "" },
    procedureTitle: "PROCEDIMIENTO DE ELABORACIÓN",
    procedureSteps: [],
    processControl: {
      date: "",
      aspecto: "",
      aspectoSpec: "Homogéneo",
      color: "",
      colorSpec: "",
      olor: "",
      olorSpec: "Caracteristico",
      ph: "",
      phSpec: "",
      viscosidad: "",
      viscosidadSpec: "Viscosidad S64, 6 RPM, 25ºC (cPs)",
      cantidadReal: null,
      mermaPct: null,
      cantidadObtenida: null,
      fechaFin: "",
    },
    qualityControl: {
      ensayo: "Análisis del granel",
      resultado: "",
      fecha: "",
    },
    signatures: {
      pesada: null,
      limpieza: null,
      muestras: null,
      calidad: null,
      produccion: null,
      controlCalidad: null,
      direccionTecnica: null,
    },
  };
}

export function createEmptyOaContent(
  overrides?: Partial<OaContent["header"]>
): OaContent {
  return {
    kind: "OA",
    title: "ORDEN DE ACONDICIONAMIENTO",
    header: {
      productName: overrides?.productName ?? "",
      client: overrides?.client ?? "",
      lot: overrides?.lot ?? "",
      analisis: overrides?.analisis ?? "",
      productCode: overrides?.productCode ?? "",
      vto: overrides?.vto ?? "",
      aprobo: overrides?.aprobo ?? "",
      fechaEmision: overrides?.fechaEmision ?? "",
    },
    analisisGranel: { resultado: "", aprobado: null },
    materials: [1, 2, 3, 4, 5].map((n) => emptyOaMaterial(n)),
    materialsFecha: "",
    envasado: { fechaInicio: "", fechaTerminacion: "", operarios: "" },
    rendimientos: {
      produccionTeoricaUnidades: null,
      contenidoTeorico: "",
      fecha: "",
      cantidadUnidades: null,
      rendimientoA: null,
      rangoTeorico: "95-101%",
    },
    observaciones: "",
    controlesPeso: {
      limiteTexto: "Limite inferior/ superior: +/- 5 %",
      fecha: "",
      inicio: "",
      medio: "",
      final: "",
    },
    etiquetadoCodificadoLegalText: OA_ETIQUETADO_LEGAL_TEXT,
    etiquetadoCodificado: { notas: "", fechaResponsable: "" },
    analisisProductoTerminado: { resultado: "" },
    signatures: {
      granel: null,
      pesoInicio: null,
      pesoMedio: null,
      pesoFinal: null,
      productoTerminado: null,
      autorizacionProduccion: null,
      autorizacionControlCalidad: null,
      autorizacionDireccionTecnica: null,
    },
  };
}

/** Recalcula kg a pesar y totales a partir de cantidad y % fórmula. */
export function recomputeOeDerived(content: OeContent): OeContent {
  const qty = content.header.quantityKg;
  const materials = content.materials.map((m) => {
    const kg =
      qty != null && m.formulaPct != null
        ? Number(((qty * m.formulaPct) / 100).toFixed(4))
        : m.kgAPesar;
    return { ...m, kgAPesar: kg };
  });
  const formulaPctSum = materials.reduce((s, m) => s + (m.formulaPct ?? 0), 0);
  const kgSum = materials.reduce((s, m) => s + (m.kgAPesar ?? 0), 0);
  const cantidadReal = content.processControl.cantidadReal ?? content.totals.cantidadReal;
  const cantidadObtenida =
    content.processControl.cantidadObtenida ?? content.totals.cantidadObtenida;
  let mermaPct = content.processControl.mermaPct ?? content.totals.mermaPct;
  if (qty != null && qty > 0 && cantidadObtenida != null) {
    mermaPct = Number((((qty - cantidadObtenida) / qty) * 100).toFixed(2));
  }
  return {
    ...content,
    materials,
    totals: {
      formulaPctSum: Number(formulaPctSum.toFixed(4)),
      kgSum: Number(kgSum.toFixed(4)),
      cantidadReal,
      mermaPct,
      cantidadObtenida,
    },
    processControl: {
      ...content.processControl,
      cantidadReal,
      mermaPct,
      cantidadObtenida,
    },
    signatures: {
      pesada: null,
      limpieza: null,
      muestras: null,
      calidad: null,
      produccion: null,
      controlCalidad: null,
      direccionTecnica: null,
    },
  };
}

export function recomputeOaDerived(content: OaContent): OaContent {
  const teorica = content.rendimientos.produccionTeoricaUnidades;
  const real = content.rendimientos.cantidadUnidades;
  let rendimientoA = content.rendimientos.rendimientoA;
  if (teorica != null && teorica > 0 && real != null) {
    rendimientoA = Number(((real / teorica) * 100).toFixed(2));
  }
  return {
    ...content,
    etiquetadoCodificadoLegalText: OA_ETIQUETADO_LEGAL_TEXT,
    rendimientos: {
      ...content.rendimientos,
      rendimientoA,
      rangoTeorico: "95-101%",
    },
    controlesPeso: {
      ...content.controlesPeso,
      limiteTexto: "Limite inferior/ superior: +/- 5 %",
    },
    signatures: {
      granel: null,
      pesoInicio: null,
      pesoMedio: null,
      pesoFinal: null,
      productoTerminado: null,
      autorizacionProduccion: null,
      autorizacionControlCalidad: null,
      autorizacionDireccionTecnica: null,
    },
  };
}

export function normalizeOrderContent(content: OrderContent): OrderContent {
  if (content.kind === "OE") return recomputeOeDerived(content);
  return recomputeOaDerived(content);
}

export function cloneContent<T extends OrderContent>(content: T): T {
  return structuredClone(content);
}

export function mergeFormOverrides(
  base: OrderContent,
  overrides?: Partial<OrderContent>
): OrderContent {
  if (!overrides) return normalizeOrderContent(cloneContent(base));
  const merged = { ...cloneContent(base), ...overrides } as OrderContent;
  if (merged.kind === "OE" && base.kind === "OE") {
    return normalizeOrderContent({
      ...merged,
      header: { ...base.header, ...(overrides as Partial<OeContent>).header },
    });
  }
  if (merged.kind === "OA" && base.kind === "OA") {
    return normalizeOrderContent({
      ...merged,
      header: { ...base.header, ...(overrides as Partial<OaContent>).header },
    });
  }
  return normalizeOrderContent(merged);
}

/** Porcentaje de completitud para UI (no aparece en PDF). */
export function computeCompletionPercentage(content: OrderContent): number {
  if (content.kind === "OE") {
    const checks = [
      Boolean(content.header.productName),
      Boolean(content.header.date),
      content.header.quantityKg != null,
      Boolean(content.header.lot),
      Boolean(content.header.client),
      content.materials.length > 0,
      content.procedureSteps.length > 0,
      content.processControl.cantidadObtenida != null,
      Boolean(content.processControl.fechaFin),
      Boolean(content.qualityControl.resultado),
    ];
    return Math.round((checks.filter(Boolean).length / checks.length) * 100);
  }
  const checks = [
    Boolean(content.header.productName),
    Boolean(content.header.client),
    Boolean(content.header.lot),
    Boolean(content.header.vto),
    Boolean(content.header.productCode),
    content.materials.some((m) => m.nombreInsumo || m.codigo),
    Boolean(content.envasado.fechaInicio),
    Boolean(content.envasado.operarios),
    content.rendimientos.produccionTeoricaUnidades != null,
    content.rendimientos.cantidadUnidades != null,
    Boolean(content.analisisProductoTerminado.resultado),
  ];
  return Math.round((checks.filter(Boolean).length / checks.length) * 100);
}

export function summarizeContentDiff(
  before: OrderContent,
  after: OrderContent
): string[] {
  const changes: string[] = [];
  const a = JSON.stringify(before);
  const b = JSON.stringify(after);
  if (a === b) return changes;
  if (before.kind === "OE" && after.kind === "OE") {
    if (before.materials.length !== after.materials.length) {
      changes.push(
        `Materias primas: ${before.materials.length} → ${after.materials.length} filas`
      );
    }
    if (
      JSON.stringify(before.procedureSteps) !== JSON.stringify(after.procedureSteps)
    ) {
      changes.push("Procedimiento de elaboración modificado");
    }
    if (before.header.productName !== after.header.productName) {
      changes.push(`Producto: ${before.header.productName} → ${after.header.productName}`);
    }
  }
  if (before.kind === "OA" && after.kind === "OA") {
    if (before.materials.length !== after.materials.length) {
      changes.push(
        `Materiales: ${before.materials.length} → ${after.materials.length} filas`
      );
    }
    if (before.observaciones !== after.observaciones) {
      changes.push("Observaciones modificadas");
    }
  }
  if (changes.length === 0) changes.push("Contenido de plantilla actualizado");
  return changes;
}

export function stepsFromTexts(texts: string[]): OeProcedureStep[] {
  return texts.map((text) => ({ id: rowId(), text }));
}
