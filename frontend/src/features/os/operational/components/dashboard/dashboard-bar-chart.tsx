"use client";

import { useEffect, useRef, useState } from "react";
import { fmtInt, monthName, monthShort } from "@/lib/dashboard/format";
import type { DashboardMonthlyPoint, DashboardSectorFilter } from "@/lib/dashboard/types";

export const MASIVO_COLOR = "#12bfb7";
export const PREMIUM_COLOR = "#a78bfa";

type Props = {
  data: DashboardMonthlyPoint[];
  /** Mes seleccionado en el filtro (se resalta). */
  selectedMonth: number | null;
  /** Con filtro de sector, la otra serie se atenúa (no se oculta). */
  sector: DashboardSectorFilter;
  year: number;
};

function niceMax(max: number): number {
  if (max <= 0) return 1;
  const pow = Math.pow(10, Math.floor(Math.log10(max)));
  const n = max / pow;
  const step = n <= 1 ? 1 : n <= 2 ? 2 : n <= 5 ? 5 : 10;
  return step * pow;
}

/**
 * Evolución mensual Masivo vs Premium — SVG propio (sin librerías), accesible:
 * role="img" + resumen en aria-label, etiquetas de valor en cada barra y tabla equivalente solo para lectores de pantalla.
 * En ancho chico se dibuja en horizontal (un renglón por mes) para no necesitar scroll.
 */
export function DashboardBarChart({ data, selectedMonth, sector, year }: Props) {
  const ref = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(640);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const measure = () => setWidth(Math.max(240, Math.floor(el.getBoundingClientRect().width)));
    measure();
    if (typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const maxValue = Math.max(0, ...data.flatMap((d) => [d.masivo, d.premium]));
  const total = data.reduce((s, d) => s + d.masivo + d.premium, 0);
  const dimMasivo = sector === "ENVASADO_PREMIUM";
  const dimPremium = sector === "ENVASADO_MASIVO";
  const horizontal = width < 520;
  const summary = `Evolución mensual ${year} de unidades producidas, Masivo contra Premium. Total del año: ${fmtInt(total)} unidades.`;

  return (
    <figure className="min-w-0" data-testid="dashboard-bar-chart">
      <figcaption className="mb-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-[var(--os-text-muted)]">
        <span className="inline-flex items-center gap-1.5">
          <span className="size-3 rounded-sm" style={{ background: MASIVO_COLOR, opacity: dimMasivo ? 0.3 : 1 }} aria-hidden="true" />
          Consumo Masivo
        </span>
        <span className="inline-flex items-center gap-1.5">
          <span className="size-3 rounded-sm" style={{ background: PREMIUM_COLOR, opacity: dimPremium ? 0.3 : 1 }} aria-hidden="true" />
          Premium
        </span>
        <span>Unidades por mes · fecha de producción</span>
      </figcaption>
      <div ref={ref} className="w-full min-w-0">
        {horizontal ? (
          <HorizontalChart data={data} width={width} maxValue={maxValue} selectedMonth={selectedMonth} dimMasivo={dimMasivo} dimPremium={dimPremium} summary={summary} />
        ) : (
          <VerticalChart data={data} width={width} maxValue={maxValue} selectedMonth={selectedMonth} dimMasivo={dimMasivo} dimPremium={dimPremium} summary={summary} />
        )}
      </div>
      <table className="sr-only">
        <caption>{summary}</caption>
        <thead>
          <tr>
            <th scope="col">Mes</th>
            <th scope="col">Consumo Masivo</th>
            <th scope="col">Premium</th>
          </tr>
        </thead>
        <tbody>
          {data.map((d) => (
            <tr key={d.month}>
              <th scope="row">{monthName(d.month)}</th>
              <td>{fmtInt(d.masivo)}</td>
              <td>{fmtInt(d.premium)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </figure>
  );
}

type ChartProps = {
  data: DashboardMonthlyPoint[];
  width: number;
  maxValue: number;
  selectedMonth: number | null;
  dimMasivo: boolean;
  dimPremium: boolean;
  summary: string;
};

function VerticalChart({ data, width, maxValue, selectedMonth, dimMasivo, dimPremium, summary }: ChartProps) {
  const ml = 46;
  const mr = 8;
  const mb = 28;
  const plotW = width - ml - mr;
  const groupW = plotW / 12;
  const rotate = groupW < 64;
  const mt = rotate ? 48 : 22;
  const height = 250 + (rotate ? 26 : 0);
  const plotH = height - mt - mb;
  const top = niceMax(maxValue);
  const ticks = [0, 0.25, 0.5, 0.75, 1].map((f) => top * f);
  const barW = Math.max(6, Math.min(22, (groupW - 6) / 2));
  const y = (v: number) => mt + plotH - (v / top) * plotH;

  return (
    <svg viewBox={`0 0 ${width} ${height}`} width={width} height={height} role="img" aria-label={summary} className="block max-w-full">
      {ticks.map((t) => (
        <g key={t}>
          <line x1={ml} x2={width - mr} y1={y(t)} y2={y(t)} stroke="rgba(255,255,255,0.10)" strokeWidth={1} />
          <text x={ml - 6} y={y(t) + 4} textAnchor="end" fontSize={10} fill="var(--os-text-muted)">
            {fmtInt(t)}
          </text>
        </g>
      ))}
      {data.map((d, i) => {
        const gx = ml + i * groupW + groupW / 2;
        const selected = selectedMonth === d.month;
        const series = [
          { v: d.masivo, color: MASIVO_COLOR, dim: dimMasivo, name: "Consumo Masivo", x: gx - barW - 1 },
          { v: d.premium, color: PREMIUM_COLOR, dim: dimPremium, name: "Premium", x: gx + 1 },
        ];
        return (
          <g key={d.month}>
            {selected ? <rect x={gx - groupW / 2 + 1} y={mt - 4} width={groupW - 2} height={plotH + 4} rx={4} fill="rgba(255,255,255,0.06)" /> : null}
            {series.map((s) => {
              const h = Math.max(0, plotH - (y(s.v) - mt));
              const lx = s.x + barW / 2;
              return (
                <g key={s.name} opacity={s.dim ? 0.3 : 1}>
                  <rect x={s.x} y={y(s.v)} width={barW} height={h} rx={2} fill={s.color}>
                    <title>{`${monthName(d.month)} · ${s.name}: ${fmtInt(s.v)} unidades`}</title>
                  </rect>
                  {s.v > 0 ? (
                    <text
                      x={lx}
                      y={y(s.v) - 4}
                      fontSize={10}
                      fontWeight={600}
                      fill="var(--os-text)"
                      textAnchor={rotate ? "start" : "middle"}
                      transform={rotate ? `rotate(-90 ${lx} ${y(s.v) - 4})` : undefined}
                      dominantBaseline={rotate ? "central" : undefined}
                    >
                      {fmtInt(s.v)}
                    </text>
                  ) : null}
                </g>
              );
            })}
            <text x={gx} y={height - 9} textAnchor="middle" fontSize={11} fontWeight={selected ? 700 : 400} fill={selected ? "var(--os-text)" : "var(--os-text-muted)"}>
              {monthShort(d.month)}
            </text>
          </g>
        );
      })}
    </svg>
  );
}

function HorizontalChart({ data, width, maxValue, selectedMonth, dimMasivo, dimPremium, summary }: ChartProps) {
  const labelW = 34;
  const textW = 62;
  const rowH = 34;
  const barH = 11;
  const height = data.length * rowH + 4;
  const maxBar = Math.max(40, width - labelW - textW - 4);
  const top = niceMax(maxValue);
  const bw = (v: number) => (v / top) * maxBar;

  return (
    <svg viewBox={`0 0 ${width} ${height}`} width={width} height={height} role="img" aria-label={summary} className="block max-w-full">
      {data.map((d, i) => {
        const yTop = i * rowH + 3;
        const selected = selectedMonth === d.month;
        const series = [
          { v: d.masivo, color: MASIVO_COLOR, dim: dimMasivo, name: "Consumo Masivo", y: yTop + 2 },
          { v: d.premium, color: PREMIUM_COLOR, dim: dimPremium, name: "Premium", y: yTop + 2 + barH + 3 },
        ];
        return (
          <g key={d.month}>
            {selected ? <rect x={0} y={yTop - 2} width={width} height={rowH - 2} rx={4} fill="rgba(255,255,255,0.06)" /> : null}
            <text x={2} y={yTop + rowH / 2 + 1} fontSize={11} fontWeight={selected ? 700 : 400} fill={selected ? "var(--os-text)" : "var(--os-text-muted)"} dominantBaseline="central">
              {monthShort(d.month)}
            </text>
            {series.map((s) => (
              <g key={s.name} opacity={s.dim ? 0.3 : 1}>
                <rect x={labelW} y={s.y} width={Math.max(s.v > 0 ? 2 : 0, bw(s.v))} height={barH} rx={2} fill={s.color}>
                  <title>{`${monthName(d.month)} · ${s.name}: ${fmtInt(s.v)} unidades`}</title>
                </rect>
                <text x={labelW + bw(s.v) + 5} y={s.y + barH / 2 + 0.5} fontSize={10} fontWeight={600} fill="var(--os-text)" dominantBaseline="central">
                  {fmtInt(s.v)}
                </text>
              </g>
            ))}
          </g>
        );
      })}
    </svg>
  );
}
