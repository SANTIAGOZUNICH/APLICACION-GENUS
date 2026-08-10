/**
 * Smoke E2E — PARTE B (reporte gerencial) contra Preview DB, con el dataset
 * controlado exacto del usuario:
 *   Trabajo A: Cliente A / Producto X / 1002 acondicionadas / 2 muestras / 1000 entregables / 3h
 *   Trabajo B: Cliente A / Producto Y / 2000 entregables / 4h
 *   Trabajo C: Cliente B / Producto X / 500 entregables / 2h
 *
 * Ejercita el pipeline real completo: fetchReportDataset() (SQL real contra
 * Neon, sin server-only) → buildManagementReport() (agregación) →
 * buildManagementReportWorkbook() (xlsx real) — no solo los tests unitarios
 * con objetos JS planos.
 *
 * Uso: node --import tsx scripts/_smoke_management_report_dataset.mjs seed
 *      node --import tsx scripts/_smoke_management_report_dataset.mjs verify
 *      node --import tsx scripts/_smoke_management_report_dataset.mjs cleanup
 * Env: DATABASE_URL / DATABASE_URL_UNPOOLED.
 */
import { Pool, neonConfig } from "@neondatabase/serverless";
import { drizzle } from "drizzle-orm/neon-serverless";
import { eq, like } from "drizzle-orm";
import ws from "ws";
import * as schema from "../src/lib/db/schema.ts";
import { fetchReportDataset } from "../src/lib/reports/data-fetch.ts";
import { buildManagementReport } from "../src/lib/reports/analytics.ts";
import { buildManagementReportWorkbook } from "../src/lib/reports/xlsx-generator.ts";

neonConfig.webSocketConstructor = ws;

const mode = process.argv[2];
const url = process.env.DATABASE_URL_UNPOOLED?.trim() || process.env.DATABASE_URL?.trim();
if (!url) throw new Error("No DATABASE_URL");
const pool = new Pool({ connectionString: url });
const db = drizzle(pool, { schema });

const PLANNED_DATE = "2026-08-05";
const MARKER = "SMOKE-PARTE-B";

function mondayOf(d) {
  const day = d.getUTCDay();
  const diff = (day === 0 ? -6 : 1) - day;
  const monday = new Date(d);
  monday.setUTCDate(d.getUTCDate() + diff);
  return monday.toISOString().slice(0, 10);
}

if (mode === "seed") {
  const weekStart = mondayOf(new Date(`${PLANNED_DATE}T00:00:00.000Z`));
  const [week] = await db
    .insert(schema.planningWeeks)
    .values({ weekStart, label: `Semana ${weekStart}`, status: "PUBLISHED", createdBy: MARKER })
    .onConflictDoUpdate({ target: schema.planningWeeks.weekStart, set: { status: "PUBLISHED" } })
    .returning();

  const created9 = new Date("2026-08-05T09:00:00.000Z");
  const jobs = [
    {
      client: `${MARKER} Cliente A`,
      product: `${MARKER} Producto X`,
      deliverableUnits: 1000,
      sampleUnits: 2,
      hours: 3,
    },
    {
      client: `${MARKER} Cliente A`,
      product: `${MARKER} Producto Y`,
      deliverableUnits: 2000,
      sampleUnits: 0,
      hours: 4,
    },
    {
      client: `${MARKER} Cliente B`,
      product: `${MARKER} Producto X`,
      deliverableUnits: 500,
      sampleUnits: 0,
      hours: 2,
    },
  ];

  const ids = [];
  for (const job of jobs) {
    const completedAt = new Date(created9.getTime() + job.hours * 3_600_000);
    const [row] = await db
      .insert(schema.workItems)
      .values({
        planningWeekId: week.id,
        plannedDate: PLANNED_DATE,
        client: job.client,
        product: job.product,
        plannedQuantity: String(job.deliverableUnits + job.sampleUnits),
        unit: "un.",
        sector: "ENVASADO_MASIVO",
        line: "Línea 1",
        status: "PUBLICADO",
        createdBy: MARKER,
        createdAt: created9,
        operationalStatus: "entregado",
        qualityStatus: "aprobado",
        completedAt,
        completedBy: MARKER,
        deliverableUnits: job.deliverableUnits,
        sampleUnits: job.sampleUnits,
        packagingTotalUnits: job.deliverableUnits + job.sampleUnits,
      })
      .returning();
    ids.push(row.id);
    console.log(`[seed] ${job.client} / ${job.product} → ${row.id}`);
  }
  console.log("[seed] OK");
  await pool.end();
  process.exit(0);
}

if (mode === "verify") {
  const dataset = await fetchReportDataset(db, { from: PLANNED_DATE, to: PLANNED_DATE });
  const scoped = {
    ...dataset,
    workItems: dataset.workItems.filter((w) => w.client.startsWith(MARKER)),
  };
  const report = buildManagementReport(scoped, { from: PLANNED_DATE, to: PLANNED_DATE });

  const checks = [];
  const check = (label, cond) => checks.push({ label, ok: Boolean(cond) });

  check("3 trabajos en el período", report.resumen.totalTrabajos === 3);
  check("total entregable = 3500", report.resumen.totalEntregable === 3500);
  check("total muestras = 2", report.resumen.totalMuestras === 2);

  const clienteA = report.clientes.find((c) => c.cliente === `${MARKER} Cliente A`);
  const clienteB = report.clientes.find((c) => c.cliente === `${MARKER} Cliente B`);
  check("Cliente A: 2 trabajos, 3000 entregable", clienteA?.trabajos === 2 && clienteA?.unidadesEntregables === 3000);
  check("Cliente B: 1 trabajo, 500 entregable", clienteB?.trabajos === 1 && clienteB?.unidadesEntregables === 500);
  check("Cliente A participación ≈ 85.71%", clienteA && Math.abs(clienteA.participacionPct - 85.71) < 0.5);

  const prodX = report.productos.find((p) => p.producto === `${MARKER} Producto X`);
  check("Producto X: 2 trabajos, 1500 entregable", prodX?.trabajos === 2 && prodX?.unidadesEntregables === 1500);

  const a = report.productividad.find((p) => p.cliente === `${MARKER} Cliente A` && p.unidadesEntregables === 1000);
  const b = report.productividad.find((p) => p.unidadesEntregables === 2000);
  const c = report.productividad.find((p) => p.unidadesEntregables === 500);
  check("Trabajo A unidades/hora ≈ 333.33", a && Math.abs(a.unidadesPorHora - 333.33) < 0.5);
  check("Trabajo B unidades/hora = 500", b?.unidadesPorHora === 500);
  check("Trabajo C unidades/hora = 250", c?.unidadesPorHora === 250);

  const muestraRow = report.muestras.find((m) => m.cliente === `${MARKER} Cliente A` && m.producto === `${MARKER} Producto X`);
  check("Muestras: 2, producido 1002", muestraRow?.muestras === 2 && muestraRow?.producido === 1002);

  const wb = buildManagementReportWorkbook(report);
  const buf = await wb.xlsx.writeBuffer();
  check("xlsx generado (bytes > 0)", buf.byteLength > 0);
  const sheetNames = wb.worksheets.map((s) => s.name);
  check(
    "hojas esperadas presentes",
    ["RESUMEN", "KPIS", "CLIENTES", "PRODUCTOS", "PRODUCTIVIDAD", "MUESTRAS", "DATOS"].every((n) =>
      sheetNames.includes(n)
    )
  );

  let allOk = true;
  for (const c of checks) {
    console.log(`${c.ok ? "[OK]  " : "[FAIL]"} ${c.label}`);
    if (!c.ok) allOk = false;
  }
  await pool.end();
  process.exit(allOk ? 0 : 1);
}

if (mode === "cleanup") {
  await db.delete(schema.workItems).where(like(schema.workItems.client, `${MARKER}%`));
  console.log("[cleanup] eliminados trabajos de smoke PARTE B");
  await pool.end();
  process.exit(0);
}

console.error("Modo desconocido. Usar seed | verify | cleanup.");
process.exit(1);
