/**
 * Modelo de captura simplificada de OA.
 * Separado del modelo legal de impresión (OaContent / PDF).
 */
import {
  emptyOaCarga,
  emptyOaMaterial,
  emptyOaOperario,
  emptyOaPesoFila,
  recomputeOaDerived,
  rendimientoDentroDeRango,
} from "@/lib/orders/content";
import type { OaContent, OaMaterialRow, OaOperarioRow } from "@/lib/orders/types";
import { OA_ETIQUETADO_LEGAL_TEXT } from "@/lib/orders/types";

export type OaSimpleSector = "ENVASADO_MASIVO" | "ENVASADO_PREMIUM" | "";

export type OaSimpleMaterial = {
  id: string;
  nombreInsumo: string;
  codigo: string;
  recibidos: string;
  usados: string;
  desechados: string;
  /** Si true, no recalcular desechados = recibidos - usados. */
  desechadosManual: boolean;
  observacionDesechados: string;
  fechaOverride: string;
  responsableOverride: string;
};

export type OaSimpleControl = {
  id: string;
  inicio: string;
  medio: string;
  final: string;
  resultado: "" | "CONFORME" | "NO_CONFORME";
  observacion: string;
  fechaOverride: string;
  responsableOverride: string;
};

export type OaSimpleForm = {
  fechaJornada: string;
  /** Predeterminado true: una sola fecha se propaga a todo el PDF. */
  todoMismoDia: boolean;
  fechas: {
    emision: string;
    materiales: string;
    inicio: string;
    terminacion: string;
    rendimientos: string;
    controles: string;
    codificado: string;
    analisisPt: string;
  };
  terminoOtroDia: boolean;
  horaInicio: string;
  horaTerminacion: string;

  productName: string;
  client: string;
  productCode: string;
  lot: string;
  vto: string;
  analisis: string;
  aprobo: string;
  sector: OaSimpleSector;

  operarios: OaOperarioRow[];
  /** Responsable general; si vacío se usa el primer operario. */
  responsableGeneral: string;

  materials: OaSimpleMaterial[];
  materialsObs: string;

  produccionTeoricaUnidades: number | null;
  contenidoTeorico: string;
  totalUnidadesLlenadas: number | null;
  unidadesDesechadas: number | null;
  observaciones: string;
  registrarPorTandas: boolean;
  tandas: { id: string; fecha: string; cantidadUnidades: number | null }[];

  controles: OaSimpleControl[];
  limiteTexto: OaContent["controlesPeso"]["limiteTexto"];

  codificado: {
    loteImpreso: string;
    vencimientoImpreso: string;
    resultado: "" | "CONFORME" | "NO_CONFORME";
    observaciones: string;
    fechaOverride: string;
    responsableOverride: string;
  };

  analisisGranel: {
    resultado: string;
    estado: "" | "APROBADO" | "NO_APROBADO" | "NO_INFORMADO";
    observacion: string;
  };
  analisisPt: {
    resultado: string;
    estado: "" | "APROBADO" | "NO_APROBADO" | "NO_INFORMADO";
    observacion: string;
  };
};

function newId(): string {
  if (typeof globalThis.crypto !== "undefined" && "randomUUID" in globalThis.crypto) {
    return globalThis.crypto.randomUUID();
  }
  return `oa-${Math.random().toString(36).slice(2, 10)}`;
}

export function todayIsoDate(now = new Date()): string {
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, "0");
  const d = String(now.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

export function emptyOaSimpleMaterial(partial?: Partial<OaSimpleMaterial>): OaSimpleMaterial {
  return {
    id: newId(),
    nombreInsumo: "",
    codigo: "",
    recibidos: "",
    usados: "",
    desechados: "",
    desechadosManual: false,
    observacionDesechados: "",
    fechaOverride: "",
    responsableOverride: "",
    ...partial,
  };
}

export function emptyOaSimpleControl(partial?: Partial<OaSimpleControl>): OaSimpleControl {
  return {
    id: newId(),
    inicio: "",
    medio: "",
    final: "",
    resultado: "",
    observacion: "",
    fechaOverride: "",
    responsableOverride: "",
    ...partial,
  };
}

export function createEmptyOaSimpleForm(
  overrides?: Partial<Pick<OaSimpleForm, "fechaJornada" | "productName" | "client" | "sector">>
): OaSimpleForm {
  const fecha = overrides?.fechaJornada ?? todayIsoDate();
  return {
    fechaJornada: fecha,
    todoMismoDia: true,
    fechas: {
      emision: "",
      materiales: "",
      inicio: "",
      terminacion: "",
      rendimientos: "",
      controles: "",
      codificado: "",
      analisisPt: "",
    },
    terminoOtroDia: false,
    horaInicio: "",
    horaTerminacion: "",
    productName: overrides?.productName ?? "",
    client: overrides?.client ?? "",
    productCode: "",
    lot: "",
    vto: "",
    analisis: "",
    aprobo: "",
    sector: overrides?.sector ?? "",
    operarios: [emptyOaOperario()],
    responsableGeneral: "",
    materials: [1, 2, 3, 4, 5].map(() => emptyOaSimpleMaterial()),
    materialsObs: "",
    produccionTeoricaUnidades: null,
    contenidoTeorico: "",
    totalUnidadesLlenadas: null,
    unidadesDesechadas: null,
    observaciones: "",
    registrarPorTandas: false,
    tandas: [{ id: newId(), fecha: "", cantidadUnidades: null }],
    controles: [emptyOaSimpleControl()],
    limiteTexto: "Limite inferior/ superior: +/- 5 %",
    codificado: {
      loteImpreso: "",
      vencimientoImpreso: "",
      resultado: "",
      observaciones: "",
      fechaOverride: "",
      responsableOverride: "",
    },
    analisisGranel: { resultado: "", estado: "", observacion: "" },
    analisisPt: { resultado: "", estado: "", observacion: "" },
  };
}

/** valor específico ?? valor general ?? vacío */
export function coalesceValue(
  specific: string | null | undefined,
  general: string | null | undefined
): string {
  const s = (specific ?? "").trim();
  if (s) return s;
  return (general ?? "").trim();
}

export function resolveOaDate(
  override: string | null | undefined,
  fechaJornada: string,
  todoMismoDia: boolean
): string {
  if (!todoMismoDia) {
    const o = (override ?? "").trim();
    if (o) return o;
  }
  return (fechaJornada ?? "").trim();
}

export function resolveResponsableGeneral(simple: OaSimpleForm): string {
  const explicit = simple.responsableGeneral.trim();
  if (explicit) return explicit;
  const first = simple.operarios.map((o) => o.nombre.trim()).find(Boolean);
  return first ?? "";
}

export function computeDesechadosAuto(recibidos: string, usados: string): string {
  const rec = Number(String(recibidos).replace(",", ".").trim());
  const usa = Number(String(usados).replace(",", ".").trim());
  if (!Number.isFinite(rec) || !Number.isFinite(usa)) return "";
  const d = Number((rec - usa).toFixed(4));
  return String(d);
}

export function computeUnidadesAceptadas(
  llenadas: number | null,
  desechadas: number | null
): number | null {
  if (llenadas == null && desechadas == null) return null;
  return Number(((llenadas ?? 0) - (desechadas ?? 0)).toFixed(4));
}

export function computeRendimientoA(
  aceptadas: number | null,
  teorica: number | null
): number | null {
  if (teorica == null || teorica <= 0) return null;
  if (aceptadas == null) return null;
  return Number(((aceptadas / teorica) * 100).toFixed(2));
}

function withOptionalTime(date: string, time: string): string {
  const d = date.trim();
  const t = time.trim();
  if (!d) return "";
  if (!t) return d;
  return `${d} ${t}`;
}

function uniqueNonEmpty(values: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const v of values) {
    const t = v.trim();
    if (!t || seen.has(t)) continue;
    seen.add(t);
    out.push(t);
  }
  return out;
}

function datesLookSame(content: OaContent): boolean {
  const jornada = content.header.fechaEmision.trim();
  if (!jornada) return true;
  const pool = [
    content.materialsFecha,
    content.envasado.fechaInicio,
    content.envasado.fechaTerminacion,
    content.rendimientos.fecha,
    content.controlesPeso.fecha,
    content.etiquetadoCodificado.fechaControl,
  ]
    .map((d) => d.trim().slice(0, 10))
    .filter(Boolean);
  return pool.every((d) => d === jornada.slice(0, 10));
}

/**
 * Deriva el formulario simple desde el modelo legal (para editar órdenes existentes).
 */
export function deriveOaSimpleForm(
  content: OaContent,
  opts?: { sector?: OaSimpleSector; fechaJornadaDefault?: string }
): OaSimpleForm {
  const c = recomputeOaDerived(content);
  const jornada =
    c.header.fechaEmision.trim().slice(0, 10) ||
    opts?.fechaJornadaDefault ||
    todayIsoDate();
  const todoMismoDia = datesLookSame(c);
  const cargas = c.rendimientos.cargasParciales ?? [];
  const filledCargas = cargas.filter((x) => x.cantidadUnidades != null || x.fecha.trim());
  const registrarPorTandas = filledCargas.length > 1;

  const materials: OaSimpleMaterial[] = (c.materials.length ? c.materials : [emptyOaMaterial(1)]).map(
    (m) => {
      const auto = computeDesechadosAuto(m.recibidos, m.usados);
      const desechadosManual =
        Boolean(m.desechados.trim()) &&
        auto !== "" &&
        m.desechados.trim() !== auto;
      return emptyOaSimpleMaterial({
        id: m.id,
        nombreInsumo: m.nombreInsumo,
        codigo: m.codigo,
        recibidos: m.recibidos,
        usados: m.usados,
        desechados: m.desechados,
        desechadosManual,
        observacionDesechados: "",
        fechaOverride: todoMismoDia ? "" : m.fecha,
        responsableOverride: "",
      });
    }
  );

  const filas = c.controlesPeso.filas?.length
    ? c.controlesPeso.filas
    : [emptyOaPesoFila()];
  const controles = filas.map((f) =>
    emptyOaSimpleControl({
      id: f.id,
      inicio: f.inicio,
      medio: f.medio,
      final: f.final,
      resultado: "",
      observacion: "",
      fechaOverride: todoMismoDia ? "" : f.fecha,
      responsableOverride: "",
    })
  );

  const operarios =
    c.envasado.operariosList?.length > 0
      ? c.envasado.operariosList
      : [emptyOaOperario()];

  return {
    fechaJornada: jornada,
    todoMismoDia,
    fechas: {
      emision: todoMismoDia ? "" : c.header.fechaEmision,
      materiales: todoMismoDia ? "" : c.materialsFecha,
      inicio: todoMismoDia ? "" : c.envasado.fechaInicio.slice(0, 10),
      terminacion: todoMismoDia ? "" : c.envasado.fechaTerminacion.slice(0, 10),
      rendimientos: todoMismoDia ? "" : c.rendimientos.fecha,
      controles: todoMismoDia ? "" : c.controlesPeso.fecha,
      codificado: todoMismoDia ? "" : c.etiquetadoCodificado.fechaControl,
      analisisPt: "",
    },
    terminoOtroDia:
      !todoMismoDia &&
      c.envasado.fechaTerminacion.slice(0, 10) !== c.envasado.fechaInicio.slice(0, 10) &&
      Boolean(c.envasado.fechaTerminacion.trim()),
    horaInicio: c.envasado.fechaInicio.includes(" ")
      ? c.envasado.fechaInicio.split(" ").slice(1).join(" ")
      : "",
    horaTerminacion: c.envasado.fechaTerminacion.includes(" ")
      ? c.envasado.fechaTerminacion.split(" ").slice(1).join(" ")
      : "",
    productName: c.header.productName,
    client: c.header.client,
    productCode: c.header.productCode,
    lot: c.header.lot,
    vto: c.header.vto,
    analisis: c.header.analisis,
    aprobo: c.header.aprobo,
    sector: opts?.sector ?? "",
    operarios,
    responsableGeneral: "",
    materials,
    materialsObs: "",
    produccionTeoricaUnidades: c.rendimientos.produccionTeoricaUnidades,
    contenidoTeorico: c.rendimientos.contenidoTeorico,
    totalUnidadesLlenadas: c.rendimientos.cantidadUnidades,
    unidadesDesechadas: c.rendimientos.unidadesDesechadas,
    observaciones: c.observaciones,
    registrarPorTandas,
    tandas: registrarPorTandas
      ? filledCargas.map((t) => ({
          id: t.id,
          fecha: t.fecha,
          cantidadUnidades: t.cantidadUnidades,
        }))
      : [{ id: newId(), fecha: "", cantidadUnidades: null }],
    controles: controles.length ? controles : [emptyOaSimpleControl()],
    limiteTexto: c.controlesPeso.limiteTexto,
    codificado: {
      loteImpreso: c.etiquetadoCodificado.loteCodificado || c.header.lot,
      vencimientoImpreso: c.etiquetadoCodificado.vencimientoCodificado || c.header.vto,
      resultado: c.etiquetadoCodificado.resultado,
      observaciones: c.etiquetadoCodificado.observaciones,
      fechaOverride: todoMismoDia ? "" : c.etiquetadoCodificado.fechaControl,
      responsableOverride: "",
    },
    analisisGranel: {
      resultado: c.analisisGranel.resultado,
      estado:
        c.analisisGranel.aprobado === true
          ? "APROBADO"
          : c.analisisGranel.aprobado === false
            ? "NO_APROBADO"
            : c.analisisGranel.resultado.trim()
              ? "NO_INFORMADO"
              : "",
      observacion: "",
    },
    analisisPt: {
      resultado: c.analisisProductoTerminado.resultado,
      estado: c.analisisProductoTerminado.resultado.trim() ? "NO_INFORMADO" : "",
      observacion: "",
    },
  };
}

/**
 * Inicializa el simple form desde plantilla/legal, aplicando defaults de jornada.
 */
export function initOaSimpleFormFromLegal(
  content: OaContent,
  opts?: { sector?: OaSimpleSector; fechaJornada?: string }
): OaSimpleForm {
  const base = deriveOaSimpleForm(content, {
    sector: opts?.sector,
    fechaJornadaDefault: opts?.fechaJornada ?? todayIsoDate(),
  });
  if (!base.fechaJornada) base.fechaJornada = opts?.fechaJornada ?? todayIsoDate();
  if (!base.codificado.loteImpreso && base.lot) base.codificado.loteImpreso = base.lot;
  if (!base.codificado.vencimientoImpreso && base.vto) {
    base.codificado.vencimientoImpreso = base.vto;
  }
  return base;
}

function mapMaterialRow(
  m: OaSimpleMaterial,
  nro: number,
  fecha: string,
  responsable: string
): OaMaterialRow {
  const desechados = m.desechadosManual
    ? m.desechados
    : m.desechados.trim() || computeDesechadosAuto(m.recibidos, m.usados);
  return emptyOaMaterial(nro, {
    id: m.id,
    codigo: m.codigo,
    nombreInsumo: m.nombreInsumo,
    recibidos: m.recibidos,
    usados: m.usados,
    desechados,
    fecha: coalesceValue(m.fechaOverride, fecha),
    responsable: coalesceValue(m.responsableOverride, responsable),
  });
}

/**
 * Transforma la captura simple al modelo legal completo para PDF/persistencia.
 * Regla: valor específico ?? valor general ?? vacío
 * No elimina secciones del documento legal.
 */
export function mapOASimpleFormToLegalDocument(
  simple: OaSimpleForm,
  base?: OaContent
): OaContent {
  const jornada = simple.fechaJornada.trim();
  const sameDay = simple.todoMismoDia;
  const responsable = resolveResponsableGeneral(simple);

  const fechaEmision = resolveOaDate(simple.fechas.emision, jornada, sameDay);
  const fechaMateriales = resolveOaDate(simple.fechas.materiales, jornada, sameDay);
  const fechaInicioDate = resolveOaDate(simple.fechas.inicio, jornada, sameDay);
  const fechaTermDate = simple.terminoOtroDia
    ? resolveOaDate(simple.fechas.terminacion, jornada, false)
    : resolveOaDate(simple.fechas.terminacion, jornada, sameDay);
  const fechaRendimientos = resolveOaDate(simple.fechas.rendimientos, jornada, sameDay);
  const fechaControles = resolveOaDate(simple.fechas.controles, jornada, sameDay);
  const fechaCodificado = resolveOaDate(
    coalesceValue(simple.codificado.fechaOverride, simple.fechas.codificado),
    jornada,
    sameDay
  );

  const fechaInicio = withOptionalTime(fechaInicioDate, simple.horaInicio);
  const fechaTerminacion = withOptionalTime(fechaTermDate, simple.horaTerminacion);

  const materials = (simple.materials.length ? simple.materials : [emptyOaSimpleMaterial()]).map(
    (m, i) => mapMaterialRow(m, i + 1, fechaMateriales, responsable)
  );

  const aceptadas = computeUnidadesAceptadas(
    simple.totalUnidadesLlenadas,
    simple.unidadesDesechadas
  );
  const rendimientoA = computeRendimientoA(aceptadas, simple.produccionTeoricaUnidades);

  let cargas = simple.registrarPorTandas
    ? (simple.tandas.length
        ? simple.tandas
        : [{ id: newId(), fecha: "", cantidadUnidades: null }]
      ).map((t) =>
        emptyOaCarga({
          id: t.id,
          fecha: coalesceValue(t.fecha, fechaRendimientos),
          cantidadUnidades: t.cantidadUnidades,
        })
      )
    : [
        emptyOaCarga({
          fecha: fechaRendimientos,
          cantidadUnidades: simple.totalUnidadesLlenadas,
        }),
      ];

  // Mantener al menos 3 filas visuales en PDF como la plantilla, sin inventar cantidades.
  while (cargas.length < 3) {
    cargas = [...cargas, emptyOaCarga()];
  }

  const controlesSrc = simple.controles.length ? simple.controles : [emptyOaSimpleControl()];
  let filas = controlesSrc.map((ctrl) =>
    emptyOaPesoFila({
      id: ctrl.id,
      fecha: coalesceValue(ctrl.fechaOverride, fechaControles),
      inicio: ctrl.inicio,
      medio: ctrl.medio,
      final: ctrl.final,
    })
  );
  while (filas.length < 2) {
    filas = [...filas, emptyOaPesoFila({ fecha: fechaControles })];
  }

  const operariosList =
    simple.operarios.length > 0 ? simple.operarios : [emptyOaOperario()];

  const granelEstado = simple.analisisGranel.estado;
  const granelResultado =
    simple.analisisGranel.resultado.trim() ||
    (granelEstado === "APROBADO"
      ? "APROBADO"
      : granelEstado === "NO_APROBADO"
        ? "NO APROBADO"
        : "");

  const ptResultado =
    simple.analisisPt.resultado.trim() ||
    (simple.analisisPt.estado === "APROBADO"
      ? "APROBADO"
      : simple.analisisPt.estado === "NO_APROBADO"
        ? "NO APROBADO"
        : "");

  const obsParts = uniqueNonEmpty([
    simple.observaciones,
    simple.materialsObs,
    ...simple.materials
      .filter((m) => m.desechadosManual && m.observacionDesechados.trim())
      .map((m) => `Desechados ${m.nombreInsumo || m.codigo}: ${m.observacionDesechados}`),
    ...simple.controles
      .filter((c) => c.observacion.trim())
      .map((c) => `Control: ${c.observacion}`),
    simple.analisisGranel.observacion
      ? `Granel: ${simple.analisisGranel.observacion}`
      : "",
    simple.analisisPt.observacion ? `PT: ${simple.analisisPt.observacion}` : "",
  ]);

  const legal: OaContent = {
    kind: "OA",
    title: "ORDEN DE ACONDICIONAMIENTO",
    header: {
      productName: simple.productName,
      client: simple.client,
      lot: simple.lot,
      analisis: simple.analisis,
      productCode: simple.productCode,
      vto: simple.vto,
      aprobo: simple.aprobo,
      fechaEmision,
    },
    analisisGranel: {
      resultado: granelResultado,
      aprobado:
        granelEstado === "APROBADO"
          ? true
          : granelEstado === "NO_APROBADO"
            ? false
            : null,
    },
    materials,
    materialsFecha: fechaMateriales,
    envasado: {
      fechaInicio,
      fechaTerminacion,
      operarios: operariosList
        .map((o) => o.nombre.trim())
        .filter(Boolean)
        .join(", "),
      operariosList,
    },
    rendimientos: {
      produccionTeoricaUnidades: simple.produccionTeoricaUnidades,
      contenidoTeorico: simple.contenidoTeorico,
      fecha: fechaRendimientos,
      cantidadUnidades: simple.totalUnidadesLlenadas,
      unidadesDesechadas: simple.unidadesDesechadas,
      unidadesAceptadas: aceptadas,
      rendimientoA,
      rangoTeorico: "95-101%",
      cargasParciales: cargas,
    },
    observaciones: obsParts.join("\n"),
    controlesPeso: {
      limiteTexto: simple.limiteTexto || "Limite inferior/ superior: +/- 5 %",
      fecha: filas[0]?.fecha ?? fechaControles,
      inicio: filas[0]?.inicio ?? "",
      medio: filas[0]?.medio ?? "",
      final: filas[0]?.final ?? "",
      filas,
    },
    etiquetadoCodificadoLegalText: OA_ETIQUETADO_LEGAL_TEXT,
    etiquetadoCodificado: {
      notas: "",
      fechaResponsable: fechaCodificado,
      loteCodificado: coalesceValue(simple.codificado.loteImpreso, simple.lot),
      vencimientoCodificado: coalesceValue(simple.codificado.vencimientoImpreso, simple.vto),
      fechaControl: fechaCodificado,
      responsable: coalesceValue(simple.codificado.responsableOverride, responsable),
      observaciones: simple.codificado.observaciones,
      resultado: simple.codificado.resultado,
    },
    analisisProductoTerminado: { resultado: ptResultado },
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

  // Conservar textos/límites de plantilla base si no fueron tocados.
  if (base) {
    if (!simple.limiteTexto && base.controlesPeso.limiteTexto) {
      legal.controlesPeso.limiteTexto = base.controlesPeso.limiteTexto;
    }
  }

  return recomputeOaDerived(legal);
}

export function summarizeOaSimpleDerived(simple: OaSimpleForm) {
  const aceptadas = computeUnidadesAceptadas(
    simple.totalUnidadesLlenadas,
    simple.unidadesDesechadas
  );
  const rendimientoA = computeRendimientoA(aceptadas, simple.produccionTeoricaUnidades);
  return {
    aceptadas,
    rendimientoA,
    enRango: rendimientoDentroDeRango(rendimientoA),
    responsable: resolveResponsableGeneral(simple),
  };
}

export function listOaSimplePendingFields(simple: OaSimpleForm): string[] {
  const pending: string[] = [];
  if (!simple.productName.trim()) pending.push("Producto");
  if (!simple.fechaJornada.trim()) pending.push("Fecha de la jornada");
  if (!simple.operarios.some((o) => o.nombre.trim())) pending.push("Operarios");
  if (!simple.materials.some((m) => m.nombreInsumo.trim() || m.codigo.trim())) {
    pending.push("Materiales");
  }
  if (simple.produccionTeoricaUnidades == null) pending.push("Producción teórica");
  if (simple.totalUnidadesLlenadas == null) pending.push("Unidades llenadas");
  return pending;
}

/** Evita imprimir undefined/null/N/A en celdas del PDF. */
export function sanitizeLegalPrintValue(value: unknown): string {
  if (value == null) return "";
  const s = String(value).trim();
  if (!s) return "";
  if (/^(undefined|null|n\/a|na)$/i.test(s)) return "";
  return s;
}
