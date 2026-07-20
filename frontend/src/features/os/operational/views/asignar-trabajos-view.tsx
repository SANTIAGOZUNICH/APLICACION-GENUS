"use client";

import { useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { TwinShell } from "@/features/os/shell/twin-shell";
import { useRequiredWorkspace } from "@/features/os/workspace/workspace-provider";
import { WORK_ITEM_PRIORITIES, type WorkItemPriority } from "@/types/operational/work-item";
import type { SectorId } from "@/types/operational/sector";
import { SECTOR_LABELS } from "@/types/operational/sector";
import { ELABORACION_RAMAS } from "../lib/sector-personnel";
import {
  createManualWorkItem,
  getManualWorkItemMeta,
  listAllManualWorkItems,
  reassignManualWorkItem,
} from "../adapters/manual-work-items-repository";
import { pushNotification } from "@/features/os/feedback/notifications-store";
import { OperationalTable, StatusChip, type OperationalTableColumn } from "../components/operational-ui";

type AssignableSector = Extract<SectorId, "ELABORACION" | "ENVASADO_MASIVO" | "ENVASADO_PREMIUM">;

const MASIVO_LINES = ["Línea 1", "Línea 2", "Línea 3", "Línea opcional"];
const PREMIUM_LINES = ["Línea 1", "Línea 2 opcional"];

const PRIORITY_LABELS: Record<WorkItemPriority, string> = {
  URGENTE: "Urgente",
  HOY: "Hoy",
  ESTA_SEMANA: "Esta semana",
  NORMAL: "Normal",
  BAJA: "Baja",
};

function today(): string {
  return new Date().toISOString().slice(0, 10);
}

/** Producción crea y asigna trabajos a Elaboración / Envasado Masivo / Envasado Premium. */
export function AsignarTrabajosView() {
  const workspace = useRequiredWorkspace();
  const [sector, setSector] = useState<AssignableSector>("ELABORACION");
  const [ownerPerson, setOwnerPerson] = useState<string>(ELABORACION_RAMAS[0]);
  const [line, setLine] = useState<string>(MASIVO_LINES[0]);
  const [client, setClient] = useState("");
  const [product, setProduct] = useState("");
  const [plannedDate, setPlannedDate] = useState(today());
  const [quantity, setQuantity] = useState("");
  const [priority, setPriority] = useState<WorkItemPriority>("NORMAL");
  const [orderRef, setOrderRef] = useState("");
  const [notes, setNotes] = useState("");
  const [feedback, setFeedback] = useState<string | null>(null);
  const [tick, setTick] = useState(0);

  const unit = sector === "ELABORACION" ? "kg" : "un.";
  const lineOptions = sector === "ENVASADO_MASIVO" ? MASIVO_LINES : PREMIUM_LINES;

  const items = useMemo(() => listAllManualWorkItems(), [tick]);
  const [reassigningId, setReassigningId] = useState<string | null>(null);
  const [reassignDate, setReassignDate] = useState("");

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!client.trim() || !product.trim() || !quantity.trim()) {
      setFeedback("Completá cliente, producto y cantidad.");
      return;
    }

    createManualWorkItem({
      sector,
      ownerPerson: sector === "ELABORACION" ? ownerPerson : null,
      line: sector === "ELABORACION" ? null : line,
      client: client.trim(),
      product: product.trim(),
      plannedDate,
      quantity: quantity.trim(),
      unit,
      priority,
      oeRef: sector === "ELABORACION" ? orderRef.trim() || null : null,
      oaRef: sector !== "ELABORACION" ? orderRef.trim() || null : null,
      notes: notes.trim() || null,
      assignedBy: workspace.context.displayName,
    });

    pushNotification({
      kind: "trabajo_asignado",
      title: `Nuevo trabajo asignado — ${SECTOR_LABELS[sector]}`,
      message: `${product.trim()} · ${client.trim()} para ${new Date(plannedDate).toLocaleDateString("es-AR")}`,
      sectors: [sector],
    });

    setFeedback("Trabajo asignado correctamente.");
    setClient("");
    setProduct("");
    setQuantity("");
    setOrderRef("");
    setNotes("");
    setTick((v) => v + 1);
    window.setTimeout(() => setFeedback(null), 4000);
  };

  const columns: OperationalTableColumn<(typeof items)[number]>[] = [
    { key: "sector", header: "Sector", render: (r) => SECTOR_LABELS[r.sector] },
    {
      key: "fecha",
      header: "Fecha",
      render: (r) => (r.plannedDate ? new Date(r.plannedDate).toLocaleDateString("es-AR") : "—"),
    },
    { key: "cliente", header: "Cliente", render: (r) => r.client ?? "—" },
    { key: "producto", header: "Producto", render: (r) => r.product ?? "—" },
    { key: "cantidad", header: "Cantidad", render: (r) => [r.quantity, r.unit].filter(Boolean).join(" ") },
    { key: "asignado", header: "Asignado a", render: (r) => r.ownerPerson ?? r.line ?? "—" },
    { key: "estado", header: "Estado", render: (r) => <StatusChip status={r.status} /> },
    {
      key: "asignadoPor",
      header: "Asignado por",
      render: (r) => {
        const meta = getManualWorkItemMeta(r.id);
        return (
          <span className="text-xs text-[var(--os-text-muted)]">
            {meta?.assignedBy ?? "—"}
            {meta?.reassignedBy ? ` · reasignado por ${meta.reassignedBy}` : ""}
          </span>
        );
      },
    },
    {
      key: "acciones",
      header: "Acción",
      render: (r) =>
        reassigningId === r.id ? (
          <div className="flex items-center gap-1.5">
            <input
              type="date"
              value={reassignDate}
              onChange={(e) => setReassignDate(e.target.value)}
              aria-label={`Nueva fecha para ${r.product ?? "trabajo"}`}
              className="rounded border border-[var(--os-border)] px-1.5 py-1 text-xs"
            />
            <button
              type="button"
              className="text-xs font-medium text-[var(--os-teal)] hover:underline"
              onClick={() => {
                if (!reassignDate) return;
                reassignManualWorkItem(r.id, { plannedDate: reassignDate }, workspace.context.displayName);
                pushNotification({
                  kind: "trabajo_asignado",
                  title: `Trabajo reasignado — ${SECTOR_LABELS[r.sector]}`,
                  message: `${r.product ?? "Producto"} · ${r.client ?? ""} — nueva fecha ${new Date(reassignDate).toLocaleDateString("es-AR")}`,
                  sectors: [r.sector],
                });
                setReassigningId(null);
                setTick((v) => v + 1);
              }}
            >
              Guardar
            </button>
            <button
              type="button"
              className="text-xs text-[var(--os-text-muted)] hover:underline"
              onClick={() => setReassigningId(null)}
            >
              Cancelar
            </button>
          </div>
        ) : (
          <button
            type="button"
            className="text-xs font-medium text-[var(--os-teal)] hover:underline"
            onClick={() => {
              setReassigningId(r.id);
              setReassignDate(r.plannedDate ?? today());
            }}
          >
            Reasignar fecha
          </button>
        ),
    },
  ];

  return (
    <TwinShell title="Asignar trabajos">
    <div className="space-y-6">
      <header>
        <h2 className="text-2xl font-semibold tracking-tight">Asignar trabajos</h2>
        <p className="text-sm text-[var(--os-text-muted)]">
          Creá y asigná trabajos a Elaboración, Envasado Masivo o Envasado Premium.
        </p>
      </header>

      <form
        onSubmit={handleSubmit}
        className="grid grid-cols-1 gap-4 rounded-[var(--os-radius)] border border-[var(--os-border)] bg-[var(--os-surface)] p-5 sm:grid-cols-2 lg:grid-cols-3"
      >
        <div className="space-y-1.5">
          <label htmlFor="af-sector" className="text-sm font-medium">Sector</label>
          <select
            id="af-sector"
            value={sector}
            onChange={(e) => {
              const next = e.target.value as AssignableSector;
              setSector(next);
              setLine(next === "ENVASADO_MASIVO" ? MASIVO_LINES[0] : PREMIUM_LINES[0]);
            }}
            className="w-full rounded-[var(--os-radius-sm)] border border-[var(--os-border)] px-3 py-2 text-sm"
          >
            <option value="ELABORACION">Elaboración</option>
            <option value="ENVASADO_MASIVO">Envasado Masivo</option>
            <option value="ENVASADO_PREMIUM">Envasado Premium</option>
          </select>
        </div>

        {sector === "ELABORACION" ? (
          <div className="space-y-1.5">
            <label htmlFor="af-owner" className="text-sm font-medium">Responsable</label>
            <select
              id="af-owner"
              value={ownerPerson}
              onChange={(e) => setOwnerPerson(e.target.value)}
              className="w-full rounded-[var(--os-radius-sm)] border border-[var(--os-border)] px-3 py-2 text-sm"
            >
              {ELABORACION_RAMAS.map((rama) => (
                <option key={rama} value={rama}>
                  {rama}
                </option>
              ))}
            </select>
          </div>
        ) : (
          <div className="space-y-1.5">
            <label htmlFor="af-line" className="text-sm font-medium">Línea</label>
            <select
              id="af-line"
              value={line}
              onChange={(e) => setLine(e.target.value)}
              className="w-full rounded-[var(--os-radius-sm)] border border-[var(--os-border)] px-3 py-2 text-sm"
            >
              {lineOptions.map((opt) => (
                <option key={opt} value={opt}>
                  {opt}
                </option>
              ))}
            </select>
          </div>
        )}

        <div className="space-y-1.5">
          <label htmlFor="af-client" className="text-sm font-medium">Cliente</label>
          <input
            id="af-client"
            value={client}
            onChange={(e) => setClient(e.target.value)}
            className="w-full rounded-[var(--os-radius-sm)] border border-[var(--os-border)] px-3 py-2 text-sm"
            required
          />
        </div>

        <div className="space-y-1.5">
          <label htmlFor="af-product" className="text-sm font-medium">Producto</label>
          <input
            id="af-product"
            value={product}
            onChange={(e) => setProduct(e.target.value)}
            className="w-full rounded-[var(--os-radius-sm)] border border-[var(--os-border)] px-3 py-2 text-sm"
            required
          />
        </div>

        <div className="space-y-1.5">
          <label htmlFor="af-date" className="text-sm font-medium">Fecha</label>
          <input
            id="af-date"
            type="date"
            value={plannedDate}
            onChange={(e) => setPlannedDate(e.target.value)}
            className="w-full rounded-[var(--os-radius-sm)] border border-[var(--os-border)] px-3 py-2 text-sm"
            required
          />
        </div>

        <div className="space-y-1.5">
          <label htmlFor="af-qty" className="text-sm font-medium">
            Cantidad ({unit})
          </label>
          <input
            id="af-qty"
            type="text"
            inputMode="decimal"
            value={quantity}
            onChange={(e) => setQuantity(e.target.value)}
            className="w-full rounded-[var(--os-radius-sm)] border border-[var(--os-border)] px-3 py-2 text-sm"
            required
          />
        </div>

        <div className="space-y-1.5">
          <label htmlFor="af-priority" className="text-sm font-medium">Prioridad</label>
          <select
            id="af-priority"
            value={priority}
            onChange={(e) => setPriority(e.target.value as WorkItemPriority)}
            className="w-full rounded-[var(--os-radius-sm)] border border-[var(--os-border)] px-3 py-2 text-sm"
          >
            {WORK_ITEM_PRIORITIES.map((p) => (
              <option key={p} value={p}>
                {PRIORITY_LABELS[p]}
              </option>
            ))}
          </select>
        </div>

        <div className="space-y-1.5">
          <label htmlFor="af-ref" className="text-sm font-medium">
            {sector === "ELABORACION" ? "OE" : "OA"}
          </label>
          <input
            id="af-ref"
            value={orderRef}
            onChange={(e) => setOrderRef(e.target.value)}
            placeholder="Opcional"
            className="w-full rounded-[var(--os-radius-sm)] border border-[var(--os-border)] px-3 py-2 text-sm"
          />
        </div>

        <div className="space-y-1.5 sm:col-span-2 lg:col-span-3">
          <label htmlFor="af-notes" className="text-sm font-medium">Observaciones iniciales</label>
          <textarea
            id="af-notes"
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            rows={2}
            className="w-full rounded-[var(--os-radius-sm)] border border-[var(--os-border)] px-3 py-2 text-sm"
          />
        </div>

        <div className="sm:col-span-2 lg:col-span-3 flex items-center gap-3">
          <Button type="submit" variant="primary">
            Asignar trabajo
          </Button>
          {feedback && <span className="text-sm text-emerald-700">{feedback}</span>}
        </div>
      </form>

      <section>
        <h3 className="mb-3 text-sm font-semibold uppercase tracking-wide text-[var(--os-text-muted)]">
          Trabajos asignados por Producción
        </h3>
        <OperationalTable
          columns={columns}
          rows={items}
          rowKey={(r) => r.id}
          emptyMessage="Todavía no se asignaron trabajos manualmente."
        />
      </section>
    </div>
    </TwinShell>
  );
}
