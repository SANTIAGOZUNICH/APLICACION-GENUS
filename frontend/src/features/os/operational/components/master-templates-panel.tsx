"use client";

import { useCallback, useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import type { OrderDocType, OrderTemplateRecord } from "@/lib/orders/types";
import {
  createTemplateApi,
  fetchAllOrderTemplates,
  fetchBuiltinTemplates,
  fetchTemplateHistoryApi,
  importSeedTemplatesApi,
  templateActionApi,
  type OrdersClientSession,
} from "@/lib/orders/orders-client";
import { LegalOrderPreview } from "./legal-order-preview";

interface MasterTemplatesPanelProps {
  type: OrderDocType;
  session: OrdersClientSession;
  canManage: boolean;
  dbUnavailable: boolean;
  onTemplatesChanged: (templates: OrderTemplateRecord[]) => void;
}

export function MasterTemplatesPanel({
  type,
  session,
  canManage,
  dbUnavailable,
  onTemplatesChanged,
}: MasterTemplatesPanelProps) {
  const [open, setOpen] = useState(false);
  const [items, setItems] = useState<OrderTemplateRecord[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [createOpen, setCreateOpen] = useState(false);
  const [productName, setProductName] = useState("");
  const [productCode, setProductCode] = useState("");
  const [brandClient, setBrandClient] = useState("");
  const [preview, setPreview] = useState<OrderTemplateRecord | null>(null);
  const [history, setHistory] = useState<OrderTemplateRecord[] | null>(null);

  const reload = useCallback(async () => {
    if (!session.email || dbUnavailable) {
      const builtin = await fetchBuiltinTemplates(type);
      setItems(builtin);
      return;
    }
    try {
      const list = await fetchAllOrderTemplates(session, type);
      setItems(list);
      onTemplatesChanged(list.filter((t) => t.status === "VIGENTE"));
    } catch (err) {
      setError(err instanceof Error ? err.message : "No se pudieron cargar plantillas.");
    }
  }, [session, type, dbUnavailable, onTemplatesChanged]);

  useEffect(() => {
    if (open) void reload();
  }, [open, reload]);

  const vigentes = items.filter((t) => t.status === "VIGENTE");

  const run = async (fn: () => Promise<void>) => {
    setBusy(true);
    setError(null);
    try {
      await fn();
      await reload();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Operación fallida.");
    } finally {
      setBusy(false);
    }
  };

  if (!canManage) return null;

  return (
    <section
      className="rounded border border-[var(--os-border)] bg-[var(--os-surface)]"
      data-testid="plantillas-maestras-section"
    >
      <button
        type="button"
        className="flex w-full items-center justify-between px-4 py-3 text-left text-sm font-medium"
        onClick={() => setOpen((v) => !v)}
      >
        Plantillas maestras
        <span className="text-xs text-[var(--os-text-muted)]">
          {dbUnavailable
            ? "Vista previa (sin base)"
            : `${vigentes.length} vigente${vigentes.length === 1 ? "" : "s"}`}
        </span>
      </button>
      {open && (
        <div className="space-y-3 border-t border-[var(--os-border)] px-4 py-3">
          <p className="text-xs text-[var(--os-text-muted)]">
            Creá plantillas para otros productos sin necesidad de cargar un archivo. Importá las de
            referencia (Serum OE / Crema Facial OA) o duplicá una existente.
          </p>
          {dbUnavailable && (
            <p className="rounded border border-amber-300 bg-amber-50 px-3 py-2 text-xs text-amber-950">
              La base de datos no está configurada. Podés ver la plantilla, pero no crear ni guardar
              órdenes todavía.
            </p>
          )}
          <div className="flex flex-wrap gap-2">
            <Button
              type="button"
              size="sm"
              data-testid="btn-nueva-plantilla"
              disabled={dbUnavailable || busy}
              onClick={() => setCreateOpen(true)}
            >
              Nueva plantilla {type}
            </Button>
            <Button
              type="button"
              size="sm"
              variant="secondary"
              data-testid="btn-importar-referencia"
              disabled={dbUnavailable || busy}
              onClick={() =>
                void run(async () => {
                  const list = await importSeedTemplatesApi(session, type);
                  onTemplatesChanged(list);
                })
              }
            >
              Importar plantilla de referencia
            </Button>
            <Button
              type="button"
              size="sm"
              variant="secondary"
              data-testid="btn-preview-modelo-panel"
              onClick={async () => {
                const builtin = await fetchBuiltinTemplates(type);
                setPreview(builtin[0] ?? null);
              }}
            >
              Vista previa del modelo
            </Button>
          </div>
          {error && <p className="text-sm text-rose-700">{error}</p>}
          <ul className="space-y-2 text-xs">
            {items.length === 0 && (
              <li data-testid="plantillas-empty-msg" className="text-[var(--os-text-muted)]">
                No hay plantillas maestras disponibles. Primero debés crear o importar una
                plantilla.
              </li>
            )}
            {items.map((t) => (
              <li
                key={t.id}
                className="flex flex-wrap items-center gap-2 rounded border border-[var(--os-border)] px-2 py-2"
              >
                <span className="font-medium">
                  {t.productName} · {t.productCode} · v{t.version}
                </span>
                <span
                  className={
                    t.status === "VIGENTE" ? "text-emerald-700" : "text-[var(--os-text-muted)]"
                  }
                >
                  {t.status}
                </span>
                {t.sourceFile && (
                  <span className="text-[var(--os-text-muted)]">origen: {t.sourceFile}</span>
                )}
                <div className="ml-auto flex flex-wrap gap-1">
                  <Button type="button" size="sm" variant="secondary" onClick={() => setPreview(t)}>
                    Vista previa PDF
                  </Button>
                  <Button
                    type="button"
                    size="sm"
                    variant="secondary"
                    disabled={dbUnavailable || busy}
                    onClick={() =>
                      void run(async () => {
                        await templateActionApi(session, t.id, "duplicate");
                      })
                    }
                  >
                    Duplicar
                  </Button>
                  {t.status === "VIGENTE" && (
                    <>
                      <Button
                        type="button"
                        size="sm"
                        variant="secondary"
                        disabled={dbUnavailable || busy}
                        onClick={() =>
                          void run(async () => {
                            const reason = window.prompt(
                              "Motivo de la nueva versión:",
                              "Actualización de plantilla"
                            );
                            if (!reason) return;
                            await templateActionApi(session, t.id, "new_version", {
                              changeReason: reason,
                            });
                          })
                        }
                      >
                        Nueva versión
                      </Button>
                      <Button
                        type="button"
                        size="sm"
                        variant="secondary"
                        disabled={dbUnavailable || busy}
                        onClick={() =>
                          void run(async () => {
                            await templateActionApi(session, t.id, "obsolete");
                          })
                        }
                      >
                        Marcar obsoleta
                      </Button>
                    </>
                  )}
                  <Button
                    type="button"
                    size="sm"
                    variant="secondary"
                    disabled={dbUnavailable || busy}
                    onClick={() =>
                      void run(async () => {
                        const res = await fetchTemplateHistoryApi(session, t.id);
                        setHistory(res.versions);
                      })
                    }
                  >
                    Historial
                  </Button>
                </div>
              </li>
            ))}
          </ul>
        </div>
      )}

      <Dialog open={createOpen} onOpenChange={setCreateOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Nueva plantilla {type}</DialogTitle>
            <DialogDescription>
              No es obligatorio cargar un archivo. Se crea la estructura vacía lista para editar.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-2 text-sm">
            <label className="block space-y-1">
              <span className="text-xs">Producto</span>
              <input
                className="w-full rounded border px-3 py-2"
                value={productName}
                onChange={(e) => setProductName(e.target.value)}
                data-testid="nueva-plantilla-producto"
              />
            </label>
            <label className="block space-y-1">
              <span className="text-xs">Código</span>
              <input
                className="w-full rounded border px-3 py-2"
                value={productCode}
                onChange={(e) => setProductCode(e.target.value)}
                data-testid="nueva-plantilla-codigo"
              />
            </label>
            <label className="block space-y-1">
              <span className="text-xs">Cliente de ejemplo (opcional)</span>
              <input
                className="w-full rounded border px-3 py-2"
                value={brandClient}
                onChange={(e) => setBrandClient(e.target.value)}
              />
            </label>
          </div>
          <DialogFooter>
            <Button type="button" variant="secondary" onClick={() => setCreateOpen(false)}>
              Cancelar
            </Button>
            <Button
              type="button"
              data-testid="nueva-plantilla-guardar"
              disabled={busy || dbUnavailable}
              onClick={() =>
                void run(async () => {
                  const t = await createTemplateApi(session, {
                    type,
                    productName,
                    productCode,
                    brandClient: brandClient || null,
                  });
                  onTemplatesChanged([t]);
                  setCreateOpen(false);
                  setProductName("");
                  setProductCode("");
                  setBrandClient("");
                })
              }
            >
              Crear plantilla
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={Boolean(preview)} onOpenChange={(v) => !v && setPreview(null)}>
        <DialogContent className="max-h-[90vh] max-w-3xl overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Vista previa — {preview?.productName}</DialogTitle>
            <DialogDescription>
              Modelo visual. Firmas en blanco para firma física.
            </DialogDescription>
          </DialogHeader>
          {preview && (
            <LegalOrderPreview
              order={{
                id: preview.id,
                orderNumber: `${preview.type}-MODELO`,
                type: preview.type,
                templateId: preview.id,
                templateVersion: preview.version,
                templateSnapshot: preview.content,
                product: preview.productName,
                client: preview.brandClient ?? "",
                code: preview.productCode,
                lot: "",
                assignedSector: type === "OE" ? "ELABORACION" : "ENVASADO_MASIVO",
                status: "BORRADOR",
                formData: preview.content,
                completionPercentage: 0,
                revision: 1,
                version: 1,
                linkedWorkItemId: null,
                reviewedAt: null,
                reviewedBy: null,
                completedAt: null,
                completedBy: null,
                createdBy: "preview",
                updatedBy: "preview",
                createdAt: preview.createdAt,
                updatedAt: preview.updatedAt,
              }}
            />
          )}
        </DialogContent>
      </Dialog>

      <Dialog open={Boolean(history)} onOpenChange={(v) => !v && setHistory(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Historial de versiones</DialogTitle>
          </DialogHeader>
          <ul className="space-y-1 text-sm">
            {(history ?? []).map((h) => (
              <li key={h.id}>
                v{h.version} · {h.status} · {h.changeReason ?? "—"} ·{" "}
                {new Date(h.createdAt).toLocaleString("es-AR")}
              </li>
            ))}
          </ul>
        </DialogContent>
      </Dialog>
    </section>
  );
}
