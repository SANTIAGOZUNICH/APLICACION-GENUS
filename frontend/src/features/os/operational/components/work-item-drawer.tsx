"use client";

import { useState } from "react";
import { Download, Eye, FileWarning } from "lucide-react";
import type { WorkItem } from "@/types/operational/work-item";
import { displayField } from "@/lib/operational/display-fields";
import { ConfirmDialog } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import {
  Drawer,
  DrawerBody,
  DrawerCloseButton,
  DrawerContent,
  DrawerFooter,
  DrawerHeader,
  DrawerTitle,
} from "@/components/ui/drawer";
import { getLatestDocumentByRef } from "../adapters/order-documents-repository";
import { isWorkTransferredStatus, WORK_TRANSFER } from "../lib/work-transfer-labels";
import { StatusChip } from "./operational-ui";

interface WorkItemDrawerProps {
  item: WorkItem | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  variant: "elaboracion" | "envasado";
  responsibleLabel: string;
  getFinishedQty: (itemId: string) => string;
  getObservation: (itemId: string) => string;
  onSaveProgress: (itemId: string, payload: { finishedQty: string; observation: string }) => void;
  onMarkFinished: (item: WorkItem, payload: { finishedQty: string; observation: string }) => void;
}

/** Drawer lateral de trabajo — Elaboración/Envasado: avance, archivo de orden y cierre a Calidad. */
export function WorkItemDrawer({
  item,
  open,
  onOpenChange,
  variant,
  responsibleLabel,
  getFinishedQty,
  getObservation,
  onSaveProgress,
  onMarkFinished,
}: WorkItemDrawerProps) {
  const [finishedQty, setFinishedQty] = useState("");
  const [observation, setObservation] = useState("");
  const [confirmFinish, setConfirmFinish] = useState(false);
  const [loadedItemId, setLoadedItemId] = useState<string | null>(null);

  // Carga el avance guardado al cambiar de trabajo (ajuste de estado durante el render).
  if (item && item.id !== loadedItemId) {
    setLoadedItemId(item.id);
    setFinishedQty(getFinishedQty(item.id));
    setObservation(getObservation(item.id));
  }

  if (!item) return null;

  const isElaboracion = variant === "elaboracion";
  const orderRef = isElaboracion ? item.oeRef : item.oaRef;
  const orderLabel = isElaboracion ? "OE" : "OA";
  const unit = item.unit ?? (isElaboracion ? "kg" : "un.");
  const planned = Number.parseFloat(item.quantity ?? "0") || 0;
  const finished = Number.parseFloat(finishedQty) || 0;
  const progressPct = planned > 0 ? Math.min(100, Math.round((finished / planned) * 100)) : 0;
  const missing = Math.max(0, planned - finished);
  const doc = getLatestDocumentByRef(orderRef);
  const transferred = isWorkTransferredStatus(item.status);

  const handleSave = () => {
    onSaveProgress(item.id, { finishedQty, observation });
  };

  const handleFinish = () => {
    onMarkFinished(item, { finishedQty: finishedQty || item.quantity || "", observation });
    setConfirmFinish(false);
    onOpenChange(false);
  };

  return (
    <Drawer open={open} onOpenChange={onOpenChange}>
      <DrawerContent aria-describedby={undefined}>
        <DrawerHeader>
          <div>
            <DrawerTitle>{displayField(item.product)}</DrawerTitle>
            <p className="mt-1 text-sm text-[var(--os-text-muted)]">{displayField(item.client)}</p>
          </div>
          <DrawerCloseButton />
        </DrawerHeader>

        <DrawerBody className="space-y-6">
          <dl className="grid grid-cols-2 gap-4 text-sm">
            <div>
              <dt className="text-xs uppercase text-[var(--os-text-muted)]">{orderLabel}</dt>
              <dd className="font-mono font-medium">{displayField(orderRef)}</dd>
            </div>
            <div>
              <dt className="text-xs uppercase text-[var(--os-text-muted)]">Fecha</dt>
              <dd className="font-medium">{displayField(item.dayLabel ?? item.plannedDate)}</dd>
            </div>
            <div>
              <dt className="text-xs uppercase text-[var(--os-text-muted)]">{responsibleLabel}</dt>
              <dd className="font-medium">{displayField(isElaboracion ? item.ownerPerson : item.line)}</dd>
            </div>
            <div>
              <dt className="text-xs uppercase text-[var(--os-text-muted)]">
                {isElaboracion ? "Kg planificados" : "Unidades planificadas"}
              </dt>
              <dd className="font-medium tabular-nums">
                {item.quantity ?? "—"} {unit}
              </dd>
            </div>
          </dl>

          <div>
            <p className="mb-1.5 text-xs uppercase text-[var(--os-text-muted)]">
              Archivo de {orderLabel}
            </p>
            {doc ? (
              <div className="flex items-center gap-3 rounded-[var(--os-radius-sm)] border border-[var(--os-border)] px-3 py-2">
                <span className="truncate text-sm">{doc.fileName}</span>
                <a
                  href={doc.fileDataUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="ml-auto inline-flex items-center gap-1 text-xs text-[var(--os-teal)] hover:underline"
                >
                  <Eye className="size-3.5" aria-hidden="true" /> Ver
                </a>
                <a
                  href={doc.fileDataUrl}
                  download={doc.fileName}
                  className="inline-flex items-center gap-1 text-xs text-[var(--os-teal)] hover:underline"
                >
                  <Download className="size-3.5" aria-hidden="true" /> Descargar
                </a>
              </div>
            ) : (
              <p className="flex items-center gap-2 rounded-[var(--os-radius-sm)] border border-dashed border-[var(--os-border)] px-3 py-2 text-xs text-[var(--os-text-muted)]">
                <FileWarning className="size-3.5" aria-hidden="true" />
                Sin archivo de {orderLabel} cargado. Subilo desde &quot;Órdenes de{" "}
                {isElaboracion ? "Elaboración" : "Acondicionamiento"}&quot;.
              </p>
            )}
          </div>

          <div className="space-y-2">
            <label htmlFor="drawer-finished-qty" className="text-sm font-medium text-[var(--os-text)]">
              {isElaboracion ? "Kg realizados" : "Unidades realizadas"}
            </label>
            <input
              id="drawer-finished-qty"
              type="text"
              inputMode="decimal"
              value={finishedQty}
              disabled={transferred}
              onChange={(e) => setFinishedQty(e.target.value)}
              className="w-full rounded-[var(--os-radius-sm)] border border-[var(--os-border)] bg-[var(--os-surface)] px-3 py-2 text-sm tabular-nums disabled:opacity-50"
            />
            <div className="h-2 w-full overflow-hidden rounded-full bg-[var(--os-bg)]">
              <div
                className="h-full rounded-full bg-[var(--os-teal)] transition-all"
                style={{ width: `${progressPct}%` }}
              />
            </div>
            <div className="flex items-center justify-between text-xs text-[var(--os-text-muted)]">
              <span>{progressPct}% completado</span>
              {!isElaboracion && <span>Faltan {missing.toFixed(0)} {unit}</span>}
            </div>
          </div>

          <div className="space-y-2">
            <label htmlFor="drawer-observation" className="text-sm font-medium text-[var(--os-text)]">
              Observaciones
            </label>
            <textarea
              id="drawer-observation"
              value={observation}
              disabled={transferred}
              onChange={(e) => setObservation(e.target.value)}
              rows={3}
              placeholder="Diferencias respecto de trabajos anteriores, incidencias, notas para Calidad…"
              className="w-full rounded-[var(--os-radius-sm)] border border-[var(--os-border)] bg-[var(--os-surface)] px-3 py-2 text-sm disabled:opacity-50"
            />
          </div>

          <div>
            <p className="mb-1.5 text-xs uppercase text-[var(--os-text-muted)]">Estado</p>
            <StatusChip status={item.status} transferredInbox={transferred} />
            {transferred && (
              <p className="mt-2 text-xs text-[var(--os-teal)]">
                {WORK_TRANSFER.deliveredToQuality} · {WORK_TRANSFER.nextResponsibleQuality}
              </p>
            )}
          </div>
        </DrawerBody>

        <DrawerFooter>
          <Button variant="secondary" disabled={transferred} onClick={handleSave}>
            Guardar avance
          </Button>
          <Button variant="primary" disabled={transferred} onClick={() => setConfirmFinish(true)}>
            Finalizar y enviar a Calidad
          </Button>
        </DrawerFooter>
      </DrawerContent>

      <ConfirmDialog
        open={confirmFinish}
        onOpenChange={setConfirmFinish}
        title="Enviar a Calidad"
        description={`${displayField(item.product)} pasará a la bandeja de Calidad y ya no vas a poder editar el avance. ¿Confirmás que terminaste este trabajo?`}
        confirmLabel="Sí, enviar a Calidad"
        cancelLabel="Cancelar"
        onConfirm={handleFinish}
      />
    </Drawer>
  );
}
