/** F9 wireframe mock data — UI only, no backend. */

export interface WorkBlockMock {
  id: string;
  line: string;
  client: string;
  product: string;
  presentation: string;
  quantity: string;
  delivery: string;
  progress: number;
  status: "pendiente" | "en_curso" | "completo" | "bloqueado";
  oaRef?: string | null;
  priority?: string | null;
}

export interface ElaboracionBlockMock {
  id: string;
  client: string;
  product: string;
  quantity: string;
  kg: string;
  responsable: string;
  oe: string;
  status: "pendiente" | "en_curso" | "completo";
}

export interface QualityRowMock {
  id: string;
  lote: string;
  product: string;
  client: string;
  oe: string;
  oa: string;
  result: string;
  liberation?: string;
  section: "pendientes" | "resultados" | "liberaciones" | "bloqueados";
}

export interface DepositoOrderMock {
  id: string;
  client: string;
  product: string;
  quantity: string;
  envases: number;
  tapas: number;
  etiquetas: number;
  cajas: number;
}

export const ENVASADO_MASIVO_BLOCKS: WorkBlockMock[] = [
  {
    id: "em-1",
    line: "LÍNEA 1",
    client: "THELMA Y LOUISE",
    product: "Exfoliante Arroz",
    presentation: "3.300 × 160 g",
    quantity: "3.300 unidades",
    delivery: "Hoy",
    progress: 0,
    status: "pendiente",
    oaRef: null,
    priority: "HOY",
  },
  {
    id: "em-2",
    line: "LÍNEA 2",
    client: "BAHIA EVANS",
    product: "Tratamiento Straight",
    presentation: "300 × 200 ml",
    quantity: "300 unidades",
    delivery: "Hoy",
    progress: 45,
    status: "en_curso",
    oaRef: "OA-2026-2205",
    priority: "URGENTE",
  },
  {
    id: "em-3",
    line: "LÍNEA 1",
    client: "ICONO",
    product: "Crema Hidratante",
    presentation: "1.200 × 250 ml",
    quantity: "1.200 unidades",
    delivery: "Miércoles",
    progress: 0,
    status: "pendiente",
    oaRef: null,
    priority: "ESTA SEMANA",
  },
  {
    id: "em-4",
    line: "LÍNEA 3",
    client: "NATURA",
    product: "Gel Limpiador",
    presentation: "800 × 400 ml",
    quantity: "800 unidades",
    delivery: "Viernes",
    progress: 0,
    status: "bloqueado",
    oaRef: "OA-2026-2198",
    priority: null,
  },
];

export const ENVASADO_PREMIUM_BLOCKS: WorkBlockMock[] = [
  {
    id: "ep-1",
    line: "PREMIUM A",
    client: "NATURA",
    product: "Serum Vitamina C",
    presentation: "500 × 30 ml",
    quantity: "500 unidades",
    delivery: "Hoy",
    progress: 20,
    status: "en_curso",
    oaRef: "OA-P-1102",
    priority: "HOY",
  },
  {
    id: "ep-2",
    line: "PREMIUM B",
    client: "LAB PREMIUM",
    product: "Aceite Facial",
    presentation: "200 × 50 ml",
    quantity: "200 unidades",
    delivery: "Jueves",
    progress: 0,
    status: "pendiente",
    oaRef: null,
    priority: null,
  },
];

export const ELABORACION_BLOCKS: ElaboracionBlockMock[] = [
  {
    id: "el-1",
    client: "THELMA Y LOUISE",
    product: "Exfoliante Arroz",
    quantity: "330 kg",
    kg: "330",
    responsable: "María G.",
    oe: "OE-2026-0142",
    status: "pendiente",
  },
  {
    id: "el-2",
    client: "BAHIA EVANS",
    product: "Tratamiento Straight",
    quantity: "180 kg",
    kg: "180",
    responsable: "Carlos R.",
    oe: "OE-2026-0145",
    status: "en_curso",
  },
];

export const CALIDAD_ROWS: QualityRowMock[] = [
  {
    id: "q-1",
    lote: "L-2026-0891",
    product: "Exfoliante Arroz",
    client: "THELMA Y LOUISE",
    oe: "OE-0142",
    oa: "—",
    result: "Pendiente",
    section: "pendientes",
  },
  {
    id: "q-2",
    lote: "L-2026-0887",
    product: "Crema Hidratante",
    client: "ICONO",
    oe: "OE-0138",
    oa: "OA-2201",
    result: "Micro OK",
    section: "resultados",
  },
  {
    id: "q-3",
    lote: "L-2026-0875",
    product: "Shampoo Reparador",
    client: "NATURA",
    oe: "OE-0129",
    oa: "OA-2190",
    result: "Conforme",
    liberation: "Pendiente DT",
    section: "liberaciones",
  },
  {
    id: "q-4",
    lote: "L-2026-0862",
    product: "Gel Limpiador",
    client: "BAHIA EVANS",
    oe: "OE-0120",
    oa: "—",
    result: "Fuera de spec",
    section: "bloqueados",
  },
];

export const DEPOSITO_ORDERS: DepositoOrderMock[] = [
  {
    id: "dep-1",
    client: "THELMA Y LOUISE",
    product: "Exfoliante Arroz 160g",
    quantity: "3.300 u",
    envases: 3300,
    tapas: 3300,
    etiquetas: 3300,
    cajas: 275,
  },
  {
    id: "dep-2",
    client: "BAHIA EVANS",
    product: "Tratamiento Straight 200ml",
    quantity: "300 u",
    envases: 300,
    tapas: 300,
    etiquetas: 300,
    cajas: 25,
  },
];

export const PRODUCCION_SECTORS = [
  { id: "elaboracion", label: "Elaboración", delayed: false, stopped: false, fill: 6 },
  { id: "masivo", label: "Masivo", delayed: true, stopped: false, fill: 4 },
  { id: "premium", label: "Premium", delayed: false, stopped: true, fill: 3 },
  { id: "codificado", label: "Codificado", delayed: false, stopped: false, fill: 4 },
  { id: "calidad", label: "Calidad", delayed: true, stopped: false, fill: 2 },
];

export const PRODUCCION_PROBLEMS = [
  { type: "atrasado", text: "Masivo — L2 detenida 40 min" },
  { type: "bloqueado", text: "Pedido Icono — esperando Elaboración" },
  { type: "bloqueado", text: "L-2026-0891 — esperando Calidad" },
  { type: "insumo", text: "Faltan envases — Thelma y Louise" },
  { type: "urgente", text: "Thelma y Louise — entrega HOY" },
  { type: "accion", text: "Comenzar ahora — OA-2205 Masivo L2" },
];

export const PLAN_SEMANAL_DAYS = [
  {
    day: "Lunes",
    date: "22",
    lines: [
      { line: "L1", client: "Thelma y Louise", product: "Exfoliante Arroz", qty: "3300u" },
      { line: "PA", client: "Natura", product: "Serum Vit C", qty: "500u" },
    ],
  },
  {
    day: "Martes",
    date: "23",
    today: true,
    lines: [
      { line: "L2", client: "Bahia Evans", product: "Trat. Straight", qty: "300u" },
      { line: "L1", client: "Icono", product: "Crema Hidratante", qty: "1200u" },
    ],
  },
  {
    day: "Miércoles",
    date: "24",
    lines: [{ line: "PB", client: "Lab Premium", product: "Aceite Facial", qty: "200u" }],
  },
  {
    day: "Jueves",
    date: "25",
    lines: [
      { line: "L3", client: "Natura", product: "Gel Limpiador", qty: "800u" },
      { line: "L1", client: "Icono", product: "Shampoo", qty: "1500u" },
    ],
  },
  {
    day: "Viernes",
    date: "26",
    lines: [
      { line: "—", client: "Icono", product: "Entrega", qty: "—" },
      { line: "—", client: "Natura", product: "Entrega", qty: "—" },
    ],
  },
];

export const CONSULTA_RESULTS = [
  { type: "Pedido", label: "PED-2026-0442", meta: "Thelma y Louise · Exfoliante Arroz" },
  { type: "OE", label: "OE-2026-0142", meta: "Exfoliante Arroz · 330 kg" },
  { type: "Lote", label: "L-2026-0891", meta: "Cuarentena" },
  { type: "Cliente", label: "THELMA Y LOUISE", meta: "3 activos" },
];

export const DIRECCION_SIGNALS = [
  { area: "Producción", signal: "Masivo atrasado · L2" },
  { area: "Pedidos", signal: "3 en riesgo esta semana" },
  { area: "Entregas", signal: "5 programadas hoy" },
  { area: "Alertas", signal: "1 pedido urgente" },
];
