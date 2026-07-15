"use client";

import { useState } from "react";
import { Upload } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import {
  MAX_DOCUMENT_BYTES,
  readFileAsDataUrl,
  saveDocument,
  type OrderDocumentKind,
} from "../adapters/order-documents-repository";

const ACCEPTED_TYPES = ".pdf,.doc,.docx,.png,.jpg,.jpeg,.webp";

interface UploadDocumentDialogProps {
  kind: OrderDocumentKind;
  refOptions: string[];
  uploadedBy: string;
  onUploaded?: () => void;
}

/** Botón + modal para subir el archivo de una OE/OA — PDF, DOCX o imagen. */
export function UploadDocumentDialog({
  kind,
  refOptions,
  uploadedBy,
  onUploaded,
}: UploadDocumentDialogProps) {
  const [open, setOpen] = useState(false);
  const [ref, setRef] = useState(refOptions[0] ?? "");
  const [manualRef, setManualRef] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const label = kind === "OE" ? "Orden de Elaboración" : "Orden de Acondicionamiento";
  const effectiveRef = ref === "__manual__" ? manualRef.trim() : ref;

  const reset = () => {
    setFile(null);
    setError(null);
    setManualRef("");
    setRef(refOptions[0] ?? "");
  };

  const handleSubmit = async () => {
    setError(null);
    if (!file) {
      setError("Seleccioná un archivo PDF, DOCX o imagen.");
      return;
    }
    if (file.size > MAX_DOCUMENT_BYTES) {
      setError("El archivo supera el tamaño máximo permitido (4 MB) para esta demo.");
      return;
    }
    if (!effectiveRef) {
      setError(`Indicá el número de ${kind}.`);
      return;
    }
    setSaving(true);
    try {
      const fileDataUrl = await readFileAsDataUrl(file);
      saveDocument({
        kind,
        ref: effectiveRef,
        fileName: file.name,
        fileType: file.type || "application/octet-stream",
        fileDataUrl,
        uploadedBy,
      });
      setOpen(false);
      reset();
      onUploaded?.();
    } catch {
      setError("No pudimos leer el archivo. Probá de nuevo.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (!next) reset();
      }}
    >
      <Button variant="primary" onClick={() => setOpen(true)}>
        <Upload className="mr-1.5 size-4" aria-hidden="true" />
        Subir {kind}
      </Button>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Subir archivo de {label}</DialogTitle>
          <DialogDescription>
            Formatos aceptados: PDF, DOCX o imagen. Máximo 4&nbsp;MB.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="space-y-1.5">
            <label htmlFor="order-ref" className="text-sm font-medium text-[var(--foreground)]">
              Número de {kind}
            </label>
            <select
              id="order-ref"
              value={ref}
              onChange={(e) => setRef(e.target.value)}
              className="w-full rounded-[0.625rem] border border-[var(--border)] bg-[var(--surface)] px-3 py-2 text-sm"
            >
              {refOptions.map((option) => (
                <option key={option} value={option}>
                  {option}
                </option>
              ))}
              <option value="__manual__">Otro número…</option>
            </select>
            {ref === "__manual__" && (
              <input
                type="text"
                value={manualRef}
                onChange={(e) => setManualRef(e.target.value)}
                placeholder={`Ej. ${kind}-2026-0001`}
                className="w-full rounded-[0.625rem] border border-[var(--border)] bg-[var(--surface)] px-3 py-2 text-sm"
              />
            )}
          </div>

          <div className="space-y-1.5">
            <label htmlFor="order-file" className="text-sm font-medium text-[var(--foreground)]">
              Archivo
            </label>
            <input
              id="order-file"
              type="file"
              accept={ACCEPTED_TYPES}
              onChange={(e) => setFile(e.target.files?.[0] ?? null)}
              className="w-full rounded-[0.625rem] border border-[var(--border)] bg-[var(--surface)] px-3 py-2 text-sm"
            />
          </div>

          {error && (
            <p role="alert" className="text-sm text-rose-700">
              {error}
            </p>
          )}
        </div>

        <DialogFooter>
          <Button variant="secondary" onClick={() => setOpen(false)}>
            Cancelar
          </Button>
          <Button variant="primary" onClick={handleSubmit} disabled={saving}>
            {saving ? "Subiendo…" : "Subir archivo"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
