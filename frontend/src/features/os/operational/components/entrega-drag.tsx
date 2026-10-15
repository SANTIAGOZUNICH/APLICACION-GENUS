"use client";

/**
 * Arrastrar y soltar en el Calendario de Entregas (solo Producción/Dirección).
 *  - Se arrastra el cliente de un día (mouse o dedo: en tablets, mantener apretado ~¼ s y arrastrar) y se suelta en otro.
 *  - Para ir a otro mes sin soltar: dejar la tarjeta sobre «‹» o «›» un instante cambia de mes.
 *  - Al soltar: confirmación con cliente, producto(s), fecha original y nueva. Si el cliente tiene varios productos ese día
 *    hay que ELEGIR cuál se mueve (nunca se mueven todos por accidente). Sin motivo. Nada se guarda hasta CONFIRMAR;
 *    CANCELAR deja todo como estaba.
 *  - Se guarda con la reprogramación que ya existe: producto de una entrega programada → «move_item» (si es el único
 *    producto, reprograma la entrega); entrega «Desde trabajo» → fecha de entrega del trabajo. No crea registros ni toca
 *    entregas reales, stock ni cantidades; queda auditado (usuario, fecha y hora, fecha anterior y nueva).
 */
import { useRef, useState, type HTMLAttributes, type ReactNode } from "react";
import { useDraggable, useDroppable } from "@dnd-kit/core";
import { Button } from "@/components/ui/button";
import { shortDateLabel } from "@/lib/entregas/calendar";
import { entregasApi } from "@/lib/entregas/entregas-client";
import { itemQuantities } from "@/lib/entregas/rules";
import { isDerivedDelivery, type ScheduledDelivery } from "@/lib/entregas/types";
import { friendlySaveError } from "@/lib/ui/friendly-error";

export interface MoveOption {
  key: string;
  product: string;
  detail: string;
  kind: "programada" | "trabajo";
  deliveryId: string;
  itemId: string;
  version: number;
  workItemId: string | null;
}

/** Productos de un cliente en un día que se pueden mover (pendientes; no cancelados ni quitados). */
export function moveOptions(deliveries: ScheduledDelivery[]): MoveOption[] {
  const out: MoveOption[] = [];
  for (const d of deliveries) {
    if (d.state === "cancelada") continue;
    const derived = isDerivedDelivery(d);
    if (derived && d.origin !== "desde_trabajo") continue;
    for (const it of d.items) {
      if (it.status === "entregada" || it.hidden) continue;
      const q = itemQuantities(it);
      const qty = q.pending != null ? `${q.pending.toLocaleString("es-AR")}${it.unit ? ` ${it.unit}` : ""}${q.delivered ? " pendientes" : ""}` : it.quantity ?? "";
      const workItemId = derived ? (it.works[0]?.workItemId ?? null) : null;
      if (derived && !workItemId) continue;
      out.push({ key: `${d.id}:${it.id}`, product: it.product, detail: qty, kind: derived ? "trabajo" : "programada", deliveryId: d.id, itemId: it.id, version: d.version, workItemId });
    }
  }
  return out;
}

export const dragChipId = (date: string, client: string) => `chip|${date}|${client}`;
export const parseDragChipId = (id: string): { date: string; client: string } | null => {
  const [p, date, ...rest] = id.split("|");
  return p === "chip" && date ? { date, client: rest.join("|") } : null;
};

/** Envoltorio arrastrable del cliente (no cambia su aspecto; el clic sigue abriendo el detalle). */
export function DraggableChip({ id, disabled, children }: { id: string; disabled: boolean; children: ReactNode }) {
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({ id, disabled });
  return (
    <div
      ref={setNodeRef}
      {...(disabled ? {} : { ...attributes, ...listeners })}
      className={`max-w-full ${disabled ? "" : "cursor-grab active:cursor-grabbing [touch-action:manipulation]"} ${isDragging ? "opacity-40" : ""}`}
      data-testid={disabled ? undefined : "entregas-drag"}
    >
      {children}
    </div>
  );
}

/** Celda del día como destino de soltado. */
export function DropDay({ iso, enabled, children, className, ...rest }: { iso: string; enabled: boolean; children: ReactNode; className: string } & Omit<HTMLAttributes<HTMLDivElement>, "className" | "children"> & Record<`data-${string}`, string | undefined>) {
  const { setNodeRef, isOver } = useDroppable({ id: `day|${iso}`, disabled: !enabled });
  return (
    <div ref={setNodeRef} className={`${className} ${enabled && isOver ? "bg-[var(--os-teal)]/15 ring-2 ring-inset ring-[var(--os-teal)]" : ""}`} {...rest}>
      {children}
    </div>
  );
}

/** Botón de mes: resaltado mientras se mantiene la tarjeta encima (el padre cambia de mes tras un instante). */
export function DropMonthNav({ id, active, children }: { id: "nav|prev" | "nav|next"; active: boolean; children: ReactNode }) {
  return (
    <span className={`inline-flex rounded-md ${active ? "ring-2 ring-[var(--os-teal)]" : ""}`} data-testid={`entregas-drop-${id.slice(4)}`} data-active={active ? "1" : undefined}>
      {children}
    </span>
  );
}

export interface PendingDrop {
  client: string;
  from: string;
  to: string;
  options: MoveOption[];
}

export function EntregaMoveDialog({ pending, onClose, onSaved }: { pending: PendingDrop; onClose: () => void; onSaved: (to: string) => Promise<void> }) {
  const [selected, setSelected] = useState<string | null>(pending.options.length === 1 ? pending.options[0]!.key : null);
  const [to, setTo] = useState(pending.to);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const inFlight = useRef(false);
  const choice = pending.options.find((o) => o.key === selected) ?? null;
  const valid = Boolean(choice) && /^\d{4}-\d{2}-\d{2}$/.test(to) && to !== pending.from;

  const confirm = async () => {
    if (!choice || !valid || inFlight.current) return;
    inFlight.current = true;
    setBusy(true);
    setError(null);
    try {
      if (choice.kind === "trabajo") await entregasApi.work(choice.workItemId!, { action: "edit", deliveryDate: to });
      else await entregasApi.patch(choice.deliveryId, { action: "move_item", itemId: choice.itemId, newDate: to, expectedVersion: choice.version });
      await onSaved(to);
      onClose();
    } catch (e) {
      setError(friendlySaveError(e, "No se pudo reprogramar la entrega."));
    } finally {
      inFlight.current = false;
      setBusy(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/50 p-4 sm:items-center" role="presentation" onClick={() => !busy && onClose()}>
      <div role="dialog" aria-modal="true" aria-label="Reprogramar entrega" className="w-full max-w-md space-y-3 rounded-xl border border-[var(--os-border)] bg-[var(--os-surface)] p-4 shadow-xl" onClick={(e) => e.stopPropagation()} data-testid="entregas-move">
        <div>
          <p className="text-xs uppercase tracking-wide text-[var(--os-text-muted)]">Reprogramar entrega</p>
          <p className="text-base font-semibold text-[var(--os-text)]" data-testid="entregas-move-client">{pending.client}</p>
        </div>
        <div className="grid grid-cols-2 gap-2 text-sm">
          <div>
            <p className="text-xs text-[var(--os-text-muted)]">Fecha original</p>
            <p className="font-semibold text-[var(--os-text)]" data-testid="entregas-move-from">{shortDateLabel(pending.from)}</p>
          </div>
          <label className="block">
            <span className="text-xs text-[var(--os-text-muted)]">Nueva fecha</span>
            <input type="date" value={to} onChange={(e) => setTo(e.target.value)} className="w-full rounded border border-[var(--os-border)] bg-[var(--os-bg)] px-2 py-1 text-sm text-[var(--os-text)] [color-scheme:dark]" data-testid="entregas-move-to" />
          </label>
        </div>
        <fieldset className="space-y-1.5">
          <legend className="mb-1 text-xs text-[var(--os-text-muted)]">
            {pending.options.length > 1 ? "Elegí qué producto se mueve (los demás quedan en su fecha):" : "Producto:"}
          </legend>
          {pending.options.map((o) => (
            <label key={o.key} className={`flex cursor-pointer items-center gap-2 rounded-md border px-2.5 py-2 text-sm ${selected === o.key ? "border-[var(--os-teal)] bg-[var(--os-teal)]/10" : "border-[var(--os-border)]"}`} data-testid="entregas-move-option" data-product={o.product}>
              <input type="radio" name="entregas-move-product" checked={selected === o.key} onChange={() => setSelected(o.key)} className="size-4 accent-[var(--os-teal)]" />
              <span className="min-w-0 flex-1">
                <span className="block truncate font-semibold text-[var(--os-text)]">{o.product}</span>
                <span className="text-xs text-[var(--os-text-muted)]">{o.detail}</span>
              </span>
            </label>
          ))}
        </fieldset>
        {error && <p role="alert" className="text-xs text-[var(--genus-error,#e85d5d)]" data-testid="entregas-move-error">No se guardó: {error}</p>}
        <div className="flex gap-2">
          <Button type="button" onClick={() => void confirm()} disabled={!valid || busy} className="flex-1" data-testid="entregas-move-confirm">
            {busy ? "Guardando…" : "CONFIRMAR"}
          </Button>
          <Button type="button" variant="secondary" onClick={onClose} disabled={busy} className="flex-1" data-testid="entregas-move-cancel">
            CANCELAR
          </Button>
        </div>
      </div>
    </div>
  );
}
