"use client";

import { useEffect, useMemo, useState } from "react";
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
import {
  emptyTemplatesExplanation,
  validateCreateOrderForm,
} from "../lib/create-order-validation";
import { LegalOrderPreview } from "./legal-order-preview";

interface CreateOrderDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  type: OrderDocType;
  templates: OrderTemplateRecord[];
  builtinTemplates?: OrderTemplateRecord[];
  defaultSector: SectorId;
  dbUnavailable?: boolean;
  canManageTemplates?: boolean;
  onCreate: (input: CreateOrderInput) => Promise<void>;
  onCreateTemplate?: () => void;
  onImportTemplate?: () => void;
  onPreviewTemplate?: (template: OrderTemplateRecord) => void;
}

export function CreateOrderDialog({
  open,
  onOpenChange,
  type,
  templates,
  builtinTemplates = [],
  defaultSector,
  dbUnavailable = false,
  canManageTemplates = false,
  onCreate,
  onCreateTemplate,
  onImportTemplate,
  onPreviewTemplate,
}: CreateOrderDialogProps) {
  const [templateId, setTemplateId] = useState("");
  const [lot, setLot] = useState("");
  const [client, setClient] = useState("");
  const [code, setCode] = useState("");
  const [product, setProduct] = useState("");
  const [assignedSector, setAssignedSector] = useState<SectorId>(defaultSector);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [previewOpen, setPreviewOpen] = useState(false);

  useEffect(() => {
    if (!open) return;
    const first = templates[0];
    setTemplateId(first?.id ?? "");
    setProduct(first?.productName ?? "");
    setCode(first?.productCode ?? "");
    setClient(first?.brandClient ?? "");
    setLot("");
    setAssignedSector(defaultSector);
    setError(null);
  }, [open, templates, defaultSector]);

  const selected = templates.find((t) => t.id === templateId) ?? templates[0];
  const previewModel =
    selected ??
    builtinTemplates.find((t) => t.type === type) ??
    builtinTemplates[0] ??
    null;

  const validation = useMemo(
    () =>
      validateCreateOrderForm(type, {
        templateId: templateId || selected?.id || "",
        product,
        code,
        client,
        lot,
        assignedSector,
        templatesCount: templates.length,
        dbUnavailable,
      }),
    [
      type,
      templateId,
      selected?.id,
      product,
      code,
      client,
      lot,
      assignedSector,
      templates.length,
      dbUnavailable,
    ]
  );

  const submit = async () => {
    if (!validation.ok) {
      setError(validation.disableReasons.join(" · "));
      return;
    }
    const tid = templateId || templates[0]?.id;
    if (!tid) return;
    setSaving(true);
    setError(null);
    try {
      await onCreate({
        type,
        templateId: tid,
        product: product.trim(),
        client: client.trim(),
        code: code.trim(),
        lot: lot.trim(),
        assignedSector: type === "OE" ? "ELABORACION" : assignedSector,
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : "No se pudo crear la orden.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <>
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>
              {type === "OE"
                ? "Crear Orden de Elaboración"
                : "Crear Orden de Acondicionamiento"}
            </DialogTitle>
          <DialogDescription>
            Se crea una copia (snapshot) de la plantilla maestra vigente. También podés crear una
            orden nueva desde cero sin elegir maestra.
          </DialogDescription>
        </DialogHeader>

        <div className="flex flex-wrap gap-2">
          <Button
            type="button"
            size="sm"
            variant={templates.length > 0 ? "secondary" : "primary"}
            data-testid="create-mode-master"
            onClick={() => {/* default master mode */}}
          >
            Usar una plantilla maestra
          </Button>
          <Button
            type="button"
            size="sm"
            variant="secondary"
            data-testid="create-mode-scratch"
            onClick={() => {
              onOpenChange(false);
              onCreateTemplate?.();
            }}
          >
            Crear una orden nueva desde cero
          </Button>
        </div>

          {dbUnavailable && (
            <div
              className="rounded border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-950"
              data-testid="create-order-db-banner"
            >
              La base de datos no está configurada. Podés ver la plantilla, pero no crear ni guardar
              órdenes todavía.
            </div>
          )}

          {templates.length === 0 && (
            <div
              className="space-y-3 rounded border border-amber-300 bg-amber-50 px-3 py-3 text-sm text-amber-950"
              data-testid="create-order-no-templates"
            >
              <p>{emptyTemplatesExplanation()}</p>
              {canManageTemplates && (
                <div className="flex flex-wrap gap-2">
                  <Button
                    type="button"
                    size="sm"
                    data-testid="btn-crear-primera-plantilla"
                    onClick={() => onCreateTemplate?.()}
                  >
                    Crear primera plantilla maestra
                  </Button>
                  <Button
                    type="button"
                    size="sm"
                    variant="secondary"
                    data-testid="btn-importar-plantilla"
                    onClick={() => onImportTemplate?.()}
                    disabled={dbUnavailable}
                    title={
                      dbUnavailable
                        ? "Requiere DATABASE_URL para persistir la importación"
                        : undefined
                    }
                  >
                    Importar plantilla de referencia
                  </Button>
                  <Button
                    type="button"
                    size="sm"
                    variant="secondary"
                    data-testid="btn-vista-previa-modelo"
                    onClick={() => {
                      if (previewModel) {
                        onPreviewTemplate?.(previewModel);
                        setPreviewOpen(true);
                      }
                    }}
                    disabled={!previewModel}
                  >
                    Vista previa del modelo
                  </Button>
                </div>
              )}
              {dbUnavailable && (
                <p className="text-xs text-amber-900">
                  Sin base de datos podés abrir la vista previa, pero no importar ni crear plantillas
                  persistentes.
                </p>
              )}
            </div>
          )}

          <div className="space-y-3 text-sm">
            <label className="block space-y-1">
              <span className="text-xs text-[var(--os-text-muted)]">
                Plantilla maestra / producto
              </span>
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
                data-testid="create-order-template-select"
              >
                {templates.length === 0 && (
                  <option value="">Sin plantillas maestras</option>
                )}
                {templates.map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.productName} · {t.productCode} · v{t.version}
                    {t.brandClient ? ` · ej. ${t.brandClient}` : ""}
                  </option>
                ))}
              </select>
              {validation.errors.template && (
                <p className="text-xs text-rose-700" data-testid="err-template">
                  {validation.errors.template}
                </p>
              )}
            </label>
            <div className="grid grid-cols-2 gap-2">
              <label className="space-y-1">
                <span className="text-xs text-[var(--os-text-muted)]">Producto</span>
                <input
                  value={product}
                  onChange={(e) => setProduct(e.target.value)}
                  className="w-full rounded border px-3 py-2"
                  data-testid="create-order-product"
                />
                {validation.errors.product && (
                  <p className="text-xs text-rose-700">{validation.errors.product}</p>
                )}
              </label>
              <label className="space-y-1">
                <span className="text-xs text-[var(--os-text-muted)]">Código</span>
                <input
                  value={code}
                  onChange={(e) => setCode(e.target.value)}
                  className="w-full rounded border px-3 py-2"
                  data-testid="create-order-code"
                />
                {validation.errors.code && (
                  <p className="text-xs text-rose-700">{validation.errors.code}</p>
                )}
              </label>
              <label className="space-y-1">
                <span className="text-xs text-[var(--os-text-muted)]">Cliente</span>
                <input
                  value={client}
                  onChange={(e) => setClient(e.target.value)}
                  className="w-full rounded border px-3 py-2"
                  data-testid="create-order-client"
                />
                {validation.errors.client && (
                  <p className="text-xs text-rose-700">{validation.errors.client}</p>
                )}
              </label>
              <label className="space-y-1">
                <span className="text-xs text-[var(--os-text-muted)]">Lote</span>
                <input
                  value={lot}
                  onChange={(e) => setLot(e.target.value)}
                  className="w-full rounded border px-3 py-2"
                  data-testid="create-order-lot"
                />
                {validation.errors.lot && (
                  <p className="text-xs text-rose-700">{validation.errors.lot}</p>
                )}
              </label>
            </div>
            {type === "OA" && (
              <label className="block space-y-1">
                <span className="text-xs text-[var(--os-text-muted)]">Sector asignado</span>
                <select
                  value={assignedSector}
                  onChange={(e) => setAssignedSector(e.target.value as SectorId)}
                  className="w-full rounded border px-3 py-2"
                  data-testid="create-order-sector"
                >
                  <option value="ENVASADO_MASIVO">Envasado Masivo</option>
                  <option value="ENVASADO_PREMIUM">Envasado Premium</option>
                </select>
                {validation.errors.sector && (
                  <p className="text-xs text-rose-700">{validation.errors.sector}</p>
                )}
              </label>
            )}
            {previewModel && (
              <Button
                type="button"
                variant="secondary"
                size="sm"
                onClick={() => {
                  onPreviewTemplate?.(previewModel);
                  setPreviewOpen(true);
                }}
              >
                Vista previa del modelo
              </Button>
            )}
            {!validation.ok && (
              <p
                className="text-sm text-rose-700"
                data-testid="create-order-disable-reasons"
              >
                No se puede crear: {validation.disableReasons.join(" · ")}
              </p>
            )}
            {error && <p className="text-sm text-rose-700">{error}</p>}
          </div>

          <DialogFooter>
            <Button type="button" variant="secondary" onClick={() => onOpenChange(false)}>
              Cancelar
            </Button>
            <Button
              type="button"
              onClick={() => void submit()}
              disabled={saving || !validation.ok}
              data-testid="create-order-submit"
              title={
                !validation.ok
                  ? `Deshabilitado: ${validation.disableReasons.join(", ")}`
                  : undefined
              }
            >
              {saving ? "Creando…" : "Crear orden"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={previewOpen} onOpenChange={setPreviewOpen}>
        <DialogContent className="max-h-[90vh] max-w-3xl overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Vista previa del modelo</DialogTitle>
            <DialogDescription>
              Recorrido visual de la plantilla de referencia. No es una orden guardada.
            </DialogDescription>
          </DialogHeader>
          {previewModel && (
            <LegalOrderPreview
              order={{
                id: previewModel.id,
                orderNumber: `${previewModel.type}-MODELO`,
                type: previewModel.type,
                templateId: previewModel.id,
                templateVersion: previewModel.version,
                templateSnapshot: previewModel.content,
                product: previewModel.productName,
                client: previewModel.brandClient ?? "",
                code: previewModel.productCode,
                lot: "",
                assignedSector: type === "OE" ? "ELABORACION" : "ENVASADO_MASIVO",
                status: "BORRADOR",
                formData: previewModel.content,
                completionPercentage: 0,
                revision: 1,
                version: 1,
                linkedWorkItemId: null,
                reviewedAt: null,
                reviewedBy: null,
                completedAt: null,
                completedBy: null,
                formulaProductId: null,
                formulaVersionId: null,
                formulaVersionHash: null,
                createdBy: "preview",
                updatedBy: "preview",
                createdAt: previewModel.createdAt,
                updatedAt: previewModel.updatedAt,
              }}
            />
          )}
        </DialogContent>
      </Dialog>
    </>
  );
}
