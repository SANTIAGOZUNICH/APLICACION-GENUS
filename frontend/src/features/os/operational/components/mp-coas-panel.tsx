"use client";

import { useCallback, useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { SchemaPendingBanner } from "@/components/ui/schema-pending-banner";
import { ConfirmDialog } from "@/components/ui/dialog";
import { usePreviewSession } from "@/features/os/session/preview-context";
import {
  ACTOR_EMAIL_HEADER,
  ACTOR_SECTOR_HEADER,
} from "@/lib/orders/actor";
import {
  canAdminCoas,
  canViewCoas,
  type CoaFileRecord,
  type CoaFolderRecord,
  type CoaVersionRecord,
} from "@/lib/coa/types";

export function MpCoasPanel() {
  const { email, sectorId } = usePreviewSession();
  const canView = canViewCoas(sectorId);
  const canAdmin = canAdminCoas(sectorId);
  const [parentId, setParentId] = useState<string | null>(null);
  const [stack, setStack] = useState<Array<{ id: string | null; name: string }>>([
    { id: null, name: "COA'S" },
  ]);
  const [folders, setFolders] = useState<CoaFolderRecord[]>([]);
  const [files, setFiles] = useState<CoaFileRecord[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [schemaPending, setSchemaPending] = useState(false);
  const [newFolder, setNewFolder] = useState("");
  const [q, setQ] = useState("");
  const [uploadProgress, setUploadProgress] = useState<string | null>(null);
  const [renameTarget, setRenameTarget] = useState<CoaFolderRecord | null>(null);
  const [renameName, setRenameName] = useState("");
  const [deleteTarget, setDeleteTarget] = useState<CoaFolderRecord | null>(null);
  const [detail, setDetail] = useState<{
    file: CoaFileRecord;
    versions: CoaVersionRecord[];
  } | null>(null);
  const [pdfUrl, setPdfUrl] = useState<string | null>(null);

  const headers = useCallback(
    () => ({
      [ACTOR_EMAIL_HEADER]: email ?? "",
      [ACTOR_SECTOR_HEADER]: sectorId,
    }),
    [email, sectorId]
  );

  const reload = useCallback(async () => {
    if (!canView) return;
    const qs = parentId ? `?parentId=${encodeURIComponent(parentId)}` : "";
    const res = await fetch(`/api/v1/coa${qs}`, { headers: headers() });
    const body = (await res.json()) as {
      folders?: CoaFolderRecord[];
      files?: CoaFileRecord[];
      error?: string;
      schemaPending?: boolean;
    };
    if (!res.ok) throw new Error(body.error ?? "Error COA");
    setFolders(body.folders ?? []);
    setFiles(body.files ?? []);
    setSchemaPending(Boolean(body.schemaPending));
  }, [canView, parentId, headers]);

  useEffect(() => {
    void reload().catch((e) => setError(e instanceof Error ? e.message : "Error"));
  }, [reload]);

  useEffect(() => {
    return () => {
      if (pdfUrl) URL.revokeObjectURL(pdfUrl);
    };
  }, [pdfUrl]);

  if (!canView) {
    return (
      <p className="text-sm text-[var(--os-text-muted)]">
        Tu sector no tiene acceso a COA’S.
      </p>
    );
  }

  const filteredFolders = folders.filter(
    (f) => !q || f.name.toLowerCase().includes(q.toLowerCase())
  );
  const filteredFiles = files.filter(
    (f) => !q || f.name.toLowerCase().includes(q.toLowerCase())
  );

  async function openFile(f: CoaFileRecord) {
    setError(null);
    if (pdfUrl) {
      URL.revokeObjectURL(pdfUrl);
      setPdfUrl(null);
    }
    const res = await fetch(`/api/v1/coa?fileId=${encodeURIComponent(f.id)}`, {
      headers: headers(),
    });
    const body = (await res.json()) as {
      file?: CoaFileRecord;
      versions?: CoaVersionRecord[];
      error?: string;
    };
    if (!res.ok) {
      setError(body.error ?? "No se pudo abrir el archivo");
      return;
    }
    setDetail({ file: body.file ?? f, versions: body.versions ?? [] });
    if ((body.file ?? f).mimeType === "application/pdf") {
      await previewPdf(f.id);
    }
  }

  async function previewPdf(fileId: string, version?: number) {
    const qs = new URLSearchParams({ fileId, preview: "1" });
    if (version != null) qs.set("version", String(version));
    const res = await fetch(`/api/v1/coa/download?${qs}`, { headers: headers() });
    if (!res.ok) {
      const b = (await res.json().catch(() => ({}))) as { error?: string };
      setError(b.error ?? "No se pudo previsualizar PDF");
      return;
    }
    const blob = await res.blob();
    if (pdfUrl) URL.revokeObjectURL(pdfUrl);
    setPdfUrl(URL.createObjectURL(blob));
  }

  function downloadHref(fileId: string, version?: number) {
    const qs = new URLSearchParams({ fileId });
    if (version != null) qs.set("version", String(version));
    return `/api/v1/coa/download?${qs}`;
  }

  async function downloadVersion(fileId: string, version?: number) {
    const res = await fetch(downloadHref(fileId, version), { headers: headers() });
    if (!res.ok) {
      const b = (await res.json().catch(() => ({}))) as { error?: string };
      setError(b.error ?? "Descarga falló");
      return;
    }
    const blob = await res.blob();
    const cd = res.headers.get("Content-Disposition") ?? "";
    const match = /filename="?([^"]+)"?/.exec(cd);
    const name = match?.[1] ? decodeURIComponent(match[1]) : "coa-file";
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = name;
    a.click();
    URL.revokeObjectURL(a.href);
  }

  return (
    <div className="space-y-3" data-testid="mp-coas-panel">
      <SchemaPendingBanner show={schemaPending} />
      {error ? (
        <p className="rounded border border-amber-300 bg-amber-50 px-3 py-2 text-sm" role="alert">
          {error}
        </p>
      ) : null}
      {uploadProgress ? (
        <p className="text-sm text-[var(--os-teal,#0d9488)]" data-testid="coa-upload-progress">
          {uploadProgress}
        </p>
      ) : null}

      <div className="flex flex-wrap items-center gap-2 text-sm">
        {stack.map((s, i) => (
          <button
            key={`${s.id}-${i}`}
            type="button"
            className="underline"
            onClick={() => {
              setStack(stack.slice(0, i + 1));
              setParentId(s.id);
              setDetail(null);
            }}
          >
            {s.name}
          </button>
        ))}
        <input
          className="ml-auto rounded border px-2 py-1 text-sm"
          placeholder="Buscar…"
          value={q}
          onChange={(e) => setQ(e.target.value)}
        />
      </div>

      {canAdmin ? (
        <div className="flex flex-wrap gap-2">
          <input
            className="rounded border px-2 py-1 text-sm"
            placeholder="Nueva carpeta"
            value={newFolder}
            onChange={(e) => setNewFolder(e.target.value)}
            disabled={schemaPending}
            data-testid="coa-new-folder"
          />
          <Button
            type="button"
            disabled={schemaPending || !newFolder.trim()}
            data-testid="coa-mkdir"
            onClick={() => {
              void fetch("/api/v1/coa", {
                method: "POST",
                headers: { ...headers(), "Content-Type": "application/json" },
                body: JSON.stringify({
                  action: "mkdir",
                  name: newFolder,
                  parentId,
                }),
              }).then(async (r) => {
                const b = (await r.json()) as { error?: string; schemaPending?: boolean };
                if (!r.ok) {
                  setError(b.error ?? "No se pudo crear carpeta");
                  if (b.schemaPending) setSchemaPending(true);
                  return;
                }
                setNewFolder("");
                setError(null);
                await reload();
              });
            }}
          >
            Crear carpeta
          </Button>
          <label
            className={`inline-flex items-center rounded border px-3 py-1.5 text-sm ${
              schemaPending || !parentId ? "cursor-not-allowed opacity-50" : "cursor-pointer"
            }`}
          >
            Subir COA
            <input
              type="file"
              accept=".pdf,.xls,.xlsx"
              className="hidden"
              disabled={schemaPending || !parentId}
              data-testid="coa-upload"
              onChange={(e) => {
                const file = e.target.files?.[0];
                e.target.value = "";
                if (!file || !parentId) {
                  setError("Entrá a una carpeta antes de subir.");
                  return;
                }
                const existing = files.find(
                  (f) => f.name.toLowerCase() === file.name.toLowerCase()
                );
                const fd = new FormData();
                fd.set("action", "upload");
                fd.set("folderId", parentId);
                fd.set("file", file);
                if (existing) fd.set("replaceFileId", existing.id);
                setUploadProgress(`Subiendo ${file.name}…`);
                setError(null);
                void fetch("/api/v1/coa", {
                  method: "POST",
                  headers: headers(),
                  body: fd,
                }).then(async (r) => {
                  const b = (await r.json()) as {
                    error?: string;
                    schemaPending?: boolean;
                    file?: CoaFileRecord;
                  };
                  setUploadProgress(null);
                  if (!r.ok) {
                    setError(b.error ?? "Upload falló");
                    if (b.schemaPending) setSchemaPending(true);
                    return;
                  }
                  setUploadProgress(
                    existing
                      ? `Versión ${(b.file?.currentVersion ?? 0)} guardada.`
                      : "Archivo subido correctamente."
                  );
                  await reload();
                });
              }}
            />
          </label>
        </div>
      ) : (
        <p className="text-xs text-[var(--os-text-muted)]">Solo lectura / descarga.</p>
      )}

      <ul className="divide-y rounded border">
        {filteredFolders.map((f) => (
          <li key={f.id} className="flex items-center gap-2 px-3 py-2 text-sm">
            <button
              type="button"
              className="flex-1 text-left hover:underline"
              onClick={() => {
                setParentId(f.id);
                setStack((s) => [...s, { id: f.id, name: f.name }]);
                setDetail(null);
              }}
            >
              📁 {f.name}
            </button>
            {canAdmin && !schemaPending ? (
              <>
                <button
                  type="button"
                  className="text-xs underline"
                  onClick={() => {
                    setRenameTarget(f);
                    setRenameName(f.name);
                  }}
                >
                  Renombrar
                </button>
                <button
                  type="button"
                  className="text-xs text-rose-700 underline"
                  onClick={() => setDeleteTarget(f)}
                >
                  Eliminar
                </button>
              </>
            ) : null}
          </li>
        ))}
        {filteredFiles.map((f) => (
          <li key={f.id} className="flex items-center justify-between gap-2 px-3 py-2 text-sm">
            <button type="button" className="text-left hover:underline" onClick={() => void openFile(f)}>
              {f.name} · v{f.currentVersion} · {(f.sizeBytes / 1024).toFixed(1)} KB
            </button>
            <button
              type="button"
              className="text-xs underline"
              onClick={() => void downloadVersion(f.id)}
            >
              Descargar
            </button>
          </li>
        ))}
        {filteredFolders.length === 0 && filteredFiles.length === 0 ? (
          <li className="px-3 py-4 text-sm text-[var(--os-text-muted)]">Vacío.</li>
        ) : null}
      </ul>

      {detail ? (
        <div className="space-y-2 rounded border p-3" data-testid="coa-file-detail">
          <h4 className="font-semibold">{detail.file.name}</h4>
          <p className="text-xs text-[var(--os-text-muted)]">
            MIME: {detail.file.mimeType} · Tamaño: {(detail.file.sizeBytes / 1024).toFixed(1)} KB ·
            Actualizado por {detail.file.updatedBy} ·{" "}
            {new Date(detail.file.updatedAt).toLocaleString("es-AR")}
          </p>
          {detail.file.mimeType === "application/pdf" && pdfUrl ? (
            <iframe
              title="Vista PDF"
              src={pdfUrl}
              className="h-[480px] w-full rounded border"
              data-testid="coa-pdf-preview"
            />
          ) : null}
          {detail.file.mimeType !== "application/pdf" ? (
            <p className="text-sm">
              Excel/CSV: usá Descargar. Vista previa dedicada solo para PDF.
            </p>
          ) : null}
          <h5 className="text-sm font-medium">Versiones</h5>
          <ul className="space-y-1 text-xs">
            {detail.versions.map((v) => (
              <li key={v.id} className="flex flex-wrap gap-2">
                <span>
                  v{v.version} · {(v.sizeBytes / 1024).toFixed(1)} KB · {v.uploadedBy} ·{" "}
                  {new Date(v.createdAt).toLocaleString("es-AR")}
                </span>
                <button
                  type="button"
                  className="underline"
                  onClick={() => void downloadVersion(detail.file.id, v.version)}
                >
                  Descargar
                </button>
                {detail.file.mimeType === "application/pdf" ? (
                  <button
                    type="button"
                    className="underline"
                    onClick={() => void previewPdf(detail.file.id, v.version)}
                  >
                    Ver
                  </button>
                ) : null}
              </li>
            ))}
          </ul>
          <Button type="button" variant="secondary" onClick={() => setDetail(null)}>
            Cerrar
          </Button>
        </div>
      ) : null}

      <p className="text-[11px] text-[var(--os-text-muted)]">
        Binarios en Drive (`GOOGLE_DRIVE_COAS_FOLDER_ID`). No usa la carpeta de fórmulas. Credenciales
        solo en servidor.
      </p>

      {renameTarget ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
          <div className="w-full max-w-sm rounded bg-[var(--os-surface,#fff)] p-4 shadow">
            <h3 className="mb-2 font-semibold">Renombrar carpeta</h3>
            <input
              className="mb-3 w-full rounded border px-2 py-1.5 text-sm"
              value={renameName}
              onChange={(e) => setRenameName(e.target.value)}
            />
            <div className="flex justify-end gap-2">
              <Button type="button" variant="secondary" onClick={() => setRenameTarget(null)}>
                Cancelar
              </Button>
              <Button
                type="button"
                onClick={() => {
                  void fetch("/api/v1/coa", {
                    method: "POST",
                    headers: { ...headers(), "Content-Type": "application/json" },
                    body: JSON.stringify({
                      action: "rename_folder",
                      folderId: renameTarget.id,
                      name: renameName,
                    }),
                  }).then(async (r) => {
                    const b = (await r.json()) as { error?: string };
                    if (!r.ok) {
                      setError(b.error ?? "No se pudo renombrar");
                      return;
                    }
                    setRenameTarget(null);
                    await reload();
                  });
                }}
              >
                Guardar
              </Button>
            </div>
          </div>
        </div>
      ) : null}

      <ConfirmDialog
        open={Boolean(deleteTarget)}
        onOpenChange={(o) => !o && setDeleteTarget(null)}
        title="¿Eliminar carpeta?"
        description="Solo carpetas vacías. Queda auditado (actor/fecha). Se mueve a papelera en Drive."
        confirmLabel="Eliminar"
        variant="destructive"
        onConfirm={() => {
          if (!deleteTarget) return;
          void fetch("/api/v1/coa", {
            method: "POST",
            headers: { ...headers(), "Content-Type": "application/json" },
            body: JSON.stringify({
              action: "delete_folder",
              folderId: deleteTarget.id,
            }),
          }).then(async (r) => {
            const b = (await r.json()) as { error?: string };
            if (!r.ok) {
              setError(b.error ?? "No se pudo eliminar");
              setDeleteTarget(null);
              return;
            }
            setDeleteTarget(null);
            await reload();
          });
        }}
      />
    </div>
  );
}
