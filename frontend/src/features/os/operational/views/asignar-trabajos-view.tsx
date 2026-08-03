"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { TwinShell } from "@/features/os/shell/twin-shell";
import { usePreviewSession } from "@/features/os/session/preview-context";
import { useRequiredWorkspace } from "@/features/os/workspace/workspace-provider";
import type { SectorId } from "@/types/operational/sector";
import { SECTOR_LABELS } from "@/types/operational/sector";
import { ELABORACION_RAMAS } from "../lib/sector-personnel";
import {
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
import type { WorkItem } from "@/types/operational/work-item";
import { getClientPlanningSource } from "@/lib/planning/planning-source";

type AssignableSector = Extract<SectorId, "ELABORACION" | "ENVASADO_MASIVO" | "ENVASADO_PREMIUM">;

const MASIVO_LINES = ["Línea 1", "Línea 2", "Línea 3", "Línea 4"];
const PREMIUM_LINES = ["Línea 1", "Línea 2"];

const CONTROL_CLASS =
  "w-full rounded-[var(--os-radius-sm)] border border-[var(--os-border)] bg-[var(--ig-control-bg,var(--os-surface))] px-3 py-2 text-sm text-[var(--ig-control-fg,var(--os-text))]";

function newIdempotencyKey(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return crypto.randomUUID();
  }
  return `assign-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

function mapUserFacingError(status: number, code: string | undefined, offline: boolean): string {
  if (offline) return "Sin conexión. No se pudo guardar. Reintentá cuando vuelva la red.";
  if (status === 401 || code === "UNAUTHORIZED") {
    return "Sesión vencida. Volvé a iniciar sesión.";
  }
  if (status === 403 || code === "FORBIDDEN") {
    return "No tenés permiso para asignar trabajos.";
  }
  if (status === 409 || code === "VERSION_CONFLICT") {
    return "Esta orden ya tiene un trabajo asignado.";
  }
  if (status >= 500 || code === "PLANNING_FAILED" || code === "DATABASE_UNAVAILABLE") {
    return "No se pudo completar la operación. Reintentá.";
  }
  return "No se pudo completar la asignación. Reintentá.";
}

/** Producción crea y asigna trabajos — persistencia Neon cuando planning=native. */
export function AsignarTrabajosView() {
  const workspace = useRequiredWorkspace();
  const session = usePreviewSession();
  const { getFinishedQty } = useOperationalStore();
  const native = getClientPlanningSource() === "native";

  const [sector, setSector] = useState<AssignableSector>("ELABORACION");
  const [ownerPerson, setOwnerPerson] = useState<string>(ELABORACION_RAMAS[0]);
  const [line, setLine] = useState<string>(MASIVO_LINES[0]);
  const [client, setClient] = useState("");
  const [product, setProduct] = useState("");
  const [plannedDate, setPlannedDate] = useState(todayIso());
  const [plannedDateTo, setPlannedDateTo] = useState(todayIso());
  const [deliveryDate, setDeliveryDate] = useState(todayIso());
  const [quantity, setQuantity] = useState("");
  const [orderRef, setOrderRef] = useState("");
  const [notes, setNotes] = useState("");
  const [packagingLote, setPackagingLote] = useState("");
  const [packagingVto, setPackagingVto] = useState("");
  const [feedback, setFeedback] = useState<string | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [tick, setTick] = useState(0);
  const [filterDelivery, setFilterDelivery] = useState("");
  const [reassigningId, setReassigningId] = useState<string | null>(null);
  const [reassignDelivery, setReassignDelivery] = useState("");
  const [neonItems, setNeonItems] = useState<WorkItem[]>([]);
  const idempotencyRef = useRef(newIdempotencyKey());
  const inFlightRef = useRef(false);

  const refreshNeonList = useCallback(async () => {
    if (!native) return;
    try {
      const res = await fetch("/api/v1/work-assignments", { credentials: "include" });
      if (!res.ok) return;
      const data = (await res.json()) as { workItems?: WorkItem[] };
      setNeonItems(Array.isArray(data.workItems) ? data.workItems : []);
    } catch {
      /* listado best-effort */
    }
  }, [native]);

  useEffect(() => {
    ensureDeliveryDatesMigrated();
    void refreshNeonList();
  }, [refreshNeonList]);

  const unit = sector === "ELABORACION" ? "kg" : "un.";
  const lineOptions = sector === "ENVASADO_MASIVO" ? MASIVO_LINES : PREMIUM_LINES;

  const items = useMemo(() => {
    if (native) {
      const mapped = neonItems.map((r) => ({
        ...r,
        deliveryDate: r.deliveryDate ?? r.plannedDateTo ?? r.plannedDate ?? null,
      }));
      return filterByDeliveryDate(sortByDeliveryDateNearest(mapped), filterDelivery || null);
    }
    const all = sortByDeliveryDateNearest(listAllManualWorkItems());
    return filterByDeliveryDate(all, filterDelivery || null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tick, filterDelivery, neonItems, native]);

  const clearFormAfterSuccess = () => {
    setClient("");
    setProduct("");
    setQuantity("");
    setOrderRef("");
    setNotes("");
    setPackagingLote("");
    setPackagingVto("");
    idempotencyRef.current = newIdempotencyKey();
  };

  const submitAssignment = async () => {
    if (inFlightRef.current || submitting) return;
    setErrorMsg(null);
    setFeedback(null);

    if (!client.trim() || !product.trim() || !quantity.trim()) {
      setErrorMsg("Completá cliente, producto y cantidad.");
      return;
    }
    if (!plannedDate || !plannedDateTo) {
      setErrorMsg("Indicá el rango Desde / Hasta de la asignación.");
      return;
    }
    if (plannedDateTo < plannedDate) {
      setErrorMsg("Hasta no puede ser anterior a Desde.");
      return;
    }
    if (!deliveryDate) {
      setErrorMsg("La fecha de entrega es obligatoria.");
      return;
    }

    if (!native) {
      setErrorMsg(
        "La asignación durable requiere planificación nativa (Neon). No se simuló el guardado."
      );
      return;
    }

    inFlightRef.current = true;
    setSubmitting(true);
    setFeedback("Asignando…");

    const payload = {
      sector,
      ownerPerson: sector === "ELABORACION" ? ownerPerson : null,
      line: sector === "ELABORACION" ? null : line,
      client: client.trim(),
      product: product.trim(),
      plannedDate,
      plannedDateTo,
      deliveryDate,
      plannedQuantity: quantity.trim(),
      unit,
      orderNumber: orderRef.trim() || null,
      notes: notes.trim() || null,
      packagingLote: sector === "ELABORACION" ? null : packagingLote.trim() || null,
      packagingVto: sector === "ELABORACION" ? null : packagingVto.trim() || null,
      idempotencyKey: idempotencyRef.current,
    };

    const offline = typeof navigator !== "undefined" && navigator.onLine === false;
    if (offline) {
      setFeedback(null);
      setErrorMsg(mapUserFacingError(0, undefined, true));
      inFlightRef.current = false;
      setSubmitting(false);
      return;
    }

    try {
      const operationId = newIdempotencyKey();
      const res = await fetch("/api/v1/work-assignments", {
        method: "POST",
        credentials: "include",
        headers: {
          "content-type": "application/json",
          "x-genus-operation-id": operationId,
        },
        body: JSON.stringify(payload),
      });

      let data: {
        error?: string;
        code?: string;
        ok?: boolean;
        replayed?: boolean;
        workItem?: WorkItem;
      } = {};
      try {
        data = (await res.json()) as typeof data;
      } catch {
        data = {};
      }

      if (!res.ok || !data.ok) {
        const msg =
          (data.error &&
          !/failed query|neon|vercel|sql|postgres|stack/i.test(data.error)
            ? data.error
            : null) ?? mapUserFacingError(res.status, data.code, false);
        setFeedback(null);
        setErrorMsg(msg);
        return;
      }

      pushNotification({
        kind: "trabajo_asignado",
        title: `Nuevo trabajo asignado — ${SECTOR_LABELS[sector]}`,
        message: `${product.trim()} · ${client.trim()} — ${new Date(plannedDate + "T12:00:00").toLocaleDateString("es-AR")} → ${new Date(plannedDateTo + "T12:00:00").toLocaleDateString("es-AR")}`,
        sectors: [sector],
      });

      setErrorMsg(null);
      setFeedback(
        data.replayed
          ? "Asignación ya confirmada en Neon (sin duplicar)."
          : "Trabajo asignado y confirmado en Neon."
      );
      clearFormAfterSuccess();
      await refreshNeonList();
      setTick((v) => v + 1);
      window.setTimeout(() => setFeedback(null), 4000);
    } catch {
      setFeedback(null);
      setErrorMsg(mapUserFacingError(0, undefined, !navigator.onLine));
    } finally {
      inFlightRef.current = false;
      setSubmitting(false);
    }
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    void submitAssignment();
  };

  const notifyLifecycleChange = (message: string) => {
    setFeedback(message);
    setTick((v) => v + 1);
    void refreshNeonList();
    window.setTimeout(() => setFeedback(null), 4000);
  };

  const columns: OperationalTableColumn<(typeof items)[number]>[] = [
    { key: "sector", header: "Sector", hideOnMobile: "xl", render: (r) => SECTOR_LABELS[r.sector] },
    {
      key: "entrega",
      header: "Fecha de entrega",
      hideOnMobile: "xl",
      render: (r) => <DeliveryDateBadge deliveryDate={r.deliveryDate} />,
    },
    {
      key: "fecha",
      header: "Rango planificado",
      render: (r) => {
        if (!r.plannedDate) return "—";
        const from = new Date(r.plannedDate + "T12:00:00").toLocaleDateString("es-AR");
        const toIso = r.plannedDateTo || r.plannedDate;
        const to = new Date(toIso + "T12:00:00").toLocaleDateString("es-AR");
        return from === to ? from : `${from} → ${to}`;
      },
    },
    { key: "cliente", header: "Cliente", render: (r) => r.client ?? "—" },
    { key: "producto", header: "Producto", render: (r) => r.product ?? "—" },
    { key: "cantidad", header: "Cantidad", render: (r) => [r.quantity, r.unit].filter(Boolean).join(" ") },
    {
      key: "lote",
      header: "LOTE",
      render: (r) => r.packagingLote || r.loteRef || "—",
    },
    {
      key: "vto",
      header: "VTO",
      render: (r) => r.packagingVto || "—",
    },
    { key: "asignado", header: "Asignado a", render: (r) => r.ownerPerson ?? r.line ?? "—" },
    { key: "estado", header: "Estado", render: (r) => <StatusChip status={r.status} /> },
    {
      key: "asignadoPor",
      header: "Asignado por",
      render: (r) => {
        if (native) {
          return (
            <span className="text-xs text-[var(--os-text-muted)]">
              {(r as WorkItem).createdFrom ?? "Neon"}
            </span>
          );
        }
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
        native ? (
          <span className="text-xs text-[var(--os-text-muted)]">Confirmado Neon</span>
        ) : reassigningId === r.id ? (
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
                setReassigningId(null);
                notifyLifecycleChange("Fecha de entrega actualizada.");
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
          <div className="os-row-actions">
            <button
              type="button"
              className="text-xs font-medium text-[var(--os-teal)] hover:underline"
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
            Creá y asigná trabajos con fecha de entrega. El guardado se confirma en Neon antes de
            mostrar éxito; doble clic o reintento reutilizan la misma clave de idempotencia.
          </p>
        </header>

        <form
          onSubmit={handleSubmit}
          className="grid grid-cols-1 gap-4 rounded-[var(--os-radius)] border border-[var(--os-border)] bg-[var(--os-surface)] p-5 sm:grid-cols-2 lg:grid-cols-3"
          aria-busy={submitting}
        >
          <div className="space-y-1.5">
            <label htmlFor="af-sector" className="text-sm font-medium">
              Asignar a
            </label>
            <select
              id="af-sector"
              value={sector}
              disabled={submitting}
              onChange={(e) => {
                const next = e.target.value as AssignableSector;
                setSector(next);
                setLine(next === "ENVASADO_MASIVO" ? MASIVO_LINES[0] : PREMIUM_LINES[0]);
              }}
              className={CONTROL_CLASS}
              data-testid="assign-sector"
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
                disabled={submitting}
                onChange={(e) => setOwnerPerson(e.target.value)}
                className={CONTROL_CLASS}
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
                disabled={submitting}
                onChange={(e) => setLine(e.target.value)}
                className={CONTROL_CLASS}
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
              disabled={submitting}
              onChange={(e) => setClient(e.target.value)}
              className={CONTROL_CLASS}
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
              disabled={submitting}
              onChange={(e) => setProduct(e.target.value)}
              className={CONTROL_CLASS}
              required
            />
          </div>

          <div className="space-y-1.5">
            <label htmlFor="af-date-from" className="text-sm font-medium">
              Desde (aparición en Semana)
            </label>
            <input
              id="af-date-from"
              type="date"
              value={plannedDate}
              disabled={submitting}
              onChange={(e) => {
                const v = e.target.value;
                setPlannedDate(v);
                if (plannedDateTo < v) setPlannedDateTo(v);
              }}
              className={CONTROL_CLASS}
              required
            />
          </div>

          <div className="space-y-1.5">
            <label htmlFor="af-date-to" className="text-sm font-medium">
              Hasta (aparición en Semana)
            </label>
            <input
              id="af-date-to"
              type="date"
              value={plannedDateTo}
              min={plannedDate}
              disabled={submitting}
              onChange={(e) => setPlannedDateTo(e.target.value)}
              className={CONTROL_CLASS}
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
              disabled={submitting}
              onChange={(e) => setDeliveryDate(e.target.value)}
              className={CONTROL_CLASS}
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
              disabled={submitting}
              onChange={(e) => setQuantity(e.target.value)}
              className={CONTROL_CLASS}
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
              disabled={submitting}
              onChange={(e) => setOrderRef(e.target.value)}
              placeholder="Opcional"
              className={CONTROL_CLASS}
            />
          </div>

          {sector !== "ELABORACION" ? (
            <>
              <div className="space-y-1.5">
                <label htmlFor="af-lote" className="text-sm font-medium">
                  LOTE (opcional)
                </label>
                <input
                  id="af-lote"
                  value={packagingLote}
                  disabled={submitting}
                  onChange={(e) => setPackagingLote(e.target.value)}
                  placeholder="Puede completarse después"
                  className={CONTROL_CLASS}
                  data-testid="assign-packaging-lote"
                />
              </div>
              <div className="space-y-1.5">
                <label htmlFor="af-vto" className="text-sm font-medium">
                  VTO (opcional)
                </label>
                <input
                  id="af-vto"
                  value={packagingVto}
                  disabled={submitting}
                  onChange={(e) => setPackagingVto(e.target.value)}
                  placeholder="Puede completarse después"
                  className={CONTROL_CLASS}
                  data-testid="assign-packaging-vto"
                />
              </div>
            </>
          ) : null}

          <div className="space-y-1.5 sm:col-span-2 lg:col-span-3">
            <label htmlFor="af-notes" className="text-sm font-medium">
              Observaciones iniciales
            </label>
            <textarea
              id="af-notes"
              value={notes}
              disabled={submitting}
              onChange={(e) => setNotes(e.target.value)}
              rows={2}
              className={CONTROL_CLASS}
            />
          </div>

          <div className="flex flex-wrap items-center gap-3 sm:col-span-2 lg:col-span-3">
            <Button
              type="submit"
              variant="primary"
              disabled={submitting}
              data-testid="assign-submit"
            >
              {submitting ? "Asignando…" : "Asignar trabajo"}
            </Button>
            {errorMsg ? (
              <>
                <span className="text-sm text-[var(--genus-danger,#e85d5d)]" role="alert" data-testid="assign-error">
                  {errorMsg}
                </span>
                <Button
                  type="button"
                  variant="secondary"
                  disabled={submitting}
                  onClick={() => void submitAssignment()}
                  data-testid="assign-retry"
                >
                  Reintentar
                </Button>
              </>
            ) : null}
            {feedback && !errorMsg ? (
              <span className="text-sm text-[var(--genus-success)]" data-testid="assign-feedback">
                {feedback}
              </span>
            ) : null}
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
                className="rounded-[var(--os-radius-sm)] border border-[var(--os-border)] bg-[var(--ig-control-bg,var(--os-surface))] px-2 py-1 text-sm text-[var(--ig-control-fg,var(--os-text))]"
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
            emptyMessage="Todavía no se asignaron trabajos."
          />
        </section>
      </div>
    </TwinShell>
  );
}
