"use client";

import { useEffect, useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { TwinShell } from "@/features/os/shell/twin-shell";
import { usePreviewSession } from "@/features/os/session/preview-context";
import { useRequiredWorkspace } from "@/features/os/workspace/workspace-provider";
import type { SectorId } from "@/types/operational/sector";
import { SECTOR_LABELS } from "@/types/operational/sector";
import { ELABORACION_RAMAS } from "../lib/sector-personnel";
import {
  createManualWorkItem,
  ensureDeliveryDatesMigrated,
  getManualWorkItemMeta,
  listAllManualWorkItems,
  reassignManualWorkItem,
} from "../adapters/manual-work-items-repository";
import { pushNotification } from "@/features/os/feedback/notifications-store";
import { OperationalTable, StatusChip, type OperationalTableColumn } from "../components/operational-ui";
import { DeliveryDateBadge } from "../components/delivery-date-badge";
import { AssignedWorkLifecycleActions } from "../components/assigned-work-lifecycle-actions";
import {
  filterByDeliveryDate,
  sortByDeliveryDateNearest,
  todayIso,
} from "../lib/delivery-date";
import { useOperationalStore } from "../store/operational-store-context";

type AssignableSector = Extract<SectorId, "ELABORACION" | "ENVASADO_MASIVO" | "ENVASADO_PREMIUM">;

const MASIVO_LINES = ["Línea 1", "Línea 2", "Línea 3", "Línea opcional"];
const PREMIUM_LINES = ["Línea 1", "Línea 2 opcional"];

/** Producción crea y asigna trabajos — fecha de entrega en lugar de prioridad visible. */
export function AsignarTrabajosView() {
  const workspace = useRequiredWorkspace();
  const session = usePreviewSession();
  const { getFinishedQty } = useOperationalStore();
  const [sector, setSector] = useState<AssignableSector>("ELABORACION");
  const [ownerPerson, setOwnerPerson] = useState<string>(ELABORACION_RAMAS[0]);
  const [line, setLine] = useState<string>(MASIVO_LINES[0]);
  const [client, setClient] = useState("");
  const [product, setProduct] = useState("");
  const [plannedDate, setPlannedDate] = useState(todayIso());
  const [deliveryDate, setDeliveryDate] = useState(todayIso());
  const [quantity, setQuantity] = useState("");
  const [orderRef, setOrderRef] = useState("");
  const [notes, setNotes] = useState("");
  const [feedback, setFeedback] = useState<string | null>(null);
  const [tick, setTick] = useState(0);
  const [filterDelivery, setFilterDelivery] = useState("");
  const [reassigningId, setReassigningId] = useState<string | null>(null);
  const [reassignDelivery, setReassignDelivery] = useState("");

  useEffect(() => {
    ensureDeliveryDatesMigrated();
  }, []);

  const unit = sector === "ELABORACION" ? "kg" : "un.";
  const lineOptions = sector === "ENVASADO_MASIVO" ? MASIVO_LINES : PREMIUM_LINES;

  const items = useMemo(() => {
    const all = sortByDeliveryDateNearest(listAllManualWorkItems());
    return filterByDeliveryDate(all, filterDelivery || null);
    // tick fuerza relectura de localStorage tras mutaciones.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tick, filterDelivery]);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!client.trim() || !product.trim() || !quantity.trim()) {
      setFeedback("Completá cliente, producto y cantidad.");
      return;
    }
    if (!deliveryDate) {
      setFeedback("La fecha de entrega es obligatoria.");
      return;
    }

    createManualWorkItem({
      sector,
      ownerPerson: sector === "ELABORACION" ? ownerPerson : null,
      line: sector === "ELABORACION" ? null : line,
      client: client.trim(),
      product: product.trim(),
      plannedDate,
      deliveryDate,
      quantity: quantity.trim(),
      unit,
      oeRef: sector === "ELABORACION" ? orderRef.trim() || null : null,
      oaRef: sector !== "ELABORACION" ? orderRef.trim() || null : null,
      notes: notes.trim() || null,
      assignedBy: workspace.context.displayName,
    });

    pushNotification({
      kind: "trabajo_asignado",
      title: `Nuevo trabajo asignado — ${SECTOR_LABELS[sector]}`,
      message: `${product.trim()} · ${client.trim()} — entrega ${new Date(deliveryDate + "T12:00:00").toLocaleDateString("es-AR")}`,
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

  const notifyLifecycleChange = (message: string) => {
    setFeedback(message);
    setTick((v) => v + 1);
    window.setTimeout(() => setFeedback(null), 4000);
  };

  const columns: OperationalTableColumn<(typeof items)[number]>[] = [
    { key: "sector", header: "Sector", render: (r) => SECTOR_LABELS[r.sector] },
    {
      key: "entrega",
      header: "Fecha de entrega",
      render: (r) => <DeliveryDateBadge deliveryDate={r.deliveryDate} />,
    },
    {
      key: "fecha",
      header: "Fecha planificada",
      render: (r) =>
        r.plannedDate ? new Date(r.plannedDate + "T12:00:00").toLocaleDateString("es-AR") : "—",
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
          <div className="flex flex-wrap items-center gap-1.5">
            <input
              type="date"
              value={reassignDelivery}
              onChange={(e) => setReassignDelivery(e.target.value)}
              aria-label={`Nueva fecha de entrega para ${r.product ?? "trabajo"}`}
              className="rounded border border-[var(--os-border)] px-1.5 py-1 text-xs"
            />
            <button
              type="button"
              className="text-xs font-medium text-[var(--os-teal)] hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--os-teal)]"
              onClick={() => {
                if (!reassignDelivery) return;
                reassignManualWorkItem(
                  r.id,
                  { deliveryDate: reassignDelivery },
                  workspace.context.displayName
                );
                pushNotification({
                  kind: "trabajo_asignado",
                  title: `Fecha de entrega actualizada — ${SECTOR_LABELS[r.sector]}`,
                  message: `${r.product ?? "Producto"} · nueva entrega ${new Date(reassignDelivery + "T12:00:00").toLocaleDateString("es-AR")}`,
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
          <div className="flex items-center gap-2">
            <button
              type="button"
              className="text-xs font-medium text-[var(--os-teal)] hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--os-teal)]"
              onClick={() => {
                setReassigningId(r.id);
                setReassignDelivery(r.deliveryDate ?? r.plannedDate ?? todayIso());
              }}
            >
              Editar entrega
            </button>
            <AssignedWorkLifecycleActions
              item={r}
              actorSectorId={session.sectorId}
              actorName={workspace.context.displayName}
              finishedQty={getFinishedQty(r.id)}
              onChanged={() => notifyLifecycleChange("Lista de trabajos actualizada.")}
              onToast={(message) => notifyLifecycleChange(message)}
            />
          </div>
        ),
    },
  ];

  return (
    <TwinShell title="Asignar trabajos">
      <div className="space-y-6">
        <header>
          <h2 className="text-2xl font-semibold tracking-tight">Asignar trabajos</h2>
          <p className="text-sm text-[var(--os-text-muted)]">
            Creá y asigná trabajos con fecha de entrega. Usá el botón rojo{" "}
            <strong>Eliminar trabajo</strong> (papelera) en cada fila para quitar pendientes sin avances, o{" "}
            <strong>Cancelar trabajo</strong> si ya tienen avance. Los cancelados/eliminados se revisan en
            Historial.
          </p>
        </header>

        <form
          onSubmit={handleSubmit}
          className="grid grid-cols-1 gap-4 rounded-[var(--os-radius)] border border-[var(--os-border)] bg-[var(--os-surface)] p-5 sm:grid-cols-2 lg:grid-cols-3"
        >
          <div className="space-y-1.5">
            <label htmlFor="af-sector" className="text-sm font-medium">
              Sector
            </label>
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
              <label htmlFor="af-owner" className="text-sm font-medium">
                Responsable
              </label>
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
              <label htmlFor="af-line" className="text-sm font-medium">
                Línea
              </label>
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
            <label htmlFor="af-client" className="text-sm font-medium">
              Cliente
            </label>
            <input
              id="af-client"
              value={client}
              onChange={(e) => setClient(e.target.value)}
              className="w-full rounded-[var(--os-radius-sm)] border border-[var(--os-border)] px-3 py-2 text-sm"
              required
            />
          </div>

          <div className="space-y-1.5">
            <label htmlFor="af-product" className="text-sm font-medium">
              Producto
            </label>
            <input
              id="af-product"
              value={product}
              onChange={(e) => setProduct(e.target.value)}
              className="w-full rounded-[var(--os-radius-sm)] border border-[var(--os-border)] px-3 py-2 text-sm"
              required
            />
          </div>

          <div className="space-y-1.5">
            <label htmlFor="af-date" className="text-sm font-medium">
              Fecha planificada
            </label>
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
            <label htmlFor="af-delivery" className="text-sm font-medium">
              Fecha de entrega
            </label>
            <input
              id="af-delivery"
              type="date"
              value={deliveryDate}
              onChange={(e) => setDeliveryDate(e.target.value)}
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
            <label htmlFor="af-notes" className="text-sm font-medium">
              Observaciones iniciales
            </label>
            <textarea
              id="af-notes"
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              rows={2}
              className="w-full rounded-[var(--os-radius-sm)] border border-[var(--os-border)] px-3 py-2 text-sm"
            />
          </div>

          <div className="flex items-center gap-3 sm:col-span-2 lg:col-span-3">
            <Button type="submit" variant="primary">
              Asignar trabajo
            </Button>
            {feedback && <span className="text-sm text-emerald-700">{feedback}</span>}
          </div>
        </form>

        <section className="space-y-3">
          <div className="flex flex-wrap items-end justify-between gap-3">
            <h3 className="text-sm font-semibold uppercase tracking-wide text-[var(--os-text-muted)]">
              Trabajos asignados por Producción
            </h3>
            <div className="flex flex-wrap items-center gap-2">
              <label htmlFor="filter-delivery" className="text-xs text-[var(--os-text-muted)]">
                Filtrar por fecha de entrega
              </label>
              <input
                id="filter-delivery"
                type="date"
                value={filterDelivery}
                onChange={(e) => setFilterDelivery(e.target.value)}
                className="rounded-[var(--os-radius-sm)] border border-[var(--os-border)] px-2 py-1 text-sm"
              />
              {filterDelivery && (
                <button
                  type="button"
                  className="text-xs text-[var(--os-teal)] hover:underline"
                  onClick={() => setFilterDelivery("")}
                >
                  Limpiar
                </button>
              )}
              <span className="text-xs text-[var(--os-text-muted)]">{items.length} resultado(s)</span>
            </div>
          </div>
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
