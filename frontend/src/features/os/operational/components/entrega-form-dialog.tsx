"use client";

/**
 * Entregas — alta y edición de una entrega programada (Producción/Dirección).
 * Varios productos por entrega. Lo que todavía no se conoce queda PENDIENTE (vacío): nada se inventa ni se pre-llena.
 * En edición la fecha no se cambia acá: se usa «Reprogramar» (con motivo, queda en el historial).
 */
import { useMemo, useState } from "react";
import { Plus, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { entregasApi } from "@/lib/entregas/entregas-client";
import { validateDeliveryInput, type DeliveryItemInput } from "@/lib/entregas/rules";
import { DELIVERY_SECTOR_LABEL, DELIVERY_SECTORS, type ScheduledDelivery } from "@/lib/entregas/types";
import { friendlySaveError } from "@/lib/ui/friendly-error";

const CONTROL = "w-full rounded-[var(--os-radius-sm)] border border-[var(--os-border)] bg-[var(--ig-control-bg,var(--os-surface))] px-2.5 py-1.5 text-sm text-[var(--ig-control-fg,var(--os-text))]";
const LABEL = "text-xs font-medium text-[var(--os-text-muted)]";

interface ItemDraft extends DeliveryItemInput {
  key: string;
}

let seq = 0;
const newKey = () => `k${(seq += 1)}`;
const blankItem = (): ItemDraft => ({ key: newKey(), product: "", quantity: "", unit: "", sector: "", plannedProductionDate: "", lot: "", vto: "", notes: "" });

export interface EntregaFormDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Entrega a modificar (si falta, es una nueva). */
  initial?: ScheduledDelivery | null;
  /** Fecha sugerida para una entrega nueva (el día seleccionado en el calendario). */
  defaultDate?: string;
  /** Clientes ya cargados (sugerencias de escritura). */
  clients?: string[];
  onSaved: (delivery: ScheduledDelivery) => void | Promise<void>;
}

export function EntregaFormDialog({ open, onOpenChange, initial, defaultDate, clients = [], onSaved }: EntregaFormDialogProps) {
  // El padre monta el diálogo solo mientras está abierto (estado limpio en cada apertura).
  const [client, setClient] = useState(initial?.client ?? "");
  const [deliveryDate, setDeliveryDate] = useState(initial?.deliveryDate ?? defaultDate ?? "");
  const [responsible, setResponsible] = useState(initial?.responsible ?? "");
  const [notes, setNotes] = useState(initial?.notes ?? "");
  const [items, setItems] = useState<ItemDraft[]>(
    initial?.items.length
      ? initial.items.map((i) => ({
          key: newKey(),
          id: i.id,
          product: i.product,
          quantity: i.quantity ?? "",
          unit: i.unit ?? "",
          sector: i.sector ?? "",
          plannedProductionDate: i.plannedProductionDate ?? "",
          lot: i.lot ?? "",
          vto: i.vto ?? "",
          notes: i.notes ?? "",
        }))
      : [blankItem()]
  );
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const editing = Boolean(initial);
  const clientList = useMemo(() => [...new Set(clients)].sort((a, b) => a.localeCompare(b, "es")), [clients]);

  const patchItem = (key: string, patch: Partial<ItemDraft>) => setItems((prev) => prev.map((i) => (i.key === key ? { ...i, ...patch } : i)));

  async function save() {
    if (busy) return;
    setError(null);
    const input = { client, deliveryDate, responsible, notes, items: items.map((i) => ({ id: i.id, product: i.product, quantity: i.quantity, unit: i.unit, sector: i.sector, plannedProductionDate: i.plannedProductionDate, lot: i.lot, vto: i.vto, notes: i.notes })) };
    const v = validateDeliveryInput(input);
    if (!v.ok) {
      setError(v.message);
      return;
    }
    setBusy(true);
    try {
      const saved = initial
        ? (await entregasApi.patch(initial.id, { action: "update", expectedVersion: initial.version, input })).delivery
        : await entregasApi.create(input);
      await onSaved(saved);
      onOpenChange(false);
    } catch (e) {
      setError(friendlySaveError(e, "No se pudo guardar la entrega."));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={(v) => !busy && onOpenChange(v)}>
      <DialogContent className="flex max-h-[94vh] w-[min(96vw,820px)] max-w-[96vw] flex-col gap-0 overflow-hidden p-0" data-testid="entrega-form">
        <div className="shrink-0 border-b border-[var(--os-border)] px-5 py-3">
          <DialogHeader className="space-y-1 pr-8">
            <DialogTitle>{editing ? "Modificar entrega" : "Nueva entrega"}</DialogTitle>
            <DialogDescription>
              Lo que todavía no se conoce (cantidad, lote, vencimiento, sector, fecha de producción) podés dejarlo vacío: queda pendiente.
              {editing ? " Para cambiar la fecha usá «Reprogramar»." : ""}
            </DialogDescription>
          </DialogHeader>
        </div>
        <div className="min-h-0 flex-1 space-y-4 overflow-y-auto px-5 py-4">
          <div className="grid gap-3 sm:grid-cols-2">
            <label className="space-y-1">
              <span className={LABEL}>Cliente *</span>
              <input value={client} onChange={(e) => setClient(e.target.value)} list="entregas-clientes" className={CONTROL} data-testid="entrega-client" autoComplete="off" />
              <datalist id="entregas-clientes">
                {clientList.map((c) => (
                  <option key={c} value={c} />
                ))}
              </datalist>
            </label>
            <label className="space-y-1">
              <span className={LABEL}>Fecha de entrega *</span>
              <input type="date" value={deliveryDate} onChange={(e) => setDeliveryDate(e.target.value)} disabled={editing} className={CONTROL} data-testid="entrega-date" />
            </label>
            <label className="space-y-1">
              <span className={LABEL}>Responsable (opcional)</span>
              <input value={responsible} onChange={(e) => setResponsible(e.target.value)} className={CONTROL} data-testid="entrega-responsible" />
            </label>
            <label className="space-y-1">
              <span className={LABEL}>Observaciones (opcional)</span>
              <input value={notes} onChange={(e) => setNotes(e.target.value)} className={CONTROL} data-testid="entrega-notes" />
            </label>
          </div>

          <div className="space-y-3">
            <h4 className="text-sm font-semibold">Productos</h4>
            {items.map((it, idx) => (
              <fieldset key={it.key} className="space-y-2 rounded-[var(--os-radius-sm)] border border-[var(--os-border)] p-3" data-testid="entrega-item">
                <div className="flex items-center justify-between gap-2">
                  <legend className="px-1 text-xs font-semibold text-[var(--os-text-muted)]">Producto {idx + 1}</legend>
                  {items.length > 1 && (
                    <button type="button" onClick={() => setItems((prev) => prev.filter((i) => i.key !== it.key))} className="inline-flex items-center gap-1 text-xs text-[var(--genus-error,#e85d5d)] hover:underline" aria-label={`Quitar producto ${idx + 1}`} data-testid="entrega-item-remove">
                      <Trash2 className="size-3.5" aria-hidden="true" /> Quitar
                    </button>
                  )}
                </div>
                <div className="grid gap-2 sm:grid-cols-3">
                  <label className="space-y-1 sm:col-span-3">
                    <span className={LABEL}>Producto *</span>
                    <input value={it.product} onChange={(e) => patchItem(it.key, { product: e.target.value })} className={CONTROL} data-testid="entrega-item-product" />
                  </label>
                  <label className="space-y-1">
                    <span className={LABEL}>Cantidad</span>
                    <input value={it.quantity ?? ""} onChange={(e) => patchItem(it.key, { quantity: e.target.value })} inputMode="decimal" placeholder="Pendiente" className={CONTROL} data-testid="entrega-item-quantity" />
                  </label>
                  <label className="space-y-1">
                    <span className={LABEL}>Unidad</span>
                    <input value={it.unit ?? ""} onChange={(e) => patchItem(it.key, { unit: e.target.value })} placeholder="un. / kg…" className={CONTROL} data-testid="entrega-item-unit" />
                  </label>
                  <label className="space-y-1">
                    <span className={LABEL}>Sector</span>
                    <select value={it.sector ?? ""} onChange={(e) => patchItem(it.key, { sector: e.target.value })} className={CONTROL} data-testid="entrega-item-sector">
                      <option value="">Sin definir</option>
                      {DELIVERY_SECTORS.map((s) => (
                        <option key={s} value={s}>
                          {DELIVERY_SECTOR_LABEL[s]}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label className="space-y-1">
                    <span className={LABEL}>Fecha estimada de producción</span>
                    <input type="date" value={it.plannedProductionDate ?? ""} onChange={(e) => patchItem(it.key, { plannedProductionDate: e.target.value })} className={CONTROL} data-testid="entrega-item-prod-date" />
                  </label>
                  <label className="space-y-1">
                    <span className={LABEL}>Lote de fabricación</span>
                    <input value={it.lot ?? ""} onChange={(e) => patchItem(it.key, { lot: e.target.value })} placeholder="Pendiente" className={CONTROL} data-testid="entrega-item-lot" />
                  </label>
                  <label className="space-y-1">
                    <span className={LABEL}>Vencimiento</span>
                    <input value={it.vto ?? ""} onChange={(e) => patchItem(it.key, { vto: e.target.value })} placeholder="Pendiente" className={CONTROL} data-testid="entrega-item-vto" />
                  </label>
                  <label className="space-y-1 sm:col-span-3">
                    <span className={LABEL}>Observaciones del producto</span>
                    <input value={it.notes ?? ""} onChange={(e) => patchItem(it.key, { notes: e.target.value })} className={CONTROL} data-testid="entrega-item-notes" />
                  </label>
                </div>
              </fieldset>
            ))}
            <Button type="button" variant="secondary" size="sm" onClick={() => setItems((prev) => [...prev, blankItem()])} data-testid="entrega-add-item">
              <Plus className="mr-1 size-4" aria-hidden="true" /> Agregar producto
            </Button>
          </div>
          {error && (
            <p role="alert" className="text-sm text-[var(--genus-error,#e85d5d)]" data-testid="entrega-form-error">
              {error}
            </p>
          )}
        </div>
        <DialogFooter className="shrink-0 gap-2 border-t border-[var(--os-border)] px-5 py-3">
          <Button type="button" variant="secondary" disabled={busy} onClick={() => onOpenChange(false)}>
            Cancelar
          </Button>
          <Button type="button" disabled={busy} onClick={() => void save()} data-testid="entrega-save">
            {busy ? "Guardando…" : editing ? "Guardar cambios" : "Crear entrega"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
