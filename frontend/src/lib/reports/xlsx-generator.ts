/**
 * Generador del reporte gerencial (.xlsx) — exceljs. Cada hoja se agrega
 * solo si hay datos reales (nunca se crea una hoja vacía por obligación).
 * Sin gráficos nativos: exceljs 4.x no expone ws.addChart — se usa data bar
 * (conditional formatting, sí soportado) para las comparaciones visuales de
 * RESUMEN, y KPI "tiles" con formato fuerte en vez de un dashboard decorativo.
 */
import ExcelJS from "exceljs";
import type { ManagementReportData } from "./types";

const HEADER_FILL: ExcelJS.Fill = {
  type: "pattern",
  pattern: "solid",
  fgColor: { argb: "FF1F2937" },
};
const HEADER_FONT: Partial<ExcelJS.Font> = { color: { argb: "FFFFFFFF" }, bold: true };
const TILE_FILL: ExcelJS.Fill = {
  type: "pattern",
  pattern: "solid",
  fgColor: { argb: "FFEFF6FF" },
};

function styleHeaderRow(ws: ExcelJS.Worksheet, row: number, colCount: number): void {
  const r = ws.getRow(row);
  for (let c = 1; c <= colCount; c += 1) {
    const cell = r.getCell(c);
    cell.fill = HEADER_FILL;
    cell.font = HEADER_FONT;
    cell.border = { bottom: { style: "thin", color: { argb: "FF9CA3AF" } } };
  }
  r.commit?.();
}

function addTableSheet<T extends Record<string, unknown>>(
  wb: ExcelJS.Workbook,
  name: string,
  rows: T[],
  columns: Array<{ key: keyof T & string; header: string; width?: number; numFmt?: string }>
): ExcelJS.Worksheet | null {
  if (rows.length === 0) return null;
  const ws = wb.addWorksheet(name.slice(0, 31));
  ws.columns = columns.map((c) => ({
    key: c.key,
    header: c.header,
    width: c.width ?? Math.max(12, c.header.length + 2),
    style: c.numFmt ? { numFmt: c.numFmt } : undefined,
  }));
  ws.addRows(rows as Record<string, unknown>[]);
  styleHeaderRow(ws, 1, columns.length);
  ws.views = [{ state: "frozen", ySplit: 1 }];
  ws.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1, column: columns.length } };
  return ws;
}

function periodoLabel(from: string, to: string): string {
  return from === to ? from : `${from} a ${to}`;
}

function buildResumenSheet(wb: ExcelJS.Workbook, data: ManagementReportData): void {
  const ws = wb.addWorksheet("RESUMEN");
  ws.getColumn(1).width = 34;
  ws.getColumn(2).width = 20;
  ws.getColumn(3).width = 34;
  ws.getColumn(4).width = 20;

  ws.mergeCells("A1:D1");
  const title = ws.getCell("A1");
  title.value = "GENUS OS — Reporte gerencial";
  title.font = { bold: true, size: 16 };

  ws.getCell("A2").value = `Período: ${periodoLabel(data.filters.from, data.filters.to)}`;
  ws.getCell("A2").font = { italic: true, color: { argb: "FF6B7280" } };
  ws.getCell("A3").value = `Generado: ${new Date(data.generatedAt).toLocaleString("es-AR")}`;
  ws.getCell("A3").font = { italic: true, color: { argb: "FF6B7280" } };

  const tiles: Array<[string, string | number]> = [
    ["Trabajos en el período", data.resumen.totalTrabajos],
    ["Unidades entregables totales", data.resumen.totalEntregable],
    ["Muestras totales", data.resumen.totalMuestras],
    [
      "Tasa de aprobación de Calidad",
      data.resumen.tasaAprobacionCalidadPct != null ? `${data.resumen.tasaAprobacionCalidadPct}%` : "Sin datos",
    ],
    ["Cliente principal", data.resumen.topCliente ?? "Sin datos"],
    ["Producto principal", data.resumen.topProducto ?? "Sin datos"],
  ];

  let row = 5;
  for (let i = 0; i < tiles.length; i += 2) {
    const [labelA, valueA] = tiles[i];
    ws.getCell(row, 1).value = labelA;
    ws.getCell(row, 1).font = { bold: true, size: 10, color: { argb: "FF374151" } };
    ws.getCell(row + 1, 1).value = valueA;
    ws.getCell(row + 1, 1).font = { bold: true, size: 18, color: { argb: "FF1D4ED8" } };
    ws.getCell(row + 1, 1).fill = TILE_FILL;
    ws.getCell(row, 1).fill = TILE_FILL;
    if (tiles[i + 1]) {
      const [labelB, valueB] = tiles[i + 1];
      ws.getCell(row, 3).value = labelB;
      ws.getCell(row, 3).font = { bold: true, size: 10, color: { argb: "FF374151" } };
      ws.getCell(row + 1, 3).value = valueB;
      ws.getCell(row + 1, 3).font = { bold: true, size: 18, color: { argb: "FF1D4ED8" } };
      ws.getCell(row + 1, 3).fill = TILE_FILL;
      ws.getCell(row, 3).fill = TILE_FILL;
    }
    row += 3;
  }

  if (data.clientes.length > 0) {
    row += 1;
    ws.getCell(row, 1).value = "Unidades entregables por cliente";
    ws.getCell(row, 1).font = { bold: true, size: 12 };
    row += 1;
    const startRow = row;
    const top = data.clientes.slice(0, 10);
    for (const c of top) {
      ws.getCell(row, 1).value = c.cliente;
      ws.getCell(row, 2).value = c.unidadesEntregables;
      row += 1;
    }
    if (top.length > 0) {
      // El tipado de exceljs para dataBar no declara `color`/`priority` pese a
      // soportarlos en runtime (verificado) — cast explícito documentado acá.
      ws.addConditionalFormatting({
        ref: `B${startRow}:B${row - 1}`,
        rules: [
          {
            type: "dataBar",
            priority: 1,
            cfvo: [{ type: "min" }, { type: "max" }],
            color: { argb: "FF3B82F6" },
          } as unknown as ExcelJS.ConditionalFormattingRule,
        ],
      });
    }
  }
}

function buildKpisSheet(wb: ExcelJS.Workbook, data: ManagementReportData): void {
  const ws = addTableSheet(wb, "KPIS", data.kpis, [
    { key: "categoria", header: "Categoría", width: 16 },
    { key: "indicador", header: "Indicador", width: 48 },
    { key: "valor", header: "Valor", width: 16 },
    { key: "unidad", header: "Unidad", width: 10 },
    { key: "disponible", header: "Disponible", width: 12 },
    { key: "motivoNoDisponible", header: "Motivo (si no disponible)", width: 60 },
  ]);
  if (!ws) return;
  ws.eachRow((r, idx) => {
    if (idx === 1) return;
    const disponible = r.getCell(5);
    disponible.value = disponible.value ? "Sí" : "No";
    if (disponible.value === "No") {
      for (let c = 1; c <= 6; c += 1) r.getCell(c).font = { color: { argb: "FF9CA3AF" }, italic: true };
    }
  });
}

export function buildManagementReportWorkbook(data: ManagementReportData): ExcelJS.Workbook {
  const wb = new ExcelJS.Workbook();
  wb.creator = "GENUS OS";
  wb.created = new Date(data.generatedAt);

  buildResumenSheet(wb, data);
  buildKpisSheet(wb, data);

  addTableSheet(wb, "CLIENTES", data.clientes, [
    { key: "cliente", header: "Cliente", width: 28 },
    { key: "trabajos", header: "Trabajos", width: 12 },
    { key: "unidadesEntregables", header: "Unidades entregables", width: 20, numFmt: "#,##0.00" },
    { key: "muestras", header: "Muestras", width: 12 },
    { key: "participacionPct", header: "Participación %", width: 16, numFmt: "0.00" },
  ]);

  addTableSheet(wb, "PRODUCTOS", data.productos, [
    { key: "producto", header: "Producto", width: 28 },
    { key: "trabajos", header: "Trabajos", width: 12 },
    { key: "unidadesEntregables", header: "Unidades entregables", width: 20, numFmt: "#,##0.00" },
    { key: "muestras", header: "Muestras", width: 12 },
  ]);

  addTableSheet(wb, "SECTORES", data.sectores, [
    { key: "sector", header: "Sector", width: 22 },
    { key: "trabajos", header: "Trabajos", width: 12 },
    { key: "unidadesEntregables", header: "Unidades entregables", width: 20, numFmt: "#,##0.00" },
    { key: "unidadesPorHoraProm", header: "Unidades/hora (prom.)", width: 20, numFmt: "#,##0.00" },
    { key: "horasPor1000Prom", header: "Horas por 1000 un. (prom.)", width: 24, numFmt: "#,##0.00" },
  ]);

  addTableSheet(
    wb,
    "EMPLEADOS",
    data.empleados.map((e) => ({ ...e, sectores: e.sectores.join(", ") })),
    [
      { key: "empleado", header: "Empleado", width: 28 },
      { key: "trabajos", header: "Trabajos", width: 12 },
      { key: "unidadesEntregables", header: "Unidades entregables", width: 20, numFmt: "#,##0.00" },
      { key: "unidadesPorHoraProm", header: "Unidades/hora (prom.)", width: 20, numFmt: "#,##0.00" },
      { key: "sectores", header: "Sectores", width: 30 },
    ]
  );

  addTableSheet(wb, "PRODUCTIVIDAD", data.productividad, [
    { key: "cliente", header: "Cliente", width: 22 },
    { key: "producto", header: "Producto", width: 22 },
    { key: "sector", header: "Sector", width: 18 },
    { key: "unidadesEntregables", header: "Unidades entregables", width: 20, numFmt: "#,##0.00" },
    { key: "leadTimeHoras", header: "Lead time (h, calendario)", width: 22, numFmt: "#,##0.00" },
    { key: "unidadesPorHora", header: "Unidades/hora", width: 16, numFmt: "#,##0.00" },
    { key: "horasPor1000", header: "Horas por 1000 un.", width: 18, numFmt: "#,##0.00" },
  ]);

  const tiemposWs = addTableSheet(wb, "TIEMPOS", data.tiempos, [
    { key: "cliente", header: "Cliente", width: 22 },
    { key: "producto", header: "Producto", width: 22 },
    { key: "leadTimeCalendarioHoras", header: "Lead time calendario (h)", width: 22, numFmt: "#,##0.00" },
    { key: "codificadoDwellHoras", header: "Permanencia en Codificado (h)", width: 26, numFmt: "#,##0.00" },
    { key: "calidadDecisionHoras", header: "Tiempo hasta decisión de Calidad (h)", width: 30, numFmt: "#,##0.00" },
  ]);
  if (tiemposWs) {
    tiemposWs.getCell(tiemposWs.rowCount + 2, 1).value =
      "Nota: no existe timestamp de inicio real de trabajo distinto de la creación/asignación. " +
      "\"Lead time calendario\" es tiempo transcurrido, no horas efectivas trabajadas.";
    tiemposWs.getCell(tiemposWs.rowCount, 1).font = { italic: true, color: { argb: "FF6B7280" } };
  }

  addTableSheet(wb, "CALIDAD", data.calidad, [
    { key: "cliente", header: "Cliente", width: 22 },
    { key: "producto", header: "Producto", width: 22 },
    { key: "qualityStatus", header: "Estado", width: 14 },
    { key: "primeraDecision", header: "Primera decisión", width: 16 },
    { key: "observacion", header: "Observación registrada", width: 50 },
  ]);

  addTableSheet(wb, "PEDIDOS", data.pedidos, [
    { key: "estado", header: "Estado", width: 20 },
    { key: "cantidad", header: "Cantidad de pedidos", width: 20 },
    { key: "kgTotal", header: "Kg totales", width: 16, numFmt: "#,##0.00" },
  ]);

  addTableSheet(wb, "ENTREGAS", data.entregas, [
    { key: "cliente", header: "Cliente", width: 26 },
    { key: "entregas", header: "Entregas", width: 12 },
    { key: "unidades", header: "Unidades entregadas", width: 20, numFmt: "#,##0.00" },
  ]);

  addTableSheet(wb, "INVENTARIO", data.inventario, [
    { key: "codigo", header: "Código", width: 18 },
    { key: "nombre", header: "Nombre", width: 32 },
    { key: "stockActual", header: "Stock actual", width: 16, numFmt: "#,##0.000" },
  ]);

  addTableSheet(wb, "MUESTRAS", data.muestras, [
    { key: "cliente", header: "Cliente", width: 22 },
    { key: "producto", header: "Producto", width: 22 },
    { key: "muestras", header: "Muestras", width: 12 },
    { key: "producido", header: "Producido (entregable+muestras)", width: 28, numFmt: "#,##0.00" },
    { key: "muestrasPct", header: "Muestras %", width: 14, numFmt: "0.00" },
  ]);

  addTableSheet(wb, "DATOS", data.datos, [
    { key: "workItemId", header: "ID trabajo", width: 38 },
    { key: "cliente", header: "Cliente", width: 22 },
    { key: "producto", header: "Producto", width: 22 },
    { key: "sector", header: "Sector", width: 18 },
    { key: "status", header: "Estado asignación", width: 16 },
    { key: "qualityStatus", header: "Estado Calidad", width: 14 },
    { key: "plannedDate", header: "Fecha planificada", width: 16 },
    { key: "deliveryDate", header: "Fecha de entrega", width: 16 },
    { key: "unidadesAcondicionadas", header: "Acondicionado (cajas+muestras)", width: 26, numFmt: "#,##0.00" },
    { key: "unidadesEntregables", header: "Entregable", width: 16, numFmt: "#,##0.00" },
    { key: "muestras", header: "Muestras", width: 12 },
    { key: "createdAt", header: "Creado", width: 20 },
    { key: "completedAt", header: "Completado", width: 20 },
  ]);

  return wb;
}

/** GENUS_OS_REPORTE_YYYY-MM.xlsx si es un mes calendario completo, si no rango explícito. */
export function buildReportFileName(from: string, to: string): string {
  const [fy, fm, fd] = from.split("-");
  const [ty, tm, td] = to.split("-");
  const sameMonth = fy === ty && fm === tm;
  const lastDayOfMonth = new Date(Number(ty), Number(tm), 0).getDate();
  const isFullMonth = sameMonth && fd === "01" && Number(td) === lastDayOfMonth;
  if (isFullMonth) return `GENUS_OS_REPORTE_${fy}-${fm}.xlsx`;
  return `GENUS_OS_REPORTE_${from}_a_${to}.xlsx`;
}
