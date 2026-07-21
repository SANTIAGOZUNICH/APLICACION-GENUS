import type {
  OaCargaParcialRow,
  OaContent,
  OaMaterialRow,
  OaOperarioRow,
  OaPesoControlRow,
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

export function parseAjusteKg(value: unknown): number | null {
  if (value == null || value === "") return null;
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string") {
    const n = Number(value.replace(",", ".").trim());
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

/** Kg real utilizado = kg teóricos + ajuste (+/-). */
export function computeKgRealUtilizado(
  kgAPesar: number | null,
  ajuste: number | null
): number | null {
  if (kgAPesar == null && ajuste == null) return null;
  return Number(((kgAPesar ?? 0) + (ajuste ?? 0)).toFixed(4));
}

export function emptyOeMaterial(partial?: Partial<OeMaterialRow>): OeMaterialRow {
  const base: OeMaterialRow = {
    id: rowId(),
    materiaPrima: "",
    codigo: "",
    formulaPct: null,
    kgAPesar: null,
    ajuste: null,
    ajusteMotivo: "",
    ajusteAt: null,
    ajusteBy: null,
    lote: "",
  };
  const merged = { ...base, ...partial };
  // Compat: ajuste legacy string
  const rawAjuste = (partial as { ajuste?: unknown } | undefined)?.ajuste;
  if (typeof rawAjuste === "string") {
    merged.ajuste = parseAjusteKg(rawAjuste);
  }
  return merged;
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

export function emptyOaOperario(partial?: Partial<OaOperarioRow>): OaOperarioRow {
  return { id: rowId(), nombre: "", sector: "", ...partial };
}

export function emptyOaCarga(partial?: Partial<OaCargaParcialRow>): OaCargaParcialRow {
  return { id: rowId(), fecha: "", cantidadUnidades: null, ...partial };
}

export function emptyOaPesoFila(partial?: Partial<OaPesoControlRow>): OaPesoControlRow {
  return { id: rowId(), fecha: "", inicio: "", medio: "", final: "", ...partial };
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
      ajusteSum: null,
      kgRealSum: null,
      diferenciaPct: null,
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
    envasado: {
      fechaInicio: "",
      fechaTerminacion: "",
      operarios: "",
      operariosList: [emptyOaOperario()],
    },
    rendimientos: {
      produccionTeoricaUnidades: null,
      contenidoTeorico: "",
      fecha: "",
      cantidadUnidades: null,
      unidadesDesechadas: null,
      unidadesAceptadas: null,
      rendimientoA: null,
      rangoTeorico: "95-101%",
      cargasParciales: [emptyOaCarga(), emptyOaCarga(), emptyOaCarga()],
    },
    observaciones: "",
    controlesPeso: {
      limiteTexto: "Limite inferior/ superior: +/- 5 %",
      fecha: "",
      inicio: "",
      medio: "",
      final: "",
      filas: [emptyOaPesoFila(), emptyOaPesoFila(), emptyOaPesoFila()],
    },
    etiquetadoCodificadoLegalText: OA_ETIQUETADO_LEGAL_TEXT,
    etiquetadoCodificado: {
      notas: "",
      fechaResponsable: "",
      loteCodificado: "",
      vencimientoCodificado: "",
      fechaControl: "",
      responsable: "",
      observaciones: "",
      resultado: "",
    },
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

function migrateOeMaterial(raw: Record<string, unknown>): OeMaterialRow {
  return emptyOeMaterial({
    id: typeof raw.id === "string" ? raw.id : rowId(),
    materiaPrima: String(raw.materiaPrima ?? ""),
    codigo: String(raw.codigo ?? ""),
    formulaPct:
      typeof raw.formulaPct === "number"
        ? raw.formulaPct
        : raw.formulaPct == null || raw.formulaPct === ""
          ? null
          : Number(raw.formulaPct),
    kgAPesar:
      typeof raw.kgAPesar === "number"
        ? raw.kgAPesar
        : raw.kgAPesar == null || raw.kgAPesar === ""
          ? null
          : Number(raw.kgAPesar),
    ajuste: parseAjusteKg(raw.ajuste),
    ajusteMotivo: String(raw.ajusteMotivo ?? ""),
    ajusteAt: typeof raw.ajusteAt === "string" ? raw.ajusteAt : null,
    ajusteBy: typeof raw.ajusteBy === "string" ? raw.ajusteBy : null,
    lote: String(raw.lote ?? ""),
  });
}

/** Recalcula kg a pesar y totales a partir de cantidad y % fórmula. */
export function recomputeOeDerived(content: OeContent): OeContent {
  const qty = content.header.quantityKg;
  const materials = content.materials.map((raw) => {
    const m = migrateOeMaterial(raw as unknown as Record<string, unknown>);
    const kg =
      qty != null && m.formulaPct != null
        ? Number(((qty * m.formulaPct) / 100).toFixed(4))
        : m.kgAPesar;
    return { ...m, kgAPesar: kg };
  });
  const formulaPctSum = materials.reduce((s, m) => s + (m.formulaPct ?? 0), 0);
  const kgSum = materials.reduce((s, m) => s + (m.kgAPesar ?? 0), 0);
  const ajusteSum = materials.reduce((s, m) => s + (m.ajuste ?? 0), 0);
  const kgRealSum = materials.reduce(
    (s, m) => s + (computeKgRealUtilizado(m.kgAPesar, m.ajuste) ?? 0),
    0
  );
  const diferenciaPct =
    kgSum > 0 ? Number((((kgRealSum - kgSum) / kgSum) * 100).toFixed(2)) : null;
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
      ajusteSum: Number(ajusteSum.toFixed(4)),
      kgRealSum: Number(kgRealSum.toFixed(4)),
      diferenciaPct,
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
  const cargas =
    content.rendimientos.cargasParciales?.length > 0
      ? content.rendimientos.cargasParciales
      : content.rendimientos.cantidadUnidades != null
        ? [
            emptyOaCarga({
              fecha: content.rendimientos.fecha,
              cantidadUnidades: content.rendimientos.cantidadUnidades,
            }),
          ]
        : [emptyOaCarga(), emptyOaCarga(), emptyOaCarga()];

  const totalLlenadas = cargas.reduce((s, c) => s + (c.cantidadUnidades ?? 0), 0);
  const desechadas = content.rendimientos.unidadesDesechadas ?? 0;
  const aceptadas = Number((totalLlenadas - desechadas).toFixed(4));
  let rendimientoA: number | null = null;
  if (teorica != null && teorica > 0) {
    rendimientoA = Number(((aceptadas / teorica) * 100).toFixed(2));
  }

  const operariosList =
    content.envasado.operariosList?.length > 0
      ? content.envasado.operariosList
      : content.envasado.operarios
        ? content.envasado.operarios
            .split(/[,;\n]+/)
            .map((n) => n.trim())
            .filter(Boolean)
            .map((nombre) => emptyOaOperario({ nombre }))
        : [emptyOaOperario()];

  const filas =
    content.controlesPeso.filas?.length > 0
      ? content.controlesPeso.filas
      : [
          emptyOaPesoFila({
            fecha: content.controlesPeso.fecha,
            inicio: content.controlesPeso.inicio,
            medio: content.controlesPeso.medio,
            final: content.controlesPeso.final,
          }),
          emptyOaPesoFila(),
          emptyOaPesoFila(),
        ];

  const etiquetado = {
    notas: content.etiquetadoCodificado.notas ?? "",
    fechaResponsable: content.etiquetadoCodificado.fechaResponsable ?? "",
    loteCodificado: content.etiquetadoCodificado.loteCodificado ?? "",
    vencimientoCodificado: content.etiquetadoCodificado.vencimientoCodificado ?? "",
    fechaControl: content.etiquetadoCodificado.fechaControl ?? "",
    responsable: content.etiquetadoCodificado.responsable ?? "",
    observaciones: content.etiquetadoCodificado.observaciones ?? "",
    resultado: content.etiquetadoCodificado.resultado ?? ("" as const),
  };

  return {
    ...content,
    etiquetadoCodificadoLegalText: OA_ETIQUETADO_LEGAL_TEXT,
    envasado: {
      ...content.envasado,
      operariosList,
      operarios: operariosList
        .map((o) => o.nombre)
        .filter(Boolean)
        .join(", "),
    },
    rendimientos: {
      ...content.rendimientos,
      cargasParciales: cargas,
      cantidadUnidades: totalLlenadas > 0 || teorica != null ? totalLlenadas : null,
      unidadesDesechadas: content.rendimientos.unidadesDesechadas ?? null,
      unidadesAceptadas: teorica != null || totalLlenadas > 0 ? aceptadas : null,
      rendimientoA,
      rangoTeorico: "95-101%",
    },
    controlesPeso: {
      ...content.controlesPeso,
      limiteTexto: "Limite inferior/ superior: +/- 5 %",
      filas,
      fecha: filas[0]?.fecha ?? "",
      inicio: filas[0]?.inicio ?? "",
      medio: filas[0]?.medio ?? "",
      final: filas[0]?.final ?? "",
    },
    etiquetadoCodificado: etiquetado,
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
  const c = recomputeOaDerived(content);
  const checks = [
    Boolean(c.header.productName),
    Boolean(c.header.client),
    Boolean(c.header.lot),
    Boolean(c.header.vto),
    Boolean(c.header.productCode),
    c.materials.some((m) => m.nombreInsumo || m.codigo),
    Boolean(c.envasado.fechaInicio),
    c.envasado.operariosList.some((o) => o.nombre.trim()) || Boolean(c.envasado.operarios),
    c.rendimientos.produccionTeoricaUnidades != null,
    (c.rendimientos.cantidadUnidades ?? 0) > 0,
    Boolean(c.analisisProductoTerminado.resultado),
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
    const formulaChanged = before.materials.some((m, i) => {
      const n = after.materials[i];
      return !n || m.formulaPct !== n.formulaPct || m.materiaPrima !== n.materiaPrima;
    });
    if (formulaChanged) changes.push("Fórmula / ingredientes modificados");
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

export function formulaFingerprint(content: OeContent): string {
  return JSON.stringify(
    content.materials.map((m) => ({
      materiaPrima: m.materiaPrima,
      codigo: m.codigo,
      formulaPct: m.formulaPct,
      kgAPesar: m.kgAPesar,
    }))
  );
}

export function rendimientoDentroDeRango(rendimientoA: number | null): boolean | null {
  if (rendimientoA == null) return null;
  return rendimientoA >= 95 && rendimientoA <= 101;
}
