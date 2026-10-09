"use client";

/**
 * Tarjeta de una tarea de Semanas (SOLO LECTURA) — la misma en Semanas y Día a día de cada sector y en el Modo TV.
 * Jerarquía: 1) producto 2) cantidad 3) prioridad 4) fecha y responsable/línea 5) cliente y datos secundarios.
 * Cada dato lleva su etiqueta (PRODUCTO, CANTIDAD, CLIENTE…) y solo se muestra si la planilla lo tiene: nada se inventa.
 * El color de prioridad es un acento (borde lateral + etiqueta); el fondo conserva el azul de GENUS OS.
 */
import { PRIORITY_META, type Priority } from "@/lib/semanas-sheet/priorities";
import { formatDay, PLAN_SECTOR_LABEL, type PlanTask } from "@/lib/semanas-sheet/plan-tasks";
import { PRIORITY_STYLE } from "./semanas-priority-chip";

export type PlanCardSize = "md" | "tv";

const SIZES: Record<PlanCardSize, { card: string; label: string; product: string; qty: string; meta: string; tag: string; border: string }> = {
  md: {
    card: "rounded-xl p-3.5 gap-2.5",
    label: "text-[10px] tracking-[0.14em]",
    product: "text-[16px] leading-snug",
    qty: "text-[17px]",
    meta: "text-[13px]",
    tag: "px-2.5 py-0.5 text-[11px]",
    border: "5px",
  },
  // TV: legible a distancia sin tarjetas gigantes (escala suave con el ancho; probado en 1280×720, 1366×768 y 1920×1080).
  tv: {
    card: "rounded-xl p-[clamp(0.6rem,0.85vw,1.1rem)] gap-[clamp(0.35rem,0.55vw,0.7rem)]",
    label: "text-[clamp(0.6rem,0.7vw,0.85rem)] tracking-[0.14em]",
    product: "text-[clamp(1rem,1.3vw,1.6rem)] leading-tight",
    qty: "text-[clamp(1.05rem,1.35vw,1.65rem)]",
    meta: "text-[clamp(0.8rem,0.95vw,1.15rem)]",
    tag: "px-[0.7em] py-[0.15em] text-[clamp(0.7rem,0.8vw,1rem)]",
    border: "clamp(5px,0.4vw,8px)",
  },
};

export function PriorityTag({ priority, size = "md" }: { priority: Priority; size?: PlanCardSize }) {
  const st = PRIORITY_STYLE[priority];
  return (
    <span
      className={`inline-flex shrink-0 items-center gap-1.5 whitespace-nowrap rounded-full border font-bold tracking-wide ${SIZES[size].tag}`}
      style={{ background: st.soft, borderColor: st.accent, color: st.text }}
      data-testid="plan-priority"
      data-priority={priority}
    >
      <span className="inline-block size-[0.6em] rounded-full" style={{ background: st.accent }} aria-hidden="true" />
      {PRIORITY_META[priority].label}
    </span>
  );
}

function Field({ label, children, size, testId }: { label: string; children: React.ReactNode; size: PlanCardSize; testId?: string }) {
  return (
    <div className="min-w-0" data-testid={testId}>
      <div className={`font-semibold uppercase text-[var(--plan-label,#8fb3c9)] ${SIZES[size].label}`}>{label}</div>
      <div className={`break-words font-semibold text-[#e6f0f6] ${SIZES[size].meta}`}>{children}</div>
    </div>
  );
}

export interface PlanTaskCardProps {
  task: PlanTask;
  size?: PlanCardSize;
  /** Mostrar la fecha (en Día a día la fecha ya está en el encabezado). */
  showDate?: boolean;
  /** Mostrar el sector (cuando la pantalla mezcla sectores). */
  showSector?: boolean;
}

export function PlanTaskCard({ task, size = "md", showDate = true, showSector = false }: PlanTaskCardProps) {
  const st = PRIORITY_STYLE[task.priority];
  const s = SIZES[size];
  const multiDay = task.span > 1 && task.endDate && task.endDate !== task.date;
  const products = task.products.length > 0 ? task.products : [];
  return (
    <article
      data-testid="plan-card"
      data-task-key={task.key}
      data-priority={task.priority}
      className={`flex flex-col border border-white/10 bg-[#10304a] shadow-[0_1px_0_rgba(255,255,255,0.04)_inset,0_6px_18px_-10px_rgba(0,0,0,0.6)] ${s.card}`}
      style={{ borderLeft: `${s.border} solid ${st.accent}` }}
    >
      <div className="min-w-0">
        {/* La etiqueta de prioridad comparte renglón con el rótulo: el producto usa todo el ancho de la tarjeta. */}
        <div className="flex items-center justify-between gap-2">
          <span className={`font-semibold uppercase text-[#8fb3c9] ${s.label}`}>Producto</span>
          <PriorityTag priority={task.priority} size={size} />
        </div>
        {products.length > 0 ? (
          products.map((p, i) => (
            <div key={i} className={`break-words font-bold text-white ${s.product}`} data-testid="plan-product">
              {p}
            </div>
          ))
        ) : (
          <div className={`font-semibold italic text-white/50 ${s.meta}`}>Sin producto en la planilla</div>
        )}
      </div>

      {task.quantities.length > 0 && (
        <div className="flex items-baseline gap-2" data-testid="plan-quantity">
          <span className={`font-semibold uppercase text-[#8fb3c9] ${s.label}`}>Cantidad</span>
          <span className={`font-extrabold tabular-nums text-[#5eead4] ${s.qty}`}>{task.quantities.join(" · ")}</span>
        </div>
      )}

      <div className="grid grid-cols-[repeat(auto-fit,minmax(7rem,1fr))] gap-x-3 gap-y-1.5 border-t border-white/10 pt-2">
        {showDate && (
          <Field label="Fecha" size={size} testId="plan-date">
            {formatDay(task.date)}
            {multiDay ? ` → ${formatDay(task.endDate)}` : ""}
          </Field>
        )}
        {task.assignee && (
          <Field label={task.assignee.kind === "LÍNEA" ? "Línea" : "Responsable"} size={size} testId="plan-assignee">
            {task.assignee.value}
          </Field>
        )}
        {task.client && (
          <Field label="Cliente" size={size} testId="plan-client">
            {task.client}
          </Field>
        )}
        {showSector && task.sector && (
          <Field label="Sector" size={size}>
            {PLAN_SECTOR_LABEL[task.sector]}
          </Field>
        )}
      </div>

      {task.notes.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {task.notes.map((n, i) => (
            <span key={i} className={`rounded-md border border-amber-300/30 bg-amber-300/10 px-2 font-semibold text-amber-100 ${s.meta}`}>
              {n}
            </span>
          ))}
        </div>
      )}
    </article>
  );
}
