"use client";

/** Gráficos simples de INSUMOS (CSS / SVG propio, sin dependencias). */

const BAR = "var(--os-teal, #0d9488)";
const fmt = (n: number) => new Intl.NumberFormat("es-AR", { maximumFractionDigits: 0 }).format(n);

/** Barras horizontales: una fila por categoría, ancho proporcional al mayor valor. */
export function HBarChart({ rows, unit = "unid.", testId }: { rows: Array<{ key: string; label: string; value: number }>; unit?: string; testId?: string }) {
  const max = Math.max(1, ...rows.map((r) => r.value));
  if (rows.length === 0) return <p className="text-sm text-[var(--os-text-muted)]">Sin datos para el período.</p>;
  return (
    <ul className="space-y-1.5" data-testid={testId}>
      {rows.map((r) => (
        <li key={r.key} className="grid grid-cols-[minmax(0,9rem)_1fr_auto] items-center gap-2 text-sm">
          <span className="truncate" title={r.label}>{r.label}</span>
          <span className="h-4 overflow-hidden rounded bg-[var(--os-border)]/40" aria-hidden>
            <span className="block h-full rounded" style={{ width: `${(r.value / max) * 100}%`, background: BAR }} />
          </span>
          <span className="w-16 text-right font-semibold tabular-nums">{fmt(r.value)} <span className="text-xs font-normal text-[var(--os-text-muted)]">{unit}</span></span>
        </li>
      ))}
    </ul>
  );
}

/** Columnas en el tiempo (diario / semanal / mensual). */
export function SeriesChart({ points, testId }: { points: Array<{ key: string; label: string; total: number }>; testId?: string }) {
  if (points.length === 0) return <p className="text-sm text-[var(--os-text-muted)]">Sin datos para el período.</p>;
  const W = Math.max(320, points.length * 36);
  const H = 160;
  const pad = { t: 16, b: 28 };
  const max = Math.max(1, ...points.map((p) => p.total));
  const bw = Math.min(28, (W / points.length) * 0.7);
  return (
    <div className="overflow-x-auto" data-testid={testId}>
      <svg role="img" aria-label={`Consumo por período: ${points.map((p) => `${p.label} ${p.total}`).join(", ")}`} viewBox={`0 0 ${W} ${H}`} width={W} height={H} className="max-w-none">
        <line x1="0" x2={W} y1={H - pad.b} y2={H - pad.b} stroke="currentColor" strokeOpacity="0.25" />
        {points.map((p, i) => {
          const h = ((H - pad.t - pad.b) * p.total) / max;
          const x = (W / points.length) * i + (W / points.length - bw) / 2;
          return (
            <g key={p.key}>
              <rect x={x} y={H - pad.b - h} width={bw} height={h} rx="3" fill={BAR}><title>{`${p.label}: ${p.total}`}</title></rect>
              <text x={x + bw / 2} y={H - pad.b - h - 4} textAnchor="middle" fontSize="10" fill="currentColor">{fmt(p.total)}</text>
              <text x={x + bw / 2} y={H - 10} textAnchor="middle" fontSize="10" fill="currentColor" fillOpacity="0.7">{p.label}</text>
            </g>
          );
        })}
      </svg>
    </div>
  );
}
