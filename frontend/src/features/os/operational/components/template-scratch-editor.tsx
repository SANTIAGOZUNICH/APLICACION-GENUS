"use client";

import { useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  createEmptyOaContent,
  createEmptyOeContent,
  emptyOaMaterial,
  emptyOeMaterial,
  normalizeOrderContent,
  recomputeOaDerived,
  recomputeOeDerived,
} from "@/lib/orders/content";
import {
  createOrderFromScratchApi,
  createTemplateApi,
  type OrdersClientSession,
} from "@/lib/orders/orders-client";
import type { OrderContent, OrderDocType, OrderTemplateRecord } from "@/lib/orders/types";
import type { SectorId } from "@/types/operational/sector";
import { OeFormSections } from "./oe-form-sections";
import { OaFormSections, renumberOaMaterials } from "./oa-form-sections";

interface TemplateScratchEditorProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  type: OrderDocType;
  session: OrdersClientSession;
  dbUnavailable: boolean;
  defaultSector: SectorId;
  mode: "template" | "order";
  onSaved: (result: {
    template?: OrderTemplateRecord | null;
    orderId?: string;
  }) => void;
}

export function TemplateScratchEditor({
  open,
  onOpenChange,
  type,
  session,
  dbUnavailable,
  defaultSector,
  mode,
  onSaved,
}: TemplateScratchEditorProps) {
  const empty = useMemo(
    () =>
      type === "OE"
        ? createEmptyOeContent()
        : createEmptyOaContent(),
    [type]
  );
  const [content, setContent] = useState<OrderContent>(empty);
  const [productName, setProductName] = useState("");
  const [productCode, setProductCode] = useState("");
  const [brandClient, setBrandClient] = useState("");
  const [lot, setLot] = useState("");
  const [assignedSector, setAssignedSector] = useState<SectorId>(defaultSector);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [askOrderSave, setAskOrderSave] = useState(false);

  const reset = () => {
    setContent(type === "OE" ? createEmptyOeContent() : createEmptyOaContent());
    setProductName("");
    setProductCode("");
    setBrandClient("");
    setLot("");
    setAssignedSector(defaultSector);
    setError(null);
    setAskOrderSave(false);
  };

  const syncHeader = (name: string, code: string, client: string) => {
    setContent((prev) => {
      if (prev.kind === "OE") {
        return recomputeOeDerived({
          ...prev,
          header: { ...prev.header, productName: name, code, client },
        });
      }
      return recomputeOaDerived({
        ...prev,
        header: { ...prev.header, productName: name, productCode: code, client },
      });
    });
  };

  const saveAsMaster = async () => {
    if (dbUnavailable) {
      setError("La base de datos no está configurada. No se puede guardar la plantilla.");
      return;
    }
    if (!productName.trim() || !productCode.trim()) {
      setError("Completá producto y código.");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const withHeader =
        content.kind === "OE"
          ? recomputeOeDerived({
              ...content,
              header: {
                ...content.header,
                productName,
                code: productCode,
                client: brandClient,
              },
            })
          : recomputeOaDerived({
              ...content,
              header: {
                ...content.header,
                productName,
                productCode,
                client: brandClient,
              },
            });
      const template = await createTemplateApi(session, {
        type,
        productName,
        productCode,
        brandClient: brandClient || null,
        content: normalizeOrderContent(withHeader),
        changeReason: "Plantilla maestra creada desde cero",
      });
      onSaved({ template });
      onOpenChange(false);
      reset();
    } catch (err) {
      setError(err instanceof Error ? err.message : "No se pudo guardar.");
    } finally {
      setBusy(false);
    }
  };

  const saveOrder = async (alsoCreateMaster: boolean) => {
    if (dbUnavailable) {
      setError("La base de datos no está configurada. No se puede crear la orden.");
      return;
    }
    if (!productName.trim() || !productCode.trim() || !brandClient.trim() || !lot.trim()) {
      setError("Completá producto, código, cliente y lote.");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const withHeader =
        content.kind === "OE"
          ? recomputeOeDerived({
              ...content,
              header: {
                ...content.header,
                productName,
                code: productCode,
                client: brandClient,
                lot,
              },
            })
          : recomputeOaDerived({
              ...content,
              header: {
                ...content.header,
                productName,
                productCode,
                client: brandClient,
                lot,
              },
            });
      const result = await createOrderFromScratchApi(session, {
        type,
        product: productName,
        code: productCode,
        client: brandClient,
        lot,
        assignedSector: type === "OE" ? "ELABORACION" : assignedSector,
        content: normalizeOrderContent(withHeader),
        alsoCreateMaster,
        masterChangeReason: alsoCreateMaster
          ? "Plantilla maestra creada junto con la orden inicial"
          : undefined,
      });
      onSaved({ template: result.template, orderId: result.order.id });
      onOpenChange(false);
      reset();
    } catch (err) {
      setError(err instanceof Error ? err.message : "No se pudo crear la orden.");
    } finally {
      setBusy(false);
      setAskOrderSave(false);
    }
  };

  return (
    <>
      <Dialog
        open={open}
        onOpenChange={(v) => {
          if (!v) reset();
          onOpenChange(v);
        }}
      >
        <DialogContent className="max-h-[92vh] max-w-4xl overflow-y-auto">
          <DialogHeader>
            <DialogTitle>
              {mode === "template"
                ? `Nueva plantilla ${type} desde cero`
                : `Crear ${type} desde cero`}
            </DialogTitle>
            <DialogDescription>
              Estructura legal completa con campos operativos vacíos. No requiere seleccionar una
              plantilla maestra previa.
            </DialogDescription>
          </DialogHeader>

          {dbUnavailable && (
            <p className="rounded border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-950">
              La base de datos no está configurada. Podés recorrer el formulario, pero no guardar.
            </p>
          )}

          <div className="grid gap-2 sm:grid-cols-3 text-sm">
            <label className="space-y-1">
              <span className="text-xs text-[var(--os-text-muted)]">Producto</span>
              <input
                className="w-full rounded border px-3 py-2"
                value={productName}
                data-testid="scratch-product"
                onChange={(e) => {
                  setProductName(e.target.value);
                  syncHeader(e.target.value, productCode, brandClient);
                }}
              />
            </label>
            <label className="space-y-1">
              <span className="text-xs text-[var(--os-text-muted)]">Código</span>
              <input
                className="w-full rounded border px-3 py-2"
                value={productCode}
                data-testid="scratch-code"
                onChange={(e) => {
                  setProductCode(e.target.value);
                  syncHeader(productName, e.target.value, brandClient);
                }}
              />
            </label>
            <label className="space-y-1">
              <span className="text-xs text-[var(--os-text-muted)]">Cliente / marca</span>
              <input
                className="w-full rounded border px-3 py-2"
                value={brandClient}
                data-testid="scratch-client"
                onChange={(e) => {
                  setBrandClient(e.target.value);
                  syncHeader(productName, productCode, e.target.value);
                }}
              />
            </label>
            {mode === "order" && (
              <>
                <label className="space-y-1">
                  <span className="text-xs text-[var(--os-text-muted)]">Lote</span>
                  <input
                    className="w-full rounded border px-3 py-2"
                    value={lot}
                    data-testid="scratch-lot"
                    onChange={(e) => setLot(e.target.value)}
                  />
                </label>
                {type === "OA" && (
                  <label className="space-y-1">
                    <span className="text-xs text-[var(--os-text-muted)]">Sector</span>
                    <select
                      className="w-full rounded border px-3 py-2"
                      value={assignedSector}
                      onChange={(e) => setAssignedSector(e.target.value as SectorId)}
                    >
                      <option value="ENVASADO_MASIVO">Envasado Masivo</option>
                      <option value="ENVASADO_PREMIUM">Envasado Premium</option>
                    </select>
                  </label>
                )}
              </>
            )}
          </div>

          {content.kind === "OE" ? (
            <OeFormSections
              content={content}
              fieldMode={{ canEditFormula: true, canEditOperational: true }}
              onChange={(next) => setContent(recomputeOeDerived(next))}
              onAddMaterial={() =>
                setContent((prev) =>
                  prev.kind === "OE"
                    ? { ...prev, materials: [...prev.materials, emptyOeMaterial()] }
                    : prev
                )
              }
              onRemoveMaterial={(id) =>
                setContent((prev) =>
                  prev.kind === "OE"
                    ? { ...prev, materials: prev.materials.filter((m) => m.id !== id) }
                    : prev
                )
              }
            />
          ) : (
            <OaFormSections
              content={content}
              readOnly={false}
              onChange={(next) => setContent(recomputeOaDerived(next))}
              onAddMaterial={() =>
                setContent((prev) => {
                  if (prev.kind !== "OA") return prev;
                  return {
                    ...prev,
                    materials: [...prev.materials, emptyOaMaterial(prev.materials.length + 1)],
                  };
                })
              }
              onRemoveMaterial={(id) =>
                setContent((prev) => {
                  if (prev.kind !== "OA") return prev;
                  return renumberOaMaterials({
                    ...prev,
                    materials: prev.materials.filter((m) => m.id !== id),
                  });
                })
              }
            />
          )}

          {error && <p className="text-sm text-rose-700">{error}</p>}

          <DialogFooter className="flex-wrap gap-2">
            <Button type="button" variant="secondary" onClick={() => onOpenChange(false)}>
              Cancelar
            </Button>
            {mode === "template" ? (
              <Button
                type="button"
                disabled={busy || dbUnavailable}
                data-testid="scratch-save-master"
                onClick={() => void saveAsMaster()}
              >
                Guardar como plantilla maestra
              </Button>
            ) : (
              <Button
                type="button"
                disabled={busy || dbUnavailable}
                data-testid="scratch-save-order"
                onClick={() => setAskOrderSave(true)}
              >
                Guardar orden…
              </Button>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={askOrderSave} onOpenChange={setAskOrderSave}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>¿Cómo querés guardar?</DialogTitle>
            <DialogDescription>
              ¿Querés guardar solamente esta orden o también crear una plantilla maestra para
              futuras órdenes?
            </DialogDescription>
          </DialogHeader>
          <DialogFooter className="flex-col gap-2 sm:flex-row">
            <Button type="button" variant="secondary" onClick={() => setAskOrderSave(false)}>
              Cancelar
            </Button>
            <Button
              type="button"
              variant="secondary"
              data-testid="scratch-order-only"
              onClick={() => void saveOrder(false)}
            >
              Guardar solo esta orden
            </Button>
            <Button
              type="button"
              data-testid="scratch-order-and-master"
              onClick={() => void saveOrder(true)}
            >
              Guardar orden y crear plantilla maestra
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
