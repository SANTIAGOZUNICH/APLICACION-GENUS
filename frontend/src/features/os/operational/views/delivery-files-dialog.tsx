"use client";

import { useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import {
  ConfirmDialog,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  listDocumentsByRef,
  removeDocument,
  type OrderDocument,
} from "../adapters/order-documents-repository";

interface DeliveryFilesDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  refNumber: string | null;
}

function estimateSize(dataUrl: string): string {
  const base64 = dataUrl.split(",")[1] ?? dataUrl;
  const bytes = Math.max(0, Math.round((base64.length * 3) / 4));
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export function DeliveryFilesDialog({ open, onOpenChange, refNumber }: DeliveryFilesDialogProps) {
  const [deleteTarget, setDeleteTarget] = useState<OrderDocument | null>(null);
  const [tick, setTick] = useState(0);

  const documents = useMemo(() => {
    if (!refNumber) return [];
    void tick;
    return listDocumentsByRef(refNumber);
  }, [refNumber, tick]);

  return (
    <>
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>Administrar archivos</DialogTitle>
            <DialogDescription>
              Documentos OE/OA asociados a {refNumber ?? "la orden seleccionada"}. Los datos del trabajo y la entrega se conservan.
            </DialogDescription>
          </DialogHeader>

          <div className="rounded-[var(--os-radius-sm)] border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-950">
            Archivos en este navegador (localStorage / demo). La descarga y eliminación afectan solo este almacenamiento local; no liberan espacio de servidor porque todavía no hay Blob/Drive para estos adjuntos.
          </div>

          <div className="max-h-96 overflow-y-auto">
            {documents.length === 0 ? (
              <p className="py-8 text-center text-sm text-[var(--os-text-muted)]">
                No hay archivos vinculados a esta referencia.
              </p>
            ) : (
              <div className="divide-y divide-[var(--os-border-subtle)] rounded-[var(--os-radius-sm)] border border-[var(--os-border)]">
                {documents.map((doc) => (
                  <div key={doc.id} className="flex flex-wrap items-center justify-between gap-3 px-3 py-3">
                    <div>
                      <p className="text-sm font-medium text-[var(--os-text)]">
                        v{doc.version} · {doc.fileName}
                      </p>
                      <p className="mt-0.5 text-xs text-[var(--os-text-muted)]">
                        {doc.kind} {doc.ref} · {estimateSize(doc.fileDataUrl)} ·{" "}
                        {new Date(doc.uploadedAt).toLocaleString("es-AR")}
                      </p>
                    </div>
                    <div className="flex items-center gap-2">
                      <Button asChild variant="secondary" size="sm">
                        <a href={doc.fileDataUrl} download={doc.fileName}>
                          Descargar
                        </a>
                      </Button>
                      <Button
                        variant="destructive"
                        size="sm"
                        onClick={() => setDeleteTarget(doc)}
                      >
                        Eliminar versión
                      </Button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </DialogContent>
      </Dialog>

      <ConfirmDialog
        open={deleteTarget !== null}
        onOpenChange={(nextOpen) => {
          if (!nextOpen) setDeleteTarget(null);
        }}
        title="Eliminar versión del archivo"
        description={`Se eliminará ${deleteTarget?.fileName ?? "este archivo"} solo del navegador actual. ¿Confirmás?`}
        confirmLabel="Eliminar"
        cancelLabel="Cancelar"
        variant="destructive"
        onConfirm={() => {
          if (!deleteTarget) return;
          removeDocument(deleteTarget.id);
          setDeleteTarget(null);
          setTick((value) => value + 1);
        }}
      />
    </>
  );
}
