"use client";

import { useEffect, useMemo, useRef } from "react";
import type { WorkItem } from "@/types/operational/work-item";
import { displayField } from "@/lib/operational/display-fields";
import { usePreviewContext } from "@/features/os/session/preview-context";
import { TwinShell } from "@/features/os/shell/twin-shell";
import { SECTOR_LABELS } from "@/types/operational/sector";
import { useOperationalPlan } from "../hooks/use-operational-plan";
import { useOperationalStore } from "../store/operational-store-context";
import { isWorkTransferredStatus } from "../lib/work-transfer-labels";
import { getFormulaForProduct } from "../adapters/formula-repository";
import { mergeManualWorkItems } from "../adapters/manual-work-items-repository";
import { getTotalStockByCodigo } from "../adapters/materia-prima-repository";
import { pushNotification } from "@/features/os/feedback/notifications-store";
import { OperationalTable, StatusChip, type OperationalTableColumn } from "../components/operational-ui";

const PRODUCING_SECTORS = ["ELABORACION", "ENVASADO_MASIVO", "ENVASADO_PREMIUM"] as const;

interface SectorSummary {
  sector: (typeof PRODUCING_SECTORS)[number];
  pendientes: number;
  enProceso: number;
  progreso: number;
}

interface ActiveRow {
  id: string;
  sector: string;
  fecha: string | null;
  cliente: string | null;
  producto: string | null;
  cantidad: string;
  asignadoA: string | null;
  estado: string;
}

function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}

function isOverdue(item: WorkItem): boolean {
  const due = item.deliveryDate ?? item.plannedDate;
  if (!due) return false;
  if (item.status === "completo" || item.status === "revision" || item.status === "cancelado") return false;
  return due < todayIso();
}

function KpiTile({ label, value, tone }: { label: string; value: number; tone?: "warn" | "danger" | "ok" }) {
  const toneClass =
    tone === "danger"
      ? "text-rose-700"
      : tone === "warn"
        ? "text-amber-700"
        : tone === "ok"
          ? "text-emerald-700"
          : "text-[var(--os-text)]";
  return (
    <div className="rounded-[var(--os-radius)] border border-[var(--os-border)] bg-[var(--os-surface)] p-4">
      <p className="text-xs font-medium uppercase tracking-wide text-[var(--os-text-muted)]">{label}</p>
      <p className={`mt-1 text-2xl font-semibold tabular-nums ${toneClass}`}>{value}</p>
    </div>
  );
}

/** Panel general de Producción — KPIs, estado por sector, trabajos activos, atención requerida. */
export function ProduccionPanelView() {
  const { navigateTo } = usePreviewContext();
  const { getQualityStatus, getFinishedQty } = useOperationalStore();

  const elaboracion = useOperationalPlan("ELABORACION");
  const masivo = useOperationalPlan("ENVASADO_MASIVO");
  const premium = useOperationalPlan("ENVASADO_PREMIUM");
  const calidad = useOperationalPlan("CALIDAD");

  const bySector: Record<(typeof PRODUCING_SECTORS)[number], WorkItem[]> = {
    ELABORACION: mergeManualWorkItems("ELABORACION", elaboracion.data?.workItems ?? []),
    ENVASADO_MASIVO: mergeManualWorkItems("ENVASADO_MASIVO", masivo.data?.workItems ?? []),
    ENVASADO_PREMIUM: mergeManualWorkItems("ENVASADO_PREMIUM", premium.data?.workItems ?? []),
  };

  const allActiveItems = useMemo(
    () => PRODUCING_SECTORS.flatMap((s) => bySector[s]),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [elaboracion.data, masivo.data, premium.data]
  );

  const qualityItems = calidad.data?.qualityItems ?? [];
  const aprobados = qualityItems.filter((q) => getQualityStatus(q.id, q.status) === "aprobado").length;
  const rechazados = qualityItems.filter((q) => getQualityStatus(q.id, q.status) === "rechazado").length;

  const pendientes = allActiveItems.filter((i) => i.status === "pendiente").length;
  const enProceso = allActiveItems.filter((i) => i.status === "en_curso").length;
  const esperandoCalidad = allActiveItems.filter((i) => isWorkTransferredStatus(i.status)).length;

  const faltantesRefs = useMemo(() => {
    const refs = new Set<string>();
    for (const item of bySector.ELABORACION) {
      if (!item.oeRef || item.status === "completo" || item.status === "revision") continue;
      const formula = getFormulaForProduct(item.product);
      if (!formula) continue;
      const hasFaltante = formula.lines.some((l) => getTotalStockByCodigo(l.codigo) < l.cantidadRequerida);
      if (hasFaltante) refs.add(item.oeRef);
    }
    return [...refs];
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [elaboracion.data]);

  const atrasados = allActiveItems.filter(isOverdue);

  const notifiedOverdueRef = useRef<Set<string>>(new Set());
  useEffect(() => {
    for (const item of atrasados) {
      if (notifiedOverdueRef.current.has(item.id)) continue;
      notifiedOverdueRef.current.add(item.id);
      pushNotification({
        kind: "trabajo_atrasado",
        title: "Trabajo atrasado",
        message: `${item.product ?? "Producto"} · ${item.client ?? ""} (${SECTOR_LABELS[item.sector]}) superó la fecha comprometida.`,
        sectors: ["PRODUCCION", item.sector],
      });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [atrasados.map((i) => i.id).join(",")]);

  const sectorSummaries: SectorSummary[] = PRODUCING_SECTORS.map((sector) => {
    const items = bySector[sector];
    const done = items.filter((i) => isWorkTransferredStatus(i.status)).length;
    return {
      sector,
      pendientes: items.filter((i) => i.status === "pendiente").length,
      enProceso: items.filter((i) => i.status === "en_curso").length,
      progreso: items.length > 0 ? Math.round((done / items.length) * 100) : 0,
    };
  });

  const calidadSummary = {
    pendientes: qualityItems.filter((q) => getQualityStatus(q.id, q.status) === "pendiente").length,
    enProceso: 0,
    progreso:
      qualityItems.length > 0 ? Math.round(((aprobados + rechazados) / qualityItems.length) * 100) : 0,
  };

  const activeRows: ActiveRow[] = allActiveItems
    .filter((i) => i.status !== "cancelado")
    .map((i) => ({
      id: i.id,
      sector: SECTOR_LABELS[i.sector],
      fecha: i.plannedDate ?? i.dayLabel,
      cliente: i.client,
      producto: i.product,
      cantidad: [i.quantity, i.unit].filter(Boolean).join(" "),
      asignadoA: i.ownerPerson,
      estado: i.status,
    }));

  const kgElaborados = bySector.ELABORACION.filter((i) => isWorkTransferredStatus(i.status)).reduce(
    (sum, i) => sum + (Number.parseFloat(getFinishedQty(i.id)) || 0),
    0
  );
  const unidadesEnvasadas = [...bySector.ENVASADO_MASIVO, ...bySector.ENVASADO_PREMIUM]
    .filter((i) => isWorkTransferredStatus(i.status))
    .reduce((sum, i) => sum + (Number.parseFloat(getFinishedQty(i.id)) || 0), 0);

  const columns: OperationalTableColumn<ActiveRow>[] = [
    { key: "sector", header: "Sector", render: (r) => r.sector },
    { key: "fecha", header: "Fecha", render: (r) => displayField(r.fecha) },
    { key: "cliente", header: "Cliente", render: (r) => displayField(r.cliente) },
    { key: "producto", header: "Producto", render: (r) => displayField(r.producto) },
    { key: "cantidad", header: "Cantidad", render: (r) => r.cantidad || "—" },
    { key: "asignado", header: "Asignado a", render: (r) => displayField(r.asignadoA) },
    { key: "estado", header: "Estado", render: (r) => <StatusChip status={r.estado} /> },
  ];

  const sectorViewMap: Record<string, "ver-elaboracion" | "ver-envasado-masivo" | "ver-envasado-premium" | "ver-calidad"> = {
    ELABORACION: "ver-elaboracion",
    ENVASADO_MASIVO: "ver-envasado-masivo",
    ENVASADO_PREMIUM: "ver-envasado-premium",
    CALIDAD: "ver-calidad",
  };

  return (
    <TwinShell title="Panel general">
    <div className="space-y-6">
      <header>
        <h2 className="text-2xl font-semibold tracking-tight">Panel general</h2>
        <p className="text-sm text-[var(--os-text-muted)]">
          Vista consolidada de planta — Elaboración, Envasado y Calidad.
        </p>
      </header>

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
        <KpiTile label="Pendientes" value={pendientes} />
        <KpiTile label="En proceso" value={enProceso} tone="warn" />
        <KpiTile label="Esperando Calidad" value={esperandoCalidad} tone="warn" />
        <KpiTile label="Aprobados" value={aprobados} tone="ok" />
        <KpiTile label="Rechazados" value={rechazados} tone="danger" />
        <KpiTile label="Con faltantes" value={faltantesRefs.length} tone="danger" />
      </div>

      <section>
        <h3 className="mb-3 text-sm font-semibold uppercase tracking-wide text-[var(--os-text-muted)]">
          Estado por sector
        </h3>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {[...sectorSummaries.map((s) => ({ ...s, label: SECTOR_LABELS[s.sector], key: s.sector as string })), {
            key: "CALIDAD",
            label: "Calidad",
            pendientes: calidadSummary.pendientes,
            enProceso: calidadSummary.enProceso,
            progreso: calidadSummary.progreso,
          }].map((s) => (
            <div key={s.key} className="rounded-[var(--os-radius)] border border-[var(--os-border)] bg-[var(--os-surface)] p-4">
              <p className="font-medium">{s.label}</p>
              <div className="mt-2 flex items-center justify-between text-xs text-[var(--os-text-muted)]">
                <span>Pendientes: {s.pendientes}</span>
                <span>En proceso: {s.enProceso}</span>
              </div>
              <div className="mt-2 h-1.5 w-full overflow-hidden rounded-full bg-[var(--os-bg)]">
                <div
                  className="h-full rounded-full bg-[var(--os-teal)]"
                  style={{ width: `${s.progreso}%` }}
                />
              </div>
              <button
                type="button"
                onClick={() => navigateTo({ view: sectorViewMap[s.key] })}
                className="mt-3 text-xs font-medium text-[var(--os-teal)] hover:underline"
              >
                Ver sector →
              </button>
            </div>
          ))}
        </div>
      </section>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-[2fr_1fr]">
        <section>
          <h3 className="mb-3 text-sm font-semibold uppercase tracking-wide text-[var(--os-text-muted)]">
            Trabajos activos
          </h3>
          <OperationalTable
            columns={columns}
            rows={activeRows}
            rowKey={(r) => r.id}
            emptyMessage="Sin trabajos activos."
          />
        </section>

        <aside className="space-y-4">
          <h3 className="text-sm font-semibold uppercase tracking-wide text-[var(--os-text-muted)]">
            Atención requerida
          </h3>
          <div className="space-y-3 rounded-[var(--os-radius)] border border-[var(--os-border)] bg-[var(--os-surface)] p-4 text-sm">
            <p>
              <span className="font-medium text-rose-700">{faltantesRefs.length}</span> materia
              {faltantesRefs.length === 1 ? "" : "s"} prima{faltantesRefs.length === 1 ? "" : "s"} con
              faltante ({faltantesRefs.join(", ") || "—"})
            </p>
            <p>
              <span className="font-medium text-amber-700">{atrasados.length}</span> trabajo
              {atrasados.length === 1 ? "" : "s"} atrasado{atrasados.length === 1 ? "" : "s"}
            </p>
            <p>
              <span className="font-medium text-rose-700">{rechazados}</span> rechazo
              {rechazados === 1 ? "" : "s"} de Calidad
            </p>
          </div>

          <h3 className="text-sm font-semibold uppercase tracking-wide text-[var(--os-text-muted)]">
            Producción del día
          </h3>
          <div className="grid grid-cols-2 gap-3">
            <div className="rounded-[var(--os-radius)] border border-[var(--os-border)] bg-[var(--os-surface)] p-4">
              <p className="text-xs text-[var(--os-text-muted)]">Kg elaborados</p>
              <p className="text-xl font-semibold tabular-nums">{kgElaborados.toFixed(1)}</p>
            </div>
            <div className="rounded-[var(--os-radius)] border border-[var(--os-border)] bg-[var(--os-surface)] p-4">
              <p className="text-xs text-[var(--os-text-muted)]">Unidades envasadas</p>
              <p className="text-xl font-semibold tabular-nums">{unidadesEnvasadas.toFixed(0)}</p>
            </div>
          </div>
        </aside>
      </div>
    </div>
    </TwinShell>
  );
}
