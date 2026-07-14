export interface DashboardKpiEntry {
  key: string;
  label: string;
  value: string | number;
  objective?: string;
  status?: string;
}

export interface DashboardSnapshot {
  scannedAt: string;
  sourceFileId: string;
  tab: string;
  kpis: DashboardKpiEntry[];
}

const KPI_ANCHORS: Array<{ anchor: string; key: string; label: string }> = [
  { anchor: "nivel de servicio", key: "nivel_servicio", label: "Nivel de Servicio" },
  { anchor: "pedidos sin reclamos", key: "pedidos_sin_reclamos", label: "Pedidos sin Reclamos" },
  { anchor: "lead time promedio", key: "lead_time_promedio", label: "Lead Time Promedio" },
  { anchor: "pedidos activos", key: "pedidos_activos", label: "Pedidos Activos" },
  { anchor: "entregados", key: "entregados", label: "Entregados" },
  { anchor: "en despacho", key: "en_despacho", label: "En Despacho" },
  { anchor: "consumo masivo", key: "consumo_masivo", label: "Consumo Masivo" },
  { anchor: "productos premium", key: "productos_premium", label: "Productos Premium" },
];

function normalizeKey(text: string): string {
  return text
    .trim()
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");
}

function isNumericCell(value: string): boolean {
  const t = value.trim();
  if (!t) return false;
  return /^-?\d+([.,]\d+)?%?$/.test(t) || /^0\.\d+$/.test(t);
}

/** DashboardParser — KPIs oficiales desde PEDIDOS/Dashboard (solo consumo). */
export function parseDashboardTab(input: {
  fileId: string;
  tab: string;
  rows: string[][];
}): DashboardSnapshot {
  const kpis: DashboardKpiEntry[] = [];
  const found = new Set<string>();

  for (let r = 0; r < input.rows.length; r++) {
    const row = input.rows[r] ?? [];
    for (let c = 0; c < row.length; c++) {
      const cell = row[c]?.trim() ?? "";
      if (!cell) continue;

      const cellKey = normalizeKey(cell);
      for (const def of KPI_ANCHORS) {
        if (found.has(def.key)) continue;
        if (!cellKey.includes(def.anchor)) continue;

        for (let lookAhead = 0; lookAhead <= 3; lookAhead++) {
          const valueCell = row[c + lookAhead + 1]?.trim() ?? row[c + lookAhead]?.trim() ?? "";
          if (isNumericCell(valueCell)) {
            kpis.push({ key: def.key, label: def.label, value: valueCell });
            found.add(def.key);
            break;
          }
        }
      }
    }
  }

  return {
    scannedAt: new Date().toISOString(),
    sourceFileId: input.fileId,
    tab: input.tab,
    kpis,
  };
}

export const DASHBOARD_TABS = ["Dashboard", "KPI"] as const;
