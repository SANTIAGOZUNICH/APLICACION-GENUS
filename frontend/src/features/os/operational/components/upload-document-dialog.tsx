"use client";

import { useState } from "react";
import { FileUp, Upload } from "lucide-react";
import {
  ConfirmDialog,
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import {
  ALLOWED_EXTENSIONS,
  getLatestDocumentByRef,
  readFileAsDataUrl,
  replaceDocument,
  saveDocument,
  type OrderDocumentKind,
  validateOrderFile,
} from "../adapters/order-documents-repository";
import type { SectorId } from "@/types/operational/sector";

const ACCEPTED_TYPES = ALLOWED_EXTENSIONS.join(",");

interface UploadDocumentDialogProps {
  kind: OrderDocumentKind;
  refOptions: string[];
  uploadedBy: string;
  canUpload: boolean;
  actorSectorId?: SectorId | null;
  onUploaded?: () => void;
}

function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/** Botón + modal para subir el archivo de una OE/OA — PDF, DOCX o imagen. */
export function UploadDocumentDialog({
  kind,
  refOptions,
  uploadedBy,
  canUpload,
  actorSectorId,
  onUploaded,
}: UploadDocumentDialogProps) {
  const [open, setOpen] = useState(false);
  const [ref, setRef] = useState(refOptions[0] ?? "");
  const [manualRef, setManualRef] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [confirmReplace, setConfirmReplace] = useState(false);
  const [dragActive, setDragActive] = useState(false);

  const label = kind === "OE" ? "Orden de Elaboración" : "Orden de Acondicionamiento";
  const effectiveRef = ref === "__manual__" ? manualRef.trim() : ref;

  const reset = () => {
    setFile(null);
    setError(null);
    setManualRef("");
    setRef(refOptions[0] ?? "");
    setConfirmReplace(false);
    setDragActive(false);
  };

  const applyFile = (nextFile: File | null) => {
    setError(null);
    if (!nextFile) {
      setFile(null);
      return;
    }
    const validation = validateOrderFile(nextFile);
    if (!validation.ok) {
      setFile(nextFile);
      setError(validation.error);
      return;
    }
    setFile(nextFile);
  };

  const executeUpload = async (replaceLatest: boolean) => {
    if (!canUpload) {
      setError("Tu sector no tiene permiso para subir o reemplazar este documento.");
      return;
    }
    if (!file) {
      setError("Seleccioná un archivo PDF, DOCX o imagen.");
      return;
    }
    const validation = validateOrderFile(file);
    if (!validation.ok) {
      setError(validation.error);
      return;
    }
    if (!effectiveRef) {
      setError(`Indicá el número de ${kind}.`);
      return;
    }
    setSaving(true);
    try {
      const fileDataUrl = await readFileAsDataUrl(file);
      const payload = {
        kind,
        ref: effectiveRef,
        fileName: file.name,
        fileType: file.type || "application/octet-stream",
        fileDataUrl,
        uploadedBy,
        actorSectorId,
      };
      const result = replaceLatest ? replaceDocument(payload) : saveDocument(payload);
      if (!result.ok) {
        setError(result.error);
        return;
      }
      setOpen(false);
      reset();
      onUploaded?.();
    } catch {
      setError("No pudimos leer el archivo. Probá de nuevo.");
    } finally {
      setSaving(false);
    }
  };

  const handleSubmit = () => {
    setError(null);
    if (!file) {
      setError("Seleccioná un archivo PDF, DOCX o imagen.");
      return;
    }
    const validation = validateOrderFile(file);
    if (!validation.ok) {
      setError(validation.error);
      return;
    }
    if (!effectiveRef) {
      setError(`Indicá el número de ${kind}.`);
      return;
    }
    if (getLatestDocumentByRef(effectiveRef)) {
      setConfirmReplace(true);
      return;
    }
    void executeUpload(false);
  };

  return (
    <>
      <Dialog
        open={open}
        onOpenChange={(next) => {
          setOpen(next);
          if (!next) reset();
        }}
      >
        <Button
          variant="primary"
          onClick={() => setOpen(true)}
          disabled={!canUpload}
          title={!canUpload ? "Tu sector no puede subir este documento." : undefined}
        >
          <Upload className="mr-1.5 size-4" aria-hidden="true" />
          Subir {kind}
        </Button>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Subir archivo de {label}</DialogTitle>
            <DialogDescription>
              Formatos aceptados: PDF, Excel, Word, JPG o PNG. Máximo 4&nbsp;MB.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4">
            <div className="rounded-[var(--os-radius-sm)] border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-900">
              Archivos en este navegador (demo). No es Drive/multiusuario.
            </div>

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
                <option value="__manual__">Otro número...</option>
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
              <label
                htmlFor="order-file"
                onDragOver={(event) => {
                  event.preventDefault();
                  setDragActive(true);
                }}
                onDragLeave={() => setDragActive(false)}
                onDrop={(event) => {
                  event.preventDefault();
                  setDragActive(false);
                  applyFile(event.dataTransfer.files?.[0] ?? null);
                }}
                className={`flex cursor-pointer flex-col items-center justify-center rounded-[0.625rem] border border-dashed px-4 py-6 text-center text-sm transition-colors ${
                  dragActive
                    ? "border-[var(--os-teal)] bg-[var(--os-teal-soft)]"
                    : "border-[var(--border)] bg-[var(--surface)] hover:bg-[var(--os-bg)]"
                }`}
              >
                <FileUp className="mb-2 size-5 text-[var(--os-teal)]" aria-hidden="true" />
                <span className="font-medium text-[var(--foreground)]">
                  Arrastrá un archivo o hacé click para elegir
                </span>
                <span className="mt-1 text-xs text-[var(--os-text-muted)]">
                  PDF, XLS/XLSX, DOC/DOCX, JPG o PNG.
                </span>
              </label>
              <input
                id="order-file"
                type="file"
                accept={ACCEPTED_TYPES}
                onChange={(e) => applyFile(e.target.files?.[0] ?? null)}
                className="sr-only"
              />
              {file && (
                <div className="rounded-[0.625rem] border border-[var(--border)] bg-[var(--os-bg)] px-3 py-2 text-xs text-[var(--os-text)]">
                  <p className="font-medium">{file.name}</p>
                  <p className="mt-1 text-[var(--os-text-muted)]">
                    {formatFileSize(file.size)} · {file.type || "tipo detectado por extensión"}
                  </p>
                </div>
              )}
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
            <Button variant="primary" onClick={handleSubmit} disabled={saving || !canUpload}>
              {saving ? "Subiendo..." : "Subir archivo"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <ConfirmDialog
        open={confirmReplace}
        onOpenChange={setConfirmReplace}
        title={`Reemplazar archivo de ${kind}`}
        description={`Ya existe un archivo para ${effectiveRef}. Se guardará una nueva versión y la anterior quedará en el historial local. ¿Confirmás el reemplazo?`}
        confirmLabel="Sí, reemplazar"
        cancelLabel="Cancelar"
        onConfirm={() => void executeUpload(true)}
      />
    </>
  );
}
