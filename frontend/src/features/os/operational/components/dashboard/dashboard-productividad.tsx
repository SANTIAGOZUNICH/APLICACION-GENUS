"use client";

import { ArrowDown, ArrowUp, Equal } from "lucide-react";
import { fmtInt, fmtPercent, monthName } from "@/lib/dashboard/format";
import { UNIT_CONCEPTS } from "@/lib/dashboard/kpi-definitions";
import type {
  DashboardFilters,
  DashboardPayload,
  DashboardProductividad,
  DashboardProductividadMonth,
  DashboardResponsibleColumn,
  DashboardResponsibleRow,
  DashboardTrend,
} from "@/lib/dashboard/types";
import { DashboardBarChart, MASIVO_COLOR, PREMIUM_COLOR } from "./dashboard-bar-chart";
import { DashboardKpiCard } from "./dashboard-kpi-card";
import { DashboardPodium } from "./dashboard-podium";

const TOTAL_COLOR = "#3b82f6";
const BEST_MONTH_COLOR = "#f59e0b";
const DAILY_COLOR = "#fb7185";

const CARD = "min-w-0 rounded-[var(--os-radius)] border border-[var(--os-border)] bg-[var(--os-surface)] p-4 shadow-[var(--os-shadow-sm)]";

/** Glosario: unidades envasadas vs entregadas vs pendientes vs consumo de MP. */
export function UnitConcepts() {
  return (
    <details className={`${CARD} text-xs`} data-testid="unit-concepts">
      <summary className="cursor-pointer text-sm font-semibold text-[var(--os-text)]">¿Qué mide cada número? (envasadas, entregadas, pendientes y consumo de MP)</summary>
      <dl className="mt-3 grid gap-2 sm:grid-cols-2">
        {UNIT_CONCEPTS.map((c) => (
          <div key={c.label} className="min-w-0 rounded-[var(--os-radius-sm)] bg-black/10 p-2.5">
            <dt className="font-semibold text-[var(--os-text)]">
              {c.label} <span className="font-normal text-[var(--os-text-muted)]">· {c.source}</span>
            </dt>
            <dd className="mt-0.5 leading-snug text-[var(--os-text-muted)]">{c.text}</dd>
          </div>
        ))}
      </dl>
    </details>
  );
}

export function TrendBadge({ trend, pct }: { trend: DashboardTrend | null; pct: number | null }) {
  if (!trend) return <span className="text-[var(--os-text-muted)]">—</span>;
  const cfg =
    trend === "SUBE"
      ? { Icon: ArrowUp, cls: "text-emerald-500", label: "SUBE" }
      : trend === "BAJA"
        ? { Icon: ArrowDown, cls: "text-red-500", label: "BAJA" }
        : { Icon: Equal, cls: "text-[var(--os-text-muted)]", label: "IGUAL" };
  return (
    <span className={`inline-flex items-center gap-1 font-semibold ${cfg.cls}`} data-testid={`trend-${trend}`}>
      <cfg.Icon className="size-3.5" aria-hidden="true" />
      {cfg.label}
      {pct != null ? <span className="font-normal tabular-nums">({pct > 0 ? "+" : ""}{pct.toLocaleString("es-AR", { minimumFractionDigits: 1, maximumFractionDigits: 1 })} %)</span> : null}
    </span>
  );
}

function ShareBar({ masivo, premium }: { masivo: number | null; premium: number | null }) {
  if (masivo == null && premium == null) return null;
  const m = masivo ?? 0;
  const p = premium ?? 0;
  return (
    <div className={CARD} data-testid="prod-participacion">
      <h3 className="text-sm font-semibold text-[var(--os-text)]">Participación Masivo / Premium</h3>
      <div className="mt-3 flex h-4 w-full overflow-hidden rounded-full bg-white/[0.07]" role="img" aria-label={`Masivo ${fmtPercent(m)}, Premium ${fmtPercent(p)}`}>
        <div style={{ width: `${m}%`, background: MASIVO_COLOR }} />
        <div style={{ width: `${p}%`, background: PREMIUM_COLOR }} />
      </div>
      <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-[var(--os-text-muted)]">
        <span className="inline-flex items-center gap-1.5">
          <span className="size-2.5 rounded-sm" style={{ background: MASIVO_COLOR }} aria-hidden="true" />
          Consumo Masivo <b className="text-[var(--os-text)]">{fmtPercent(m)}</b>
        </span>
        <span className="inline-flex items-center gap-1.5">
          <span className="size-2.5 rounded-sm" style={{ background: PREMIUM_COLOR }} aria-hidden="true" />
          Premium <b className="text-[var(--os-text)]">{fmtPercent(p)}</b>
        </span>
      </div>
    </div>
  );
}

function Insight({ title, row, tone, testId, empty }: { title: string; row: DashboardResponsibleRow | null; tone: string; testId: string; empty: string }) {
  return (
    <article
      className="min-w-0 rounded-[var(--os-radius)] border p-4"
      style={{ borderColor: `color-mix(in srgb, ${tone} 45%, var(--os-border))`, background: `color-mix(in srgb, ${tone} 10%, var(--os-surface))`, borderTopWidth: 3, borderTopColor: tone }}
      data-testid={testId}
    >
      <h3 className="text-xs font-semibold uppercase tracking-wide text-[var(--os-text-muted)]">{title}</h3>
      {row ? (
        <>
          <p className="mt-1 break-words text-lg font-bold leading-tight text-[var(--os-text)]" data-testid={`${testId}-name`}>
            {row.name}
          </p>
          <p className="text-xs text-[var(--os-text-muted)]">
            <span className="font-semibold tabular-nums text-[var(--os-text)]">{fmtInt(row.units)}</span> unidades · {fmtPercent(row.share)} del total
          </p>
        </>
      ) : (
        <p className="mt-1 text-base font-semibold text-[var(--os-text)]">Sin datos suficientes</p>
      )}
      {!row ? <p className="text-xs text-[var(--os-text-muted)]">{empty}</p> : null}
    </article>
  );
}

function RankingList({ ranking }: { ranking: DashboardResponsibleRow[] }) {
  if (!ranking.length) return null;
  let pos = 0;
  return (
    <div className={CARD} data-testid="ranking-responsables">
      <h3 className="text-sm font-semibold text-[var(--os-text)]">Ranking completo de responsables</h3>
      <p className="mb-2 text-xs text-[var(--os-text-muted)]">Unidades envasadas por responsable (campo RESPONSABLE de Métricas), de mayor a menor.</p>
      <ol className="space-y-2">
        {ranking.map((r) => {
          if (!r.unassigned) pos += 1;
          return (
            <li key={r.key} className="min-w-0" data-testid="ranking-row" data-key={r.key} data-unassigned={r.unassigned ? "1" : "0"}>
              <div className="flex min-w-0 items-baseline justify-between gap-2 text-sm">
                <span className="min-w-0 truncate text-[var(--os-text)]">
                  <span className="mr-1.5 inline-block w-6 text-xs tabular-nums text-[var(--os-text-muted)]">{r.unassigned ? "—" : `${pos}.º`}</span>
                  <span className={r.unassigned ? "italic" : "font-medium"}>{r.name}</span>
                </span>
                <span className="shrink-0 tabular-nums text-[var(--os-text)]">
                  <b>{fmtInt(r.units)}</b> <span className="text-xs text-[var(--os-text-muted)]">· {fmtPercent(r.share)}</span>
                </span>
              </div>
              <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-white/[0.07]" aria-hidden="true">
                <div className="h-full rounded-full" style={{ width: `${Math.min(100, r.share)}%`, background: r.unassigned ? "#94a3b8" : TOTAL_COLOR }} />
              </div>
            </li>
          );
        })}
      </ol>
    </div>
  );
}

const colName = (cols: DashboardResponsibleColumn[], key: string) => cols.find((c) => c.key === key)?.name ?? key;

function TrendTable({ monthly, columns }: { monthly: DashboardProductividadMonth[]; columns: DashboardResponsibleColumn[] }) {
  const total = monthly.reduce((s, m) => s + m.total, 0);
  const masivo = monthly.reduce((s, m) => s + m.masivo, 0);
  const premium = monthly.reduce((s, m) => s + m.premium, 0);
  const th = "px-2 py-2 text-right text-[11px] font-semibold uppercase tracking-wide text-[var(--os-text-muted)]";
  const td = "px-2 py-1.5 text-right tabular-nums";
  return (
    <>
      {/* Escritorio ancho: tabla comparativa. */}
      <div className="hidden xl:block" data-testid="trend-table-wrap">
        <table className="w-full table-fixed border-collapse text-xs" data-testid="trend-table">
          <caption className="sr-only">Tendencia mensual de unidades envasadas con variación contra el mes anterior y columnas por responsable</caption>
          <thead>
            <tr className="border-b border-[var(--os-border)]">
              <th scope="col" className="px-2 py-2 text-left text-[11px] font-semibold uppercase tracking-wide text-[var(--os-text-muted)]">Mes</th>
              <th scope="col" className={th}>Masivo</th>
              <th scope="col" className={th}>Premium</th>
              <th scope="col" className={th}>Total</th>
              <th scope="col" className={th}>Var. vs mes ant.</th>
              <th scope="col" className={th}>Tendencia</th>
              {columns.map((c) => (
                <th key={c.key} scope="col" className={`${th} truncate`} title={c.name}>
                  {c.name}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {monthly.map((m) => (
              <tr key={m.month} className="border-b border-[var(--os-border)]/60" data-testid={`trend-row-${m.month}`} data-trend={m.trend ?? ""}>
                <th scope="row" className="px-2 py-1.5 text-left font-medium text-[var(--os-text)]">{monthName(m.month)}</th>
                {m.records === 0 ? (
                  <td colSpan={5 + columns.length} className="px-2 py-1.5 text-left text-[var(--os-text-muted)]">Sin datos</td>
                ) : (
                  <>
                    <td className={td}>{fmtInt(m.masivo)}</td>
                    <td className={td}>{fmtInt(m.premium)}</td>
                    <td className={`${td} font-semibold text-[var(--os-text)]`}>{fmtInt(m.total)}</td>
                    <td className={td} data-testid={`trend-var-${m.month}`}>
                      {m.variationPct == null ? "—" : `${m.variationPct > 0 ? "+" : ""}${m.variationPct.toLocaleString("es-AR", { minimumFractionDigits: 1, maximumFractionDigits: 1 })} %`}
                    </td>
                    <td className={`${td} whitespace-nowrap`}>
                      <TrendBadge trend={m.trend} pct={null} />
                    </td>
                    {columns.map((c) => (
                      <td key={c.key} className={td}>{fmtInt(m.byResponsible[c.key] ?? 0)}</td>
                    ))}
                  </>
                )}
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr className="border-t-2 border-[var(--os-border)] font-semibold text-[var(--os-text)]" data-testid="trend-total-row">
              <th scope="row" className="px-2 py-2 text-left">Total acumulado</th>
              <td className={td}>{fmtInt(masivo)}</td>
              <td className={td}>{fmtInt(premium)}</td>
              <td className={td}>{fmtInt(total)}</td>
              <td className={td} />
              <td className={td} />
              {columns.map((c) => (
                <td key={c.key} className={td}>{fmtInt(c.yearUnits)}</td>
              ))}
            </tr>
            {columns.length ? (
              <tr className="text-[var(--os-text-muted)]" data-testid="trend-share-row">
                <th scope="row" className="px-2 py-1.5 text-left font-medium">% del total</th>
                <td colSpan={5} />
                {columns.map((c) => (
                  <td key={c.key} className={td}>{fmtPercent(c.yearShare)}</td>
                ))}
              </tr>
            ) : null}
          </tfoot>
        </table>
      </div>

      {/* Tablet / celular: una tarjeta por mes (sin scroll horizontal). */}
      <ul className="grid gap-2 sm:grid-cols-2 xl:hidden" data-testid="trend-cards">
        {monthly.map((m) => (
          <li key={m.month} className="min-w-0 rounded-[var(--os-radius-sm)] border border-[var(--os-border)] p-3 text-xs" data-testid={`trend-card-${m.month}`}>
            <div className="flex min-w-0 items-center justify-between gap-2">
              <span className="text-sm font-semibold text-[var(--os-text)]">{monthName(m.month)}</span>
              {m.records === 0 ? <span className="text-[var(--os-text-muted)]">Sin datos</span> : <TrendBadge trend={m.trend} pct={m.variationPct} />}
            </div>
            {m.records > 0 ? (
              <>
                <p className="mt-1 text-[var(--os-text-muted)]">
                  Total <b className="tabular-nums text-[var(--os-text)]">{fmtInt(m.total)}</b> · Masivo {fmtInt(m.masivo)} · Premium {fmtInt(m.premium)}
                </p>
                {columns.length ? (
                  <p className="mt-0.5 break-words text-[var(--os-text-muted)]">
                    {columns.map((c) => `${c.name} ${fmtInt(m.byResponsible[c.key] ?? 0)}`).join(" · ")}
                  </p>
                ) : null}
              </>
            ) : null}
          </li>
        ))}
        <li className="min-w-0 rounded-[var(--os-radius-sm)] border-2 border-[var(--os-border)] p-3 text-xs sm:col-span-2" data-testid="trend-card-total">
          <p className="text-sm font-semibold text-[var(--os-text)]">Total acumulado: {fmtInt(total)}</p>
          <p className="text-[var(--os-text-muted)]">Masivo {fmtInt(masivo)} · Premium {fmtInt(premium)}</p>
          {columns.length ? (
            <p className="mt-0.5 break-words text-[var(--os-text-muted)]">
              {columns.map((c) => `${colName(columns, c.key)} ${fmtInt(c.yearUnits)} (${fmtPercent(c.yearShare)})`).join(" · ")}
            </p>
          ) : null}
        </li>
      </ul>
    </>
  );
}

type Props = {
  data: DashboardProductividad;
  filters: DashboardFilters;
  permissions: DashboardPayload["permissions"];
};

/** Productividad de Envasado: KPIs, participación, insights, podio, ranking y tendencia mensual (fuente única: Métricas). */
export function DashboardProductividadBlock({ data, filters, permissions }: Props) {
  const { kpis, responsibles } = data;
  const own = permissions.ownSector;
  const unitCaption = (own: boolean) => (own ? "unidades · Tu sector" : "unidades");
  const chartData = data.monthly.map((m) => ({ month: m.month, masivo: m.masivo, premium: m.premium }));
  const hasYearData = data.monthly.some((m) => m.records > 0);
  return (
    <div className="space-y-4" data-testid="productividad-block">
      {data.schemaPending ? (
        <p className="rounded-[var(--os-radius)] border border-amber-400/40 bg-amber-400/10 px-3 py-2 text-sm text-[var(--os-text)]" role="status" data-testid="productividad-schema-pending">
          La tabla de Métricas todavía no está disponible en la base de datos: no hay datos de unidades envasadas.
        </p>
      ) : null}

      <UnitConcepts />

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4" data-testid="productividad-kpis">
        <DashboardKpiCard kpi={kpis.total} accent={TOTAL_COLOR} emphasis caption="unidades envasadas (Métricas)" />
        <DashboardKpiCard kpi={kpis.masivo} accent={MASIVO_COLOR} emphasis caption={unitCaption(own === "ENVASADO_MASIVO")} />
        <DashboardKpiCard kpi={kpis.premium} accent={PREMIUM_COLOR} emphasis caption={unitCaption(own === "ENVASADO_PREMIUM")} />
        <DashboardKpiCard kpi={kpis.bestMonth} accent={BEST_MONTH_COLOR} emphasis caption={kpis.bestMonth.value != null ? `${fmtInt(kpis.bestMonth.value)} unidades` : undefined} />
        <DashboardKpiCard kpi={kpis.pctMasivo} accent={MASIVO_COLOR} caption="del total envasado" />
        <DashboardKpiCard kpi={kpis.pctPremium} accent={PREMIUM_COLOR} caption="del total envasado" />
        <DashboardKpiCard kpi={kpis.dailyAverage} accent={DAILY_COLOR} caption={kpis.dailyAverage.value != null ? `unidades por día con registros · ${fmtInt(data.activeDays)} días` : undefined} />
        <ShareBar masivo={kpis.pctMasivo.value} premium={kpis.pctPremium.value} />
      </div>

      {data.notes.length ? (
        <ul className="list-disc space-y-0.5 pl-4 text-xs text-[var(--os-text-muted)]" data-testid="productividad-notes">
          {data.notes.map((n) => (
            <li key={n}>{n}</li>
          ))}
        </ul>
      ) : null}

      <div className="grid gap-4 lg:grid-cols-2" data-testid="productividad-responsables">
        {responsibles.available ? (
          <>
            <div className="grid min-w-0 gap-4 sm:grid-cols-2 lg:col-span-2">
              <Insight title="Mayor productividad (responsable)" row={responsibles.best} tone="#10b981" testId="insight-best" empty="No hay responsables con unidades en el período." />
              <Insight
                title="Menor productividad (responsable)"
                row={responsibles.worst}
                tone="#f97316"
                testId="insight-worst"
                empty="Hace falta al menos otro responsable para comparar."
              />
            </div>
            <div className="min-w-0 space-y-3 lg:col-span-2">
              <div className="flex flex-wrap items-baseline gap-x-3">
                <h3 className="text-sm font-semibold text-[var(--os-text)]">Podio de productividad · {data.periodLabel}</h3>
                <span className="text-xs text-[var(--os-text-muted)]" data-testid="responsables-scope">{responsibles.scopeLabel}</span>
              </div>
              <DashboardPodium podium={responsibles.podium} />
            </div>
            <div className="min-w-0 lg:col-span-2">
              <RankingList ranking={responsibles.ranking} />
            </div>
          </>
        ) : (
          <p className="rounded-[var(--os-radius)] border border-dashed border-[var(--os-border)] p-4 text-sm text-[var(--os-text-muted)] lg:col-span-2" data-testid="responsables-not-available">
            {responsibles.reason}
          </p>
        )}
      </div>

      <div className={CARD} data-testid="productividad-tendencia">
        <h3 className="mb-2 text-sm font-semibold text-[var(--os-text)]">Tendencia mensual · {data.year}</h3>
        {!hasYearData ? (
          <p className="py-8 text-center text-sm text-[var(--os-text-muted)]" data-testid="chart-sin-datos">
            Sin datos suficientes: no hay registros de Métricas en {data.year}.
          </p>
        ) : (
          <div className="space-y-4">
            <DashboardBarChart data={chartData} selectedMonth={filters.month} sector={filters.sector} year={data.year} />
            <TrendTable monthly={data.monthly} columns={responsibles.available ? responsibles.columns : []} />
            <p className="text-xs text-[var(--os-text-muted)]">
              Variación contra el mes calendario anterior del mismo año (enero no tiene mes anterior; un mes sin registros no se compara). SUBE / BAJA / IGUAL según el total del mes.
            </p>
          </div>
        )}
      </div>
    </div>
  );
}
