"use client";

import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import type { SectorId } from "@/types/operational/sector";
import { SECTOR_LABELS } from "@/types/operational/sector";
import { ELABORACION_RAMAS } from "../lib/sector-personnel";
import { pushNotification } from "@/features/os/feedback/notifications-store";
import type { WorkItem } from "@/types/operational/work-item";
import { getClientPlanningSource } from "@/lib/planning/planning-source";
import type { ProductionPedidoRecord } from "@/lib/production-pedidos/types";
import { todayIso } from "../lib/delivery-date";

export type AssignableSector = Extract<
  SectorId,
  "ELABORACION" | "ENVASADO_MASIVO" | "ENVASADO_PREMIUM" | "CODIFICADO"
>;

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
  if (code === "OA_DATA_MISMATCH") {
    return "La OA ya existe con datos distintos. Revisá antes de continuar.";
  }
  if (status === 409 || code === "VERSION_CONFLICT") {
    return "Esta OA ya tiene un trabajo asignado (1 trabajo = 1 OA).";
  }
  if (status >= 500 || code === "PLANNING_FAILED" || code === "DATABASE_UNAVAILABLE") {
    return "No se pudo completar la operación. Reintentá.";
  }
  return "No se pudo completar la asignación. Reintentá.";
}

function isPackagingAssignSector(sector: AssignableSector): boolean {
  return sector === "ENVASADO_MASIVO" || sector === "ENVASADO_PREMIUM" || sector === "CODIFICADO";
}

/** Cantidad relevante para el sector actual — kg (Elaboración) o unidades (resto). Nunca inventa si falta el dato. */
function pedidoQuantityLabel(p: ProductionPedidoRecord, sector: AssignableSector): string | null {
  if (sector === "ELABORACION") {
    return p.kgDisplay ? `${p.kgDisplay} kg` : null;
  }
  return p.q != null ? `${p.q} u.` : null;
}

interface AssignWorkDialogProps {
  /** Sector fijo para esta asignación — el mismo sector desde el que se abrió el diálogo. */
  sector: AssignableSector;
  onClose: () => void;
  onAssigned?: (workItem: WorkItem) => void;
  /**
   * Preselección al abrir desde el botón "+" de una celda día/línea de la
   * grilla Semanas — el valor inicial es exactamente el lugar desde donde
   * se abrió, pero sigue siendo editable (no se bloquea el control).
   */
  initialLine?: string;
  /** Idem — fecha de producción (Desde/Hasta) preseleccionada desde la celda. */
  initialPlannedDate?: string;
}

/**
 * Modal "Asignar trabajo" reutilizable — extraído de la antigua pestaña
 * general Asignar Trabajos (asignar-trabajos-view.tsx) para poder montarse
 * desde cada vista de sector (Elaboración/Envasado Masivo/Envasado Premium/
 * Codificado) con el sector ya preseleccionado y fijo. Conserva intacta la
 * lógica de creación: búsqueda por N° de Pedido, autocompletado de Cliente/
 * Producto/kg, hint de OA existente, idempotencia y persistencia real en
 * Neon vía POST /api/v1/work-assignments (assignWorkItemDurable) — no
 * reimplementa nada de eso. El padre debe montar/desmontar este componente
 * (no reusar la misma instancia entre aperturas) para que el formulario
 * arranque limpio cada vez.
 */
export function AssignWorkDialog({
  sector,
  onClose,
  onAssigned,
  initialLine,
  initialPlannedDate,
}: AssignWorkDialogProps) {
  const native = getClientPlanningSource() === "native";

  const [ownerPerson, setOwnerPerson] = useState<string>(ELABORACION_RAMAS[0]);
  const [line, setLine] = useState<string>(
    initialLine || (sector === "ENVASADO_MASIVO" ? MASIVO_LINES[0] : PREMIUM_LINES[0])
  );
  const [client, setClient] = useState("");
  const [product, setProduct] = useState("");
  const [plannedDate, setPlannedDate] = useState(initialPlannedDate || todayIso());
  const [plannedDateTo, setPlannedDateTo] = useState(initialPlannedDate || todayIso());
  const [deliveryDate, setDeliveryDate] = useState(todayIso());
  const [quantity, setQuantity] = useState("");
  const [orderRef, setOrderRef] = useState("");
  const [notes, setNotes] = useState("");
  const [packagingLote, setPackagingLote] = useState("");
  const [packagingVto, setPackagingVto] = useState("");
  const [feedback, setFeedback] = useState<string | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [oaHint, setOaHint] = useState<string | null>(null);
  const [oaForceConfirm, setOaForceConfirm] = useState<string | null>(null);
  const [pedidoQuery, setPedidoQuery] = useState("");
  const [pedidoResults, setPedidoResults] = useState<ProductionPedidoRecord[]>([]);
  const [pedidoSearching, setPedidoSearching] = useState(false);
  const [pedidoSearched, setPedidoSearched] = useState(false);
  const [pedidoSearchError, setPedidoSearchError] = useState<string | null>(null);
  const [selectedPedido, setSelectedPedido] = useState<ProductionPedidoRecord | null>(null);
  const idempotencyRef = useRef(newIdempotencyKey());
  const inFlightRef = useRef(false);

  // Lookup OA al escribir número (solo sectores de acondicionamiento).
  useEffect(() => {
    if (!native || !isPackagingAssignSector(sector)) {
      const t = window.setTimeout(() => setOaHint(null), 0);
      return () => window.clearTimeout(t);
    }
    const raw = orderRef.trim();
    if (!raw) {
      const t = window.setTimeout(() => setOaHint(null), 0);
      return () => window.clearTimeout(t);
    }
    const handle = window.setTimeout(() => {
      void (async () => {
        try {
          const res = await fetch(`/api/v1/work-assignments?oaNumber=${encodeURIComponent(raw)}`, {
            credentials: "include",
          });
          if (!res.ok) return;
          const data = (await res.json()) as { message?: string };
          setOaHint(data.message ?? null);
        } catch {
          /* hint best-effort */
        }
      })();
    }, 350);
    return () => window.clearTimeout(handle);
  }, [orderRef, sector, native]);

  // Búsqueda de Pedido por N° (OP) — autocompleta Cliente/Producto/kg.
  useEffect(() => {
    if (!native || selectedPedido) return;
    const q = pedidoQuery.trim();
    if (!q) {
      const t = window.setTimeout(() => {
        setPedidoResults([]);
        setPedidoSearched(false);
        setPedidoSearchError(null);
      }, 0);
      return () => window.clearTimeout(t);
    }
    const handle = window.setTimeout(() => {
      setPedidoSearching(true);
      setPedidoSearchError(null);
      void (async () => {
        try {
          const res = await fetch(`/api/v1/production-pedidos?search=${encodeURIComponent(q)}`, {
            credentials: "include",
          });
          if (!res.ok) {
            setPedidoResults([]);
            setPedidoSearchError(
              res.status === 401
                ? "Sesión vencida. Volvé a iniciar sesión para buscar pedidos."
                : "No se pudo buscar el pedido. Reintentá."
            );
            return;
          }
          const data = (await res.json()) as { items?: ProductionPedidoRecord[] };
          setPedidoResults(Array.isArray(data.items) ? data.items.slice(0, 8) : []);
        } catch {
          setPedidoResults([]);
          setPedidoSearchError("No se pudo buscar el pedido. Revisá tu conexión y reintentá.");
        } finally {
          setPedidoSearching(false);
          setPedidoSearched(true);
        }
      })();
    }, 300);
    return () => window.clearTimeout(handle);
  }, [pedidoQuery, native, selectedPedido]);

  const selectPedido = (p: ProductionPedidoRecord) => {
    setSelectedPedido(p);
    setPedidoQuery(p.op ?? "");
    setPedidoResults([]);
    setClient(p.cliente ?? "");
    setProduct(p.producto ?? "");
    if (quantity.trim()) return;
    if (sector === "ELABORACION") {
      // kg = (q × ml) / 1000, ya calculado server-side — nunca se inventa si faltan datos.
      if (p.kg != null) setQuantity(p.kgDisplay || String(p.kg));
    } else if (p.q != null) {
      // "q" es el campo real de "Cantidad"/"Cantidad Unidades" del pedido (excel-paste.ts) —
      // para Envasado/Codificado es directamente la cantidad de unidades, sin conversión.
      setQuantity(String(p.q));
    }
  };

  const clearPedido = () => {
    setSelectedPedido(null);
    setPedidoQuery("");
    setPedidoResults([]);
    setPedidoSearched(false);
    setPedidoSearchError(null);
  };

  const unit = sector === "ELABORACION" ? "kg" : "un.";
  const lineOptions = sector === "ENVASADO_MASIVO" ? MASIVO_LINES : PREMIUM_LINES;

  const submitAssignment = async (opts?: { forceLink?: boolean }) => {
    if (inFlightRef.current || submitting) return;
    setErrorMsg(null);
    setFeedback(null);
    setOaForceConfirm(null);

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
      setErrorMsg("La asignación durable requiere planificación nativa (Neon). No se simuló el guardado.");
      return;
    }

    inFlightRef.current = true;
    setSubmitting(true);
    setFeedback("Asignando…");

    const payload = {
      sector,
      ownerPerson: sector === "ELABORACION" ? ownerPerson : null,
      line: sector === "ELABORACION" || sector === "CODIFICADO" ? null : line,
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
      productionPedidoId: selectedPedido?.id ?? null,
      idempotencyKey: idempotencyRef.current,
      forceLink: Boolean(opts?.forceLink),
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
        headers: { "content-type": "application/json", "x-genus-operation-id": operationId },
        body: JSON.stringify(payload),
      });

      let data: {
        error?: string;
        code?: string;
        ok?: boolean;
        replayed?: boolean;
        workItem?: WorkItem;
        oaCreated?: boolean;
        oaLinked?: boolean;
        order?: { orderNumber?: string };
        canForce?: boolean;
      } = {};
      try {
        data = (await res.json()) as typeof data;
      } catch {
        data = {};
      }

      if (!res.ok || !data.ok) {
        if (data.code === "OA_DATA_MISMATCH" && data.canForce !== false) {
          setFeedback(null);
          setOaForceConfirm(
            data.error ??
              "La OA ya existe con otros datos. Podés vincular igual: solo se completarán campos vacíos."
          );
          return;
        }
        const msg =
          (data.error && !/failed query|neon|vercel|sql|postgres|stack/i.test(data.error)
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
      const oaPart = data.order?.orderNumber
        ? data.oaCreated
          ? ` OA ${data.order.orderNumber} creada.`
          : data.oaLinked
            ? ` OA ${data.order.orderNumber} vinculada.`
            : ""
        : "";
      setFeedback(
        data.replayed
          ? "Asignación ya confirmada en Neon (sin duplicar)."
          : `Trabajo asignado y confirmado en Neon.${oaPart}`
      );
      if (data.workItem) onAssigned?.(data.workItem);
      window.setTimeout(() => {
        onClose();
      }, 900);
    } catch {
      setFeedback(null);
      setErrorMsg(mapUserFacingError(0, undefined, !navigator.onLine));
    } finally {
      inFlightRef.current = false;
      setSubmitting(false);
    }
  };

  return (
    <Dialog open onOpenChange={(open) => !open && !submitting && onClose()}>
      <DialogContent className="flex max-h-[85vh] w-full max-w-3xl flex-col gap-0 overflow-hidden p-0">
        <div className="shrink-0 space-y-1.5 border-b border-[var(--os-border)] px-6 py-4">
          <DialogHeader>
            <DialogTitle>Asignar trabajo — {SECTOR_LABELS[sector]}</DialogTitle>
            <DialogDescription>
              Creá y asigná un trabajo con fecha de entrega. El guardado se confirma en Neon antes de
              mostrar éxito; doble clic o reintento reutilizan la misma clave de idempotencia.
            </DialogDescription>
          </DialogHeader>
        </div>

        <form
          onSubmit={(e) => {
            e.preventDefault();
            void submitAssignment();
          }}
          className="flex min-h-0 flex-1 flex-col"
          aria-busy={submitting}
        >
        <div className="min-h-0 flex-1 overflow-y-auto px-6 py-4" data-testid="assign-scroll-area">
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <div
            className="space-y-1.5 rounded-[var(--os-radius)] border-2 border-[var(--os-teal)]/50 bg-[var(--os-teal)]/5 p-3 sm:col-span-2"
            data-testid="assign-pedido-section"
          >
            <label htmlFor="af-pedido" className="text-sm font-semibold uppercase tracking-wide text-[var(--os-text)]">
              N° de Pedido
            </label>
            {selectedPedido ? (
              <div className="flex flex-wrap items-center gap-2 rounded-[var(--os-radius-sm)] border border-[var(--os-teal)]/40 bg-[var(--os-teal)]/5 px-3 py-2 text-sm">
                <span className="font-medium">Pedido {selectedPedido.op || "—"}</span>
                <span className="text-[var(--os-text-muted)]">
                  {selectedPedido.cliente ?? "—"} · {selectedPedido.producto ?? "—"}
                  {pedidoQuantityLabel(selectedPedido, sector)
                    ? ` · ${pedidoQuantityLabel(selectedPedido, sector)}`
                    : ""}
                  {selectedPedido.estado ? ` · ${selectedPedido.estado}` : ""}
                </span>
                <button
                  type="button"
                  className="ml-auto text-xs text-[var(--os-teal)] hover:underline"
                  onClick={clearPedido}
                  disabled={submitting}
                  data-testid="assign-pedido-clear"
                >
                  Quitar pedido
                </button>
              </div>
            ) : (
              <div className="relative">
                <input
                  id="af-pedido"
                  value={pedidoQuery}
                  disabled={submitting}
                  onChange={(e) => setPedidoQuery(e.target.value)}
                  placeholder="Buscar por N° de Pedido, cliente o producto…"
                  className={CONTROL_CLASS}
                  autoComplete="off"
                  data-testid="assign-pedido-search"
                />
                {pedidoQuery.trim() && pedidoResults.length > 0 ? (
                  <ul
                    className="absolute z-10 mt-1 max-h-56 w-full overflow-y-auto rounded-[var(--os-radius-sm)] border border-[var(--os-border)] bg-[var(--os-surface)] shadow-md"
                    data-testid="assign-pedido-results"
                  >
                    {pedidoResults.map((p) => (
                      <li key={p.id}>
                        <button
                          type="button"
                          className="block w-full px-3 py-2 text-left text-sm hover:bg-[var(--os-teal)]/10"
                          onClick={() => selectPedido(p)}
                        >
                          <span className="font-medium">{p.op || "—"}</span>{" "}
                          <span className="text-[var(--os-text-muted)]">
                            {p.cliente ?? "—"} · {p.producto ?? "—"}
                            {pedidoQuantityLabel(p, sector) ? ` · ${pedidoQuantityLabel(p, sector)}` : ""}
                            {p.estado ? ` · ${p.estado}` : ""}
                          </span>
                        </button>
                      </li>
                    ))}
                  </ul>
                ) : null}
              </div>
            )}
            {pedidoSearching ? (
              <p className="text-xs text-[var(--os-text-muted)]">Buscando…</p>
            ) : pedidoSearchError ? (
              <p className="text-xs text-[var(--genus-danger,#e85d5d)]" role="alert" data-testid="assign-pedido-search-error">
                {pedidoSearchError}
              </p>
            ) : pedidoQuery.trim() && pedidoSearched && pedidoResults.length === 0 && !selectedPedido ? (
              <p className="text-xs text-[var(--os-text-muted)]" data-testid="assign-pedido-not-found">
                Pedido no encontrado. Podés completar los datos manualmente.
              </p>
            ) : (
              <p className="text-xs text-[var(--os-text-muted)]">
                Opcional — autocompleta Cliente/Producto/Cantidad
                {sector === "ELABORACION" ? " (kg)" : ""}. Todo sigue siendo editable.
              </p>
            )}
          </div>

          <div className="space-y-1.5">
            <label className="text-sm font-medium">Asignar a</label>
            <div
              className={`${CONTROL_CLASS} flex items-center bg-[var(--os-bg)] text-[var(--os-text-muted)]`}
              data-testid="assign-sector-locked"
            >
              {SECTOR_LABELS[sector]}
            </div>
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
          ) : sector === "CODIFICADO" ? null : (
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
              Cliente {selectedPedido ? <span className="text-[var(--os-teal)]">(desde pedido)</span> : null}
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
              Producto {selectedPedido ? <span className="text-[var(--os-teal)]">(desde pedido)</span> : null}
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
              {sector === "ELABORACION" ? "Número de OE" : "Número de Orden de Acondicionamiento"}
            </label>
            <input
              id="af-ref"
              value={orderRef}
              disabled={submitting}
              onChange={(e) => setOrderRef(e.target.value)}
              placeholder={sector === "ELABORACION" ? "Opcional — OE existente" : "Ej. OA-2026-000145"}
              className={CONTROL_CLASS}
              data-testid="assign-oa-number"
            />
            {isPackagingAssignSector(sector) ? (
              <p className="text-xs text-[var(--os-text-muted)]">
                Podés seleccionar una OA existente o ingresar un número nuevo. Si no existe, se creará
                automáticamente (1 trabajo = 1 OA).
              </p>
            ) : null}
            {oaHint ? (
              <p className="text-xs text-[var(--os-teal)]" data-testid="assign-oa-hint">
                {oaHint}
              </p>
            ) : null}
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

          <div className="space-y-1.5 sm:col-span-2">
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

          {oaForceConfirm ? (
            <div
              className="sm:col-span-2 w-full rounded border border-[var(--genus-warning)]/40 bg-[var(--genus-warning-soft,#fff8e6)] px-3 py-2 text-sm"
              role="alert"
              data-testid="assign-oa-force"
            >
              <p className="mb-2 text-[var(--genus-warning,#b45309)]">{oaForceConfirm}</p>
              <p className="mb-2 text-xs text-[var(--os-text-muted)]">
                Al continuar solo se completarán campos vacíos de la OA; no se sobrescriben producto,
                cliente, lote o VTO ya cargados.
              </p>
              <div className="flex flex-wrap gap-2">
                <Button
                  type="button"
                  variant="primary"
                  disabled={submitting}
                  onClick={() => void submitAssignment({ forceLink: true })}
                  data-testid="assign-oa-force-confirm"
                >
                  Vincular igual
                </Button>
                <Button type="button" variant="secondary" disabled={submitting} onClick={() => setOaForceConfirm(null)}>
                  Cancelar
                </Button>
              </div>
            </div>
          ) : null}

          {errorMsg ? (
            <div className="sm:col-span-2 flex items-center gap-3">
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
            </div>
          ) : null}

          {feedback && !errorMsg && !oaForceConfirm ? (
            <span className="sm:col-span-2 text-sm text-[var(--genus-success)]" data-testid="assign-feedback">
              {feedback}
            </span>
          ) : null}
        </div>
        </div>

          <DialogFooter className="shrink-0 border-t border-[var(--os-border)] px-6 py-4">
            <Button type="button" variant="secondary" disabled={submitting} onClick={onClose}>
              Cancelar
            </Button>
            <Button type="submit" variant="primary" disabled={submitting} data-testid="assign-submit">
              {submitting ? "Asignando…" : "Asignar trabajo"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
