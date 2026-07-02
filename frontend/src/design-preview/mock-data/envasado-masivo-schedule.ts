import type { WorkBlockMock } from "@/design-preview/mock-data";
import { addDays, getWorkWeekDays, toIsoDate } from "@/design-preview/lib/calendar-mock";

export type MasivoLineId = "LÍNEA 1" | "LÍNEA 2" | "LÍNEA 3";

export interface MasivoLineSlot {
  lineId: MasivoLineId;
  work: WorkBlockMock | null;
}

export interface MasivoDaySchedule {
  isoDate: string;
  lines: MasivoLineSlot[];
  jobCount: number;
  totalUnits: number;
  statusLabel: string;
  upcomingDeliveries: Array<{ client: string; product: string; when: string }>;
  problems: string[];
}

const LINE_IDS: MasivoLineId[] = ["LÍNEA 1", "LÍNEA 2", "LÍNEA 3"];

function work(
  partial: Omit<WorkBlockMock, "id" | "progress"> & { id?: string; progress?: number }
): WorkBlockMock {
  return {
    progress: 0,
    oaRef: null,
    priority: null,
    ...partial,
    id: partial.id ?? `w-${partial.line}-${partial.client}`,
  };
}

/**
 * Mock SEMANAS 2026 — keyed by ISO date, generado relativo a la semana laboral real.
 * No hardcodea "23 de junio": el miércoles de ESTA semana lleva el trabajo del ejemplo.
 */
export function buildMasivoWeekSchedule(today: Date): Map<string, MasivoDaySchedule> {
  const week = getWorkWeekDays(today);
  const map = new Map<string, MasivoDaySchedule>();

  const templates: Array<Omit<MasivoDaySchedule, "isoDate">> = [
    {
      lines: [
        {
          lineId: "LÍNEA 1",
          work: work({
            line: "LÍNEA 1",
            client: "ICONO",
            product: "Crema Hidratante",
            presentation: "1.200 × 250 ml",
            quantity: "1200",
            delivery: "Esta semana",
            status: "pendiente",
          }),
        },
        { lineId: "LÍNEA 2", work: null },
        { lineId: "LÍNEA 3", work: null },
      ],
      jobCount: 1,
      totalUnits: 1200,
      statusLabel: "1 trabajo",
      upcomingDeliveries: [],
      problems: [],
    },
    {
      lines: [
        {
          lineId: "LÍNEA 1",
          work: work({
            line: "LÍNEA 1",
            client: "NATURA",
            product: "Gel Limpiador",
            presentation: "600 × 400 ml",
            quantity: "600",
            delivery: "Mañana",
            status: "pendiente",
          }),
        },
        {
          lineId: "LÍNEA 2",
          work: work({
            line: "LÍNEA 2",
            client: "BAHIA EVANS",
            product: "Shampoo Reparador",
            presentation: "900 × 350 ml",
            quantity: "900",
            delivery: "Esta semana",
            status: "en_curso",
            oaRef: "OA-2026-2190",
          }),
        },
        { lineId: "LÍNEA 3", work: null },
      ],
      jobCount: 2,
      totalUnits: 1500,
      statusLabel: "2 trabajos",
      upcomingDeliveries: [{ client: "Natura", product: "Gel Limpiador", when: "Mañana" }],
      problems: ["Faltan tapas — L2"],
    },
    {
      lines: [
        {
          lineId: "LÍNEA 1",
          work: work({
            line: "LÍNEA 1",
            client: "THELMA Y LOUISE",
            product: "Exfoliante Arroz",
            presentation: "3.300 × 160 g",
            quantity: "3300",
            delivery: "Hoy",
            status: "pendiente",
            priority: "HOY",
          }),
        },
        {
          lineId: "LÍNEA 2",
          work: work({
            line: "LÍNEA 2",
            client: "BAHIA EVANS",
            product: "Tratamiento Straight",
            presentation: "300 × 200 ml",
            quantity: "300",
            delivery: "Mañana",
            status: "en_curso",
            oaRef: "OA-2026-2205",
            priority: "URGENTE",
            progress: 45,
          }),
        },
        {
          lineId: "LÍNEA 3",
          work: work({
            line: "LÍNEA 3",
            client: "ORIGINAL BLACK",
            product: "After Azul",
            presentation: "2.000 × 400 ml",
            quantity: "2000",
            delivery: "Hoy",
            status: "pendiente",
            priority: "HOY",
          }),
        },
      ],
      jobCount: 3,
      totalUnits: 5600,
      statusLabel: "3 trabajos · día cargado",
      upcomingDeliveries: [
        { client: "Thelma y Louise", product: "Exfoliante Arroz", when: "Hoy" },
        { client: "Original Black", product: "After Azul", when: "Hoy" },
      ],
      problems: ["Urgente — Thelma y Louise", "L2 en progreso — verificar tapas"],
    },
    {
      lines: [
        {
          lineId: "LÍNEA 1",
          work: work({
            line: "LÍNEA 1",
            client: "ICONO",
            product: "Shampoo Nutritivo",
            presentation: "1.500 × 300 ml",
            quantity: "1500",
            delivery: "Esta semana",
            status: "pendiente",
          }),
        },
        { lineId: "LÍNEA 2", work: null },
        {
          lineId: "LÍNEA 3",
          work: work({
            line: "LÍNEA 3",
            client: "NATURA",
            product: "Gel Limpiador",
            presentation: "800 × 400 ml",
            quantity: "800",
            delivery: "Esta semana",
            status: "bloqueado",
            oaRef: "OA-2026-2198",
          }),
        },
      ],
      jobCount: 2,
      totalUnits: 2300,
      statusLabel: "1 bloqueado",
      upcomingDeliveries: [],
      problems: ["L3 bloqueado — esperando liberación"],
    },
    {
      lines: [
        { lineId: "LÍNEA 1", work: null },
        { lineId: "LÍNEA 2", work: null },
        { lineId: "LÍNEA 3", work: null },
      ],
      jobCount: 0,
      totalUnits: 0,
      statusLabel: "Sin trabajos",
      upcomingDeliveries: [{ client: "Icono", product: "Entrega programada", when: "Viernes" }],
      problems: [],
    },
  ];

  week.forEach((day, index) => {
    const template = templates[index] ?? templates[4];
    const iso = toIsoDate(day);

    const lines = LINE_IDS.map((lineId, lineIndex) => {
      const slot = template.lines[lineIndex] ?? { lineId, work: null };
      const w = slot.work;
      if (!w) return { lineId, work: null };

      const deliveryDate =
        w.delivery === "Hoy"
          ? day
          : w.delivery === "Mañana"
            ? addDays(day, 1)
            : addDays(day, 2);

      return {
        lineId,
        work: {
          ...w,
          delivery:
            w.delivery === "Hoy" || w.delivery === "Mañana"
              ? w.delivery
              : ` ${deliveryDate.getDate()}/${deliveryDate.getMonth() + 1}`,
        },
      };
    });

    map.set(iso, {
      isoDate: iso,
      lines,
      jobCount: template.jobCount,
      totalUnits: template.totalUnits,
      statusLabel: template.statusLabel,
      upcomingDeliveries: template.upcomingDeliveries,
      problems: template.problems,
    });
  });

  return map;
}

export function getMasivoScheduleForDate(
  schedule: Map<string, MasivoDaySchedule>,
  date: Date
): MasivoDaySchedule {
  const iso = toIsoDate(date);
  const found = schedule.get(iso);
  if (found) return found;

  return {
    isoDate: iso,
    lines: LINE_IDS.map((lineId) => ({ lineId, work: null })),
    jobCount: 0,
    totalUnits: 0,
    statusLabel: "Sin datos SEMANAS",
    upcomingDeliveries: [],
    problems: [],
  };
}

export function summarizeDay(schedule: MasivoDaySchedule) {
  const works = schedule.lines.map((l) => l.work).filter(Boolean) as WorkBlockMock[];
  return {
    paraHacer: works.filter((w) => w.status === "pendiente").length,
    enProgreso: works.filter((w) => w.status === "en_curso").length,
    terminadas: works.filter((w) => w.status === "completo").length,
    bloqueadas: works.filter((w) => w.status === "bloqueado").length,
  };
}

