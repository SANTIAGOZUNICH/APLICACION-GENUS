"use client";

import { useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import type {
  CreateOrderInput,
  OrderDocType,
  OrderTemplateRecord,
} from "@/lib/orders/types";
import type { SectorId } from "@/types/operational/sector";

interface CreateOrderDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  type: OrderDocType;
  templates: OrderTemplateRecord[];
  defaultSector: SectorId;
  onCreate: (input: CreateOrderInput) => Promise<void>;
}

export function CreateOrderDialog({
  open,
  onOpenChange,
  type,
  templates,
  defaultSector,
  onCreate,
}: CreateOrderDialogProps) {
  const [templateId, setTemplateId] = useState(templates[0]?.id ?? "");
  const [lot, setLot] = useState("");
  const [client, setClient] = useState("");
  const [code, setCode] = useState("");
  const [product, setProduct] = useState("");
  const [assignedSector, setAssignedSector] = useState<SectorId>(defaultSector);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const selected = templates.find((t) => t.id === templateId) ?? templates[0];

  const submit = async () => {
    const tid = templateId || templates[0]?.id;
    if (!tid) {
      setError("Seleccioná una plantilla maestra de producto.");
      return;
    }
    setSaving(true);
    setError(null);
    try {
      await onCreate({
        type,
        templateId: tid,
        product: product || selected?.productName,
        client: client || selected?.brandClient || undefined,
        code: code || selected?.productCode,
        lot: lot || undefined,
        assignedSector: type === "OE" ? "ELABORACION" : assignedSector,
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : "No se pudo crear la orden.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>
            {type === "OE" ? "Crear Orden de Elaboración" : "Crear Orden de Acondicionamiento"}
          </DialogTitle>
          <DialogDescription>
            Se crea una copia (snapshot) de la plantilla maestra vigente. Las órdenes anteriores no
            cambian si luego se actualiza la maestra.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3 text-sm">
          <label className="block space-y-1">
            <span className="text-xs text-[var(--os-text-muted)]">Plantilla maestra / producto</span>
            <select
              value={templateId || templates[0]?.id || ""}
              onChange={(e) => {
                setTemplateId(e.target.value);
                const t = templates.find((x) => x.id === e.target.value);
                if (t) {
                  setProduct(t.productName);
                  setCode(t.productCode);
                  setClient(t.brandClient ?? "");
                }
              }}
              className="w-full rounded border border-[var(--os-border)] bg-[var(--os-surface)] px-3 py-2"
            >
              {templates.length === 0 && <option value="">Sin plantillas</option>}
              {templates.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.productName} · {t.productCode} · v{t.version}
                  {t.brandClient ? ` · ${t.brandClient}` : ""}
                </option>
              ))}
            </select>
          </label>
          <div className="grid grid-cols-2 gap-2">
            <label className="space-y-1">
              <span className="text-xs text-[var(--os-text-muted)]">Producto</span>
              <input
                value={product}
                onChange={(e) => setProduct(e.target.value)}
                className="w-full rounded border px-3 py-2"
              />
            </label>
            <label className="space-y-1">
              <span className="text-xs text-[var(--os-text-muted)]">Código</span>
              <input
                value={code}
                onChange={(e) => setCode(e.target.value)}
                className="w-full rounded border px-3 py-2"
              />
            </label>
            <label className="space-y-1">
              <span className="text-xs text-[var(--os-text-muted)]">Cliente</span>
              <input
                value={client}
                onChange={(e) => setClient(e.target.value)}
                className="w-full rounded border px-3 py-2"
              />
            </label>
            <label className="space-y-1">
              <span className="text-xs text-[var(--os-text-muted)]">Lote</span>
              <input
                value={lot}
                onChange={(e) => setLot(e.target.value)}
                className="w-full rounded border px-3 py-2"
              />
            </label>
          </div>
          {type === "OA" && (
            <label className="block space-y-1">
              <span className="text-xs text-[var(--os-text-muted)]">Sector asignado</span>
              <select
                value={assignedSector}
                onChange={(e) => setAssignedSector(e.target.value as SectorId)}
                className="w-full rounded border px-3 py-2"
              >
                <option value="ENVASADO_MASIVO">Envasado Masivo</option>
                <option value="ENVASADO_PREMIUM">Envasado Premium</option>
              </select>
            </label>
          )}
          {error && <p className="text-sm text-rose-700">{error}</p>}
        </div>

        <DialogFooter>
          <Button type="button" variant="secondary" onClick={() => onOpenChange(false)}>
            Cancelar
          </Button>
          <Button type="button" onClick={() => void submit()} disabled={saving || templates.length === 0}>
            {saving ? "Creando…" : "Crear orden"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
