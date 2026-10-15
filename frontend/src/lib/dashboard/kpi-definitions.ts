/**
 * Definición explícita de cada indicador del Dashboard operativo.
 *
 * IMPORTANTE — «criterio propuesto, pendiente de validar contra la planilla»:
 * el Google Sheets «Dashboard Operativo 2026» NO está accesible desde el entorno de desarrollo, así que estas
 * definiciones NO se validaron contra sus fórmulas reales. Se apoyan en (a) lo que GENUS OS registra de verdad y
 * (b) las fórmulas de una copia local antigua del libro (`PEDIDOS 2026 (1).xlsx`), que puede no coincidir con la
 * planilla vigente. Ver `docss/58-dashboard-operativo.md`.
 *
 * Este texto se muestra en pantalla («Ver criterio») y es la fuente de verdad de la documentación.
 */
import type { DashboardAccuracy, DashboardDateBasis, DashboardKpiKey } from "./types";

export type DashboardKpiDefinition = {
  key: DashboardKpiKey;
  label: string;
  /** Fórmula / criterio en lenguaje llano. */
  criterion: string;
  /** Tablas de GENUS OS de las que sale. */
  source: string;
  dateBasis: DashboardDateBasis;
  accuracy: DashboardAccuracy;
  /** Qué parte de la planilla habría que confirmar. */
  pendingValidation: string;
  /** Pie del «Ver criterio» (por defecto: criterio propuesto, pendiente de validar). */
  footnote?: string;
};

/**
 * Glosario: cuatro conceptos que NO se mezclan en el Dashboard. Se muestra en la sección de productividad y en cada
 * criterio, para que nadie compare unidades envasadas con entregadas, pendientes o consumo de materia prima.
 */
export const UNIT_CONCEPTS = [
  { label: "Unidades envasadas", source: "Métricas (packaging_metrics)", text: "lo que Envasado registra como envasado, por fecha, producto y responsable. Es la fuente única de esta sección." },
  { label: "Unidades entregadas", source: "Entregas reales", text: "lo que efectivamente se entregó (fecha de entrega real). Solo se usa para el lead time." },
  { label: "Unidades pendientes", source: "Pedidos y trabajos", text: "lo pedido o planificado que todavía no se terminó o entregó (pedidos activos). No son unidades envasadas." },
  { label: "Consumo de materia prima", source: "Inventario", text: "kilos/litros que salen del stock de MP. No se convierte en unidades ni se suma acá." },
] as const;

const METRICS_FOOTNOTE =
  "Dato exacto: suma directa de los registros activos de Métricas (los eliminados no cuentan), con los mismos filtros de período y sector.";

export const DASHBOARD_KPI_DEFINITIONS: Record<DashboardKpiKey, DashboardKpiDefinition> = {
  nivel_servicio: {
    key: "nivel_servicio",
    label: "Nivel de servicio",
    criterion:
      "Promedio, por pedido, de (unidades producidas por los trabajos ÷ unidades pedidas), en %. Solo pedidos con cantidad pedida (Q) y " +
      "con TODOS sus trabajos de Envasado terminados; las unidades producidas (trabajos, no Métricas) son la suma de la cantidad final de esos " +
      "trabajos. No se limita a 100 %. El período usa la fecha en que terminó el último trabajo del pedido.",
    source: "production_pedidos (q) + work_items de Envasado vinculados por production_pedido_id",
    dateBasis: "produccion",
    accuracy: "adaptado",
    pendingValidation:
      "Confirmar que «nivel de servicio» de la planilla es cantidad producida/pedida (la copia local usa Q envasada vs Q pedida) " +
      "y no entregas en fecha; confirmar si se limita a 100 % y qué pedidos entran (¿solo entregados?).",
  },
  sin_reclamos: {
    key: "sin_reclamos",
    label: "% de pedidos sin reclamos",
    criterion:
      "1 − (pedidos con reclamo ÷ pedidos). GENUS OS no registra reclamos de clientes: no existe ninguna entidad ni campo " +
      "para eso. Los rechazos y «rehacer» de Calidad son internos y NO equivalen a un reclamo, así que no se usan.",
    source: "— (no existe)",
    dateBasis: "pedido",
    accuracy: "sin_datos",
    pendingValidation:
      "La planilla marca los reclamos a mano con una «R» en una columna; confirmar quién la carga y con qué criterio.",
  },
  lead_time: {
    key: "lead_time",
    label: "Lead time promedio",
    criterion:
      "Promedio de días entre la fecha del pedido y la fecha de la última entrega real registrada de ese pedido " +
      "(entregas de Envasado/Codificado, no anuladas ni eliminadas). Igual que la planilla local, solo cuentan plazos " +
      "mayores a 0 y menores a 100 días (el resto se informa como excluido). El período usa la fecha de entrega.",
    source: "production_pedidos (fecha) + work_item_deliveries (actual_delivered_at) vinculadas al pedido",
    dateBasis: "entrega",
    accuracy: "adaptado",
    pendingValidation:
      "La copia local calcula (columna FECHA de EXPEDICION − fecha del pedido): confirmar que esa FECHA es la de «listo para " +
      "entregar» y no la de despacho al cliente; confirmar el filtro > 0 y < 100 días y el cálculo por pedido (no por entrega).",
  },
  unidades_producidas: {
    key: "unidades_producidas",
    label: "Unidades producidas (trabajos)",
    criterion:
      "NO son las unidades envasadas de Métricas: salen de los TRABAJOS terminados y pueden diferir. Para las unidades " +
      "envasadas que registra Envasado ver «Total envasado» (Métricas). Suma de la cantidad final de los trabajos de Envasado Masivo y Premium terminados (incluye los que pasaron por " +
      "Codificado, que cuentan para su sector de origen). Sin trabajos cancelados ni eliminados. Elaboración (kg) y " +
      "Codificado no suman: no son unidades nuevas. El período usa la fecha de cierre de la producción.",
    source: "work_items (finished_qty o packaging_total_units, completed_at, sector de producción)",
    dateBasis: "produccion",
    accuracy: "adaptado",
    pendingValidation:
      "La copia local suma «Q envasada» de EXPEDICION; para Masivo vs Premium suma unidades PEDIDAS por sector (S = M/P). " +
      "Acá se usan unidades PRODUCIDAS en ambos casos: confirmar cuál quieren.",
  },
  pedidos_activos: {
    key: "pedidos_activos",
    label: "Pedidos activos",
    criterion:
      "Pedidos del período (por fecha de pedido) cuyo estado actual es INGRESO, EN ELABORACIÓN, EN ENVASADO o EN CODIFICADO. " +
      "No incluye los listos para entregar ni los entregados (los tres grupos suman el total). Pedidos sin estado se informan aparte.",
    source: "production_pedidos (estado, fecha)",
    dateBasis: "pedido",
    accuracy: "exacto",
    pendingValidation:
      "La planilla cuenta «EN PROCESO + INGRESO» sobre todas las filas del libro; confirmar que no filtra por año.",
  },
  pedidos_entregados: {
    key: "pedidos_entregados",
    label: "Pedidos entregados",
    criterion: "Pedidos del período (por fecha de pedido) con estado ENTREGADO.",
    source: "production_pedidos (estado, fecha)",
    dateBasis: "pedido",
    accuracy: "exacto",
    pendingValidation: "Confirmar que «Acumulado año» de la planilla se refiere al año del pedido y no al de la entrega.",
  },
  pedidos_en_despacho: {
    key: "pedidos_en_despacho",
    label: "Pedidos en despacho",
    criterion:
      "Pedidos del período (por fecha de pedido) con estado LISTO PARA ENTREGAR (GENUS OS no tiene un estado «en despacho» " +
      "separado; la planilla lo define igual: «listos para entregar»).",
    source: "production_pedidos (estado, fecha)",
    dateBasis: "pedido",
    accuracy: "adaptado",
    pendingValidation: "Confirmar que «despacho» = «listo para entregar» y que no hay un paso posterior distinto.",
  },
  productos_distintos: {
    key: "productos_distintos",
    label: "Productos distintos (trabajos)",
    criterion:
      "Cantidad de nombres de producto distintos (sin distinguir mayúsculas, tildes ni espacios extra) entre los trabajos " +
      "de Envasado terminados del período. El producto es texto libre: dos escrituras distintas del mismo producto cuentan como dos.",
    source: "work_items (product, completed_at)",
    dateBasis: "produccion",
    accuracy: "adaptado",
    pendingValidation:
      "La copia local usa COUNTA de la columna PRODUCTO (cuenta filas, no distintos); confirmar si quieren distintos o filas.",
  },
  clientes_activos: {
    key: "clientes_activos",
    label: "Clientes activos",
    criterion:
      "Clientes distintos (normalizados) con al menos un pedido en el período. Los clientes se derivan de los pedidos: " +
      "no existe una tabla de clientes.",
    source: "production_pedidos (cliente, fecha)",
    dateBasis: "pedido",
    accuracy: "adaptado",
    pendingValidation: "La planilla cuenta los clientes de una lista fija (CALCULOS_CLIENTES); confirmar qué es «activo».",
  },
  envasado_total: {
    key: "envasado_total",
    label: "Total envasado (Métricas)",
    criterion:
      "Suma de las unidades de los registros activos de Métricas (Envasado Masivo + Premium) con fecha dentro del período y del " +
      "filtro de sector. Es exactamente el total que muestra Métricas para el mismo período. Unidades ENVASADAS: no son " +
      "entregadas (entregas reales), ni pendientes (pedidos/trabajos), ni consumo de materia prima (inventario).",
    source: "packaging_metrics (units, metric_date, sector; deleted_at nulo) vía el servicio de Métricas",
    dateBasis: "metrica",
    accuracy: "exacto",
    pendingValidation: "Ninguna: es la suma directa del módulo Métricas.",
    footnote: METRICS_FOOTNOTE,
  },
  envasado_masivo: {
    key: "envasado_masivo",
    label: "Total Masivo",
    criterion: "Suma de unidades de los registros activos de Métricas del sector Envasado Masivo en el período.",
    source: "packaging_metrics (sector = ENVASADO_MASIVO)",
    dateBasis: "metrica",
    accuracy: "exacto",
    pendingValidation: "Ninguna.",
    footnote: METRICS_FOOTNOTE,
  },
  envasado_premium: {
    key: "envasado_premium",
    label: "Total Premium",
    criterion: "Suma de unidades de los registros activos de Métricas del sector Envasado Premium en el período.",
    source: "packaging_metrics (sector = ENVASADO_PREMIUM)",
    dateBasis: "metrica",
    accuracy: "exacto",
    pendingValidation: "Ninguna.",
    footnote: METRICS_FOOTNOTE,
  },
  envasado_pct_masivo: {
    key: "envasado_pct_masivo",
    label: "% Masivo",
    criterion: "Total Masivo ÷ Total envasado × 100. Sin unidades en el período no se calcula (no hay división por cero).",
    source: "packaging_metrics",
    dateBasis: "metrica",
    accuracy: "exacto",
    pendingValidation: "Ninguna.",
    footnote: METRICS_FOOTNOTE,
  },
  envasado_pct_premium: {
    key: "envasado_pct_premium",
    label: "% Premium",
    criterion: "Total Premium ÷ Total envasado × 100. Sin unidades en el período no se calcula (no hay división por cero).",
    source: "packaging_metrics",
    dateBasis: "metrica",
    accuracy: "exacto",
    pendingValidation: "Ninguna.",
    footnote: METRICS_FOOTNOTE,
  },
  envasado_promedio_diario: {
    key: "envasado_promedio_diario",
    label: "Promedio diario de envasado",
    criterion:
      "Total envasado ÷ cantidad de FECHAS DISTINTAS con registros válidos de Métricas en el período. Masivo y Premium el mismo " +
      "día cuentan como 1 día. No usa días calendario ni hábiles: solo los días en que hubo registros. Con filtro de sector, " +
      "solo ese sector. Un registro válido es uno activo, con fecha y unidades numéricas (un registro en 0 cuenta como día con registro).",
    source: "packaging_metrics (metric_date distintas, units)",
    dateBasis: "metrica",
    accuracy: "exacto",
    pendingValidation: "Confirmar si un registro con 0 unidades debería contar como día trabajado.",
    footnote: METRICS_FOOTNOTE,
  },
  envasado_mes_mas_productivo: {
    key: "envasado_mes_mas_productivo",
    label: "Mes más productivo",
    criterion:
      "Mes del año seleccionado con más unidades envasadas en Métricas (con el filtro de sector; el filtro de mes no aplica). " +
      "Si hay empate gana el mes más temprano.",
    source: "packaging_metrics (suma de units por mes)",
    dateBasis: "metrica",
    accuracy: "exacto",
    pendingValidation: "Ninguna.",
    footnote: METRICS_FOOTNOTE,
  },
};

/** Definición de objetivos para el semáforo: qué indicadores admiten objetivo y en qué sentido se sugiere. */
export const TARGETABLE_INDICATORS = {
  nivel_servicio: { label: "Nivel de servicio", unit: "percent", defaultDirection: "min" },
  sin_reclamos: { label: "% de pedidos sin reclamos", unit: "percent", defaultDirection: "min" },
  lead_time: { label: "Lead time promedio", unit: "days", defaultDirection: "max" },
  unidades_producidas: { label: "Unidades producidas (trabajos, año completo)", unit: "units", defaultDirection: "min" },
} as const;

export type TargetableKey = keyof typeof TARGETABLE_INDICATORS;

export function isTargetableKey(key: string): key is TargetableKey {
  return Object.prototype.hasOwnProperty.call(TARGETABLE_INDICATORS, key);
}
