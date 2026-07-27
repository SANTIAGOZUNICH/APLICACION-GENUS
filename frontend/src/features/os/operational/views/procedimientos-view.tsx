"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { TwinShell } from "@/features/os/shell/twin-shell";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/dialog";
import { SchemaPendingBanner } from "@/components/ui/schema-pending-banner";
import { usePreviewSession } from "@/features/os/session/preview-context";
import {
  fetchProcedimientosApi,
  procedimientoDownloadHeaders,
  procedimientoDownloadUrl,
  procedimientosActionApi,
  searchProcedimientosApi,
  uploadProcedimientoFileApi,
} from "@/lib/procedimientos/procedimientos-client";
import {
  canAccessProcedimientos,
  type ProcedureFileRecord,
  type ProcedureFolderRecord,
} from "@/lib/procedimientos/types";
import { PROCEDURE_ALLOWED_EXT } from "@/lib/procedimientos/upload-validation";

type Breadcrumb = { id: string | null; name: string };

type PendingUpload = {
  file: File;
  relativePath: string;
  status: "pending" | "uploading" | "done" | "error";
  error?: string;
};

type FolderPreview = {
  folderName: string;
  subfolderCount: number;
  fileCount: number;
  totalBytes: number;
  rejected: { name: string; reason: string }[];
  uploads: PendingUpload[];
};

const MIME_FILTERS = [
  { id: "all", label: "Todos" },
  { id: "pdf", label: "PDF" },
  { id: "image", label: "Imágenes" },
  { id: "doc", label: "Documentos" },
  { id: "sheet", label: "Planillas" },
  { id: "zip", label: "ZIP" },
];

function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}

function isAllowedFile(name: string): boolean {
  const ext = name.split(".").pop()?.toLowerCase() ?? "";
  return PROCEDURE_ALLOWED_EXT.has(ext);
}

export function ProcedimientosView() {
  const { email, sectorId } = usePreviewSession();
  const session = useMemo(
    () => ({ email: email ?? "", sector: sectorId }),
    [email, sectorId]
  );

  const [parentId, setParentId] = useState<string | null>(null);
  const [breadcrumb, setBreadcrumb] = useState<Breadcrumb[]>([{ id: null, name: "Raíz" }]);
  const [folders, setFolders] = useState<ProcedureFolderRecord[]>([]);
  const [files, setFiles] = useState<ProcedureFileRecord[]>([]);
  const [q, setQ] = useState("");
  const [mimeFilter, setMimeFilter] = useState("all");
  const [schemaPending, setSchemaPending] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [newFolderName, setNewFolderName] = useState("");
  const [showNewFolder, setShowNewFolder] = useState(false);
  const [folderPreview, setFolderPreview] = useState<FolderPreview | null>(null);
  const [uploadProgress, setUploadProgress] = useState<{ done: number; total: number } | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<{ type: "file" | "folder"; id: string; name: string } | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const folderInputRef = useRef<HTMLInputElement>(null);
  const dropRef = useRef<HTMLDivElement>(null);

  const reload = useCallback(async () => {
    try {
      const data = q.trim()
        ? await searchProcedimientosApi(session, q, mimeFilter === "all" ? undefined : mimeFilter)
        : await fetchProcedimientosApi(session, parentId, {
            mimeFilter: mimeFilter === "all" ? undefined : mimeFilter,
          });
      setFolders(data.folders);
      setFiles(data.files);
      setSchemaPending(data.schemaPending);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Error al cargar");
    }
  }, [session, parentId, q, mimeFilter]);

  useEffect(() => {
    void reload();
  }, [reload]);

  if (!canAccessProcedimientos(sectorId)) {
    return (
      <TwinShell title="Procedimientos">
        <p className="text-sm text-muted-foreground">Sin acceso a Procedimientos para este sector.</p>
      </TwinShell>
    );
  }

  function navigateToFolder(folder: ProcedureFolderRecord) {
    setParentId(folder.id);
    setBreadcrumb((prev) => [...prev, { id: folder.id, name: folder.name }]);
    setQ("");
  }

  function navigateBreadcrumb(index: number) {
    const crumb = breadcrumb[index];
    setParentId(crumb.id);
    setBreadcrumb(breadcrumb.slice(0, index + 1));
    setQ("");
  }

  async function handleCreateFolder() {
    if (!newFolderName.trim()) return;
    setBusy(true);
    try {
      await procedimientosActionApi(session, "mkdir", {
        name: newFolderName.trim(),
        parentId,
      });
      setNewFolderName("");
      setShowNewFolder(false);
      await reload();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Error al crear carpeta");
    } finally {
      setBusy(false);
    }
  }

  function buildFolderPreview(fileList: FileList | File[]): FolderPreview | null {
    const arr = Array.from(fileList);
    if (arr.length === 0) return null;

    const first = arr[0];
    const webkitPath = (first as File & { webkitRelativePath?: string }).webkitRelativePath ?? "";
    const rootName = webkitPath.split("/")[0] || "Carpeta";

    const subfolders = new Set<string>();
    const rejected: { name: string; reason: string }[] = [];
    const uploads: PendingUpload[] = [];
    let totalBytes = 0;

    for (const f of arr) {
      const rel = (f as File & { webkitRelativePath?: string }).webkitRelativePath ?? f.name;
      const parts = rel.split("/");
      if (parts.length > 1) subfolders.add(parts.slice(0, -1).join("/"));
      if (!isAllowedFile(f.name)) {
        rejected.push({ name: rel, reason: "Extensión no permitida" });
        continue;
      }
      totalBytes += f.size;
      uploads.push({ file: f, relativePath: rel, status: "pending" });
    }

    return {
      folderName: rootName,
      subfolderCount: subfolders.size,
      fileCount: uploads.length,
      totalBytes,
      rejected,
      uploads,
    };
  }

  function onFolderInputChange(e: React.ChangeEvent<HTMLInputElement>) {
    if (!e.target.files?.length) return;
    const preview = buildFolderPreview(e.target.files);
    if (preview) setFolderPreview(preview);
    e.target.value = "";
  }

  function onFileInputChange(e: React.ChangeEvent<HTMLInputElement>) {
    const list = e.target.files;
    if (!list?.length || !parentId) return;
    const preview = buildFolderPreview(list);
    if (preview) {
      preview.folderName = "Archivos sueltos";
      setFolderPreview(preview);
    }
    e.target.value = "";
  }

  function onDrop(e: React.DragEvent) {
    e.preventDefault();
    if (schemaPending) return;
    const items = e.dataTransfer.files;
    if (items.length) {
      const preview = buildFolderPreview(items);
      if (preview) setFolderPreview(preview);
    }
  }

  async function confirmFolderUpload() {
    if (!folderPreview) return;
    if (schemaPending) {
      setError("Base de datos pendiente de actualización");
      return;
    }
    setBusy(true);
    const total = folderPreview.uploads.length;
    setUploadProgress({ done: 0, total });
    const updated = [...folderPreview.uploads];
    const folderCache = new Map<string, string>();

    async function resolveTargetFolder(relativePath: string): Promise<string> {
      const parts = relativePath.replace(/\\/g, "/").split("/").filter(Boolean);
      const dirParts = parts.slice(0, -1); // drop filename
      const key = dirParts.join("/") || "__root__";
      const cached = folderCache.get(key);
      if (cached) return cached;
      if (dirParts.length === 0) {
        if (!parentId) {
          throw new Error("Creá o abrí una carpeta destino, o subí una carpeta con subcarpetas.");
        }
        folderCache.set(key, parentId);
        return parentId;
      }
      const result = (await procedimientosActionApi(session, "ensure_path", {
        parentId,
        segments: dirParts,
      })) as { folder?: { id: string } };
      const id = result.folder?.id;
      if (!id) throw new Error(`No se pudo crear ruta ${dirParts.join("/")}`);
      folderCache.set(key, id);
      return id;
    }

    for (let i = 0; i < updated.length; i++) {
      const u = updated[i];
      if (u.status === "done") continue;
      updated[i] = { ...u, status: "uploading" };
      setFolderPreview({ ...folderPreview, uploads: [...updated] });
      try {
        const folderId = await resolveTargetFolder(u.relativePath);
        await uploadProcedimientoFileApi(session, {
          folderId,
          file: u.file,
          relativePath: u.relativePath,
        });
        updated[i] = { ...u, status: "done" };
        setUploadProgress({ done: i + 1, total });
      } catch (err) {
        updated[i] = {
          ...u,
          status: "error",
          error: err instanceof Error ? err.message : "Error",
        };
      }
      setFolderPreview({ ...folderPreview, uploads: [...updated] });
    }

    setBusy(false);
    setUploadProgress(null);
    if (updated.every((u) => u.status === "done")) {
      setFolderPreview(null);
      await reload();
    }
  }

  async function retryFailedUploads() {
    if (!folderPreview) return;
    const failed = folderPreview.uploads.filter((u) => u.status === "error");
    setFolderPreview({
      ...folderPreview,
      uploads: folderPreview.uploads.map((u) =>
        u.status === "error" ? { ...u, status: "pending", error: undefined } : u
      ),
    });
    await confirmFolderUpload();
    void failed;
  }

  async function handleDelete() {
    if (!confirmDelete) return;
    setBusy(true);
    try {
      await procedimientosActionApi(
        session,
        confirmDelete.type === "file" ? "delete_file" : "delete_folder",
        confirmDelete.type === "file"
          ? { fileId: confirmDelete.id }
          : { folderId: confirmDelete.id }
      );
      setConfirmDelete(null);
      await reload();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Error al eliminar");
    } finally {
      setBusy(false);
    }
  }

  function openPreview(file: ProcedureFileRecord) {
    if (file.mime === "application/pdf" || file.mime.startsWith("image/")) {
      void loadPreview(file);
    }
  }

  async function loadPreview(file: ProcedureFileRecord) {
    const url = procedimientoDownloadUrl(session, file.id, undefined, true);
    const res = await fetch(url, { headers: procedimientoDownloadHeaders(session) });
    if (!res.ok) {
      setError("No se pudo previsualizar el archivo");
      return;
    }
    const blob = await res.blob();
    if (previewUrl) URL.revokeObjectURL(previewUrl);
    setPreviewUrl(URL.createObjectURL(blob));
  }

  async function downloadFile(file: ProcedureFileRecord) {
    const url = procedimientoDownloadUrl(session, file.id);
    const res = await fetch(url, { headers: procedimientoDownloadHeaders(session) });
    if (!res.ok) return;
    const blob = await res.blob();
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = file.displayName;
    a.click();
    URL.revokeObjectURL(a.href);
  }

  return (
    <TwinShell title="Procedimientos">
      <div className="space-y-4">
        <SchemaPendingBanner show={schemaPending} />
        {error && (
          <div className="rounded border border-red-300 bg-red-50 px-3 py-2 text-sm text-red-900">
            {error}
          </div>
        )}

        <div className="flex flex-wrap items-center gap-2">
          <input
            type="search"
            placeholder="Buscar..."
            value={q}
            onChange={(e) => setQ(e.target.value)}
            className="rounded border px-2 py-1 text-sm"
            data-testid="procedimientos-search"
          />
          <select
            value={mimeFilter}
            onChange={(e) => setMimeFilter(e.target.value)}
            className="rounded border px-2 py-1 text-sm"
          >
            {MIME_FILTERS.map((f) => (
              <option key={f.id} value={f.id}>
                {f.label}
              </option>
            ))}
          </select>
          <Button
            size="sm"
            disabled={busy || schemaPending}
            onClick={() => setShowNewFolder(true)}
            data-testid="procedimientos-new-folder"
          >
            Nueva carpeta
          </Button>
          <Button
            size="sm"
            variant="secondary"
            disabled={busy || schemaPending || !parentId}
            onClick={() => fileInputRef.current?.click()}
          >
            Subir archivos
          </Button>
          <Button
            size="sm"
            variant="secondary"
            disabled={busy || schemaPending}
            onClick={() => folderInputRef.current?.click()}
            data-testid="procedimientos-upload-folder"
          >
            SUBIR CARPETA
          </Button>
          <input
            ref={fileInputRef}
            type="file"
            multiple
            className="hidden"
            onChange={onFileInputChange}
          />
          <input
            ref={folderInputRef}
            type="file"
            // @ts-expect-error webkitdirectory non-standard
            webkitdirectory=""
            multiple
            className="hidden"
            onChange={onFolderInputChange}
          />
        </div>

        <nav className="flex flex-wrap gap-1 text-sm text-muted-foreground">
          {breadcrumb.map((c, i) => (
            <span key={c.id ?? "root"}>
              {i > 0 && " / "}
              <button
                type="button"
                className="hover:underline"
                onClick={() => navigateBreadcrumb(i)}
              >
                {c.name}
              </button>
            </span>
          ))}
        </nav>

        <div
          ref={dropRef}
          onDragOver={(e) => e.preventDefault()}
          onDrop={onDrop}
          className="min-h-[200px] rounded border border-dashed p-4"
          data-testid="procedimientos-dropzone"
        >
          {folders.length === 0 && files.length === 0 && !q && (
            <p className="text-sm text-muted-foreground">
              Arrastrá archivos o carpetas aquí, o usá los botones de arriba.
            </p>
          )}
          <ul className="space-y-1">
            {folders.map((f) => (
              <li key={f.id} className="flex items-center justify-between rounded px-2 py-1 hover:bg-muted/50">
                <button type="button" className="text-left text-sm font-medium" onClick={() => navigateToFolder(f)}>
                  📁 {f.name}
                </button>
                <div className="flex gap-1">
                  <Button
                    size="sm"
                    variant="tertiary"
                    disabled={busy || schemaPending}
                    onClick={() => setConfirmDelete({ type: "folder", id: f.id, name: f.name })}
                  >
                    Eliminar
                  </Button>
                </div>
              </li>
            ))}
            {files.map((f) => (
              <li key={f.id} className="flex items-center justify-between rounded px-2 py-1 hover:bg-muted/50">
                <span className="text-sm">
                  📄 {f.displayName}{" "}
                  <span className="text-muted-foreground">({formatBytes(f.sizeBytes)})</span>
                </span>
                <div className="flex gap-1">
                  {(f.mime === "application/pdf" || f.mime.startsWith("image/")) && (
                    <Button size="sm" variant="tertiary" onClick={() => openPreview(f)}>
                      Vista previa
                    </Button>
                  )}
                  <Button size="sm" variant="tertiary" onClick={() => void downloadFile(f)}>
                    Descargar
                  </Button>
                  <Button
                    size="sm"
                    variant="tertiary"
                    disabled={busy || schemaPending}
                    onClick={() => setConfirmDelete({ type: "file", id: f.id, name: f.displayName })}
                  >
                    Eliminar
                  </Button>
                </div>
              </li>
            ))}
          </ul>
        </div>

        {showNewFolder && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
            <div className="w-full max-w-md rounded bg-background p-4 shadow-lg">
              <h3 className="mb-2 font-medium">Nueva carpeta</h3>
              <input
                value={newFolderName}
                onChange={(e) => setNewFolderName(e.target.value)}
                className="mb-3 w-full rounded border px-2 py-1"
                placeholder="Nombre"
              />
              <div className="flex justify-end gap-2">
                <Button variant="secondary" onClick={() => setShowNewFolder(false)}>
                  Cancelar
                </Button>
                <Button disabled={busy || schemaPending} onClick={() => void handleCreateFolder()}>
                  Crear
                </Button>
              </div>
            </div>
          </div>
        )}

        {folderPreview && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
            <div className="max-h-[80vh] w-full max-w-lg overflow-auto rounded bg-background p-4 shadow-lg">
              <h3 className="mb-2 font-medium">Confirmar carga: {folderPreview.folderName}</h3>
              <ul className="mb-3 space-y-1 text-sm">
                <li>Subcarpetas: {folderPreview.subfolderCount}</li>
                <li>Archivos: {folderPreview.fileCount}</li>
                <li>Tamaño total: {formatBytes(folderPreview.totalBytes)}</li>
                {folderPreview.rejected.length > 0 && (
                  <li className="text-amber-700">
                    Rechazados: {folderPreview.rejected.length}
                    <ul className="ml-4 list-disc">
                      {folderPreview.rejected.slice(0, 5).map((r) => (
                        <li key={r.name}>
                          {r.name}: {r.reason}
                        </li>
                      ))}
                    </ul>
                  </li>
                )}
              </ul>
              {uploadProgress && (
                <p className="mb-2 text-sm">
                  Progreso: {uploadProgress.done}/{uploadProgress.total}
                </p>
              )}
              <div className="flex justify-end gap-2">
                <Button variant="secondary" onClick={() => setFolderPreview(null)} disabled={busy}>
                  Cancelar
                </Button>
                {folderPreview.uploads.some((u) => u.status === "error") && (
                  <Button variant="secondary" onClick={() => void retryFailedUploads()} disabled={busy}>
                    Reintentar fallidos
                  </Button>
                )}
                <Button disabled={busy || schemaPending || folderPreview.fileCount === 0} onClick={() => void confirmFolderUpload()}>
                  Confirmar
                </Button>
              </div>
            </div>
          </div>
        )}

        {previewUrl && (
          <div className="fixed inset-0 z-50 flex flex-col bg-black/80">
            <div className="flex justify-end p-2">
              <Button variant="secondary" onClick={() => { if (previewUrl) URL.revokeObjectURL(previewUrl); setPreviewUrl(null); }}>
                Cerrar
              </Button>
            </div>
            <iframe src={previewUrl} className="flex-1 bg-white" title="Vista previa" />
          </div>
        )}

        <ConfirmDialog
          open={Boolean(confirmDelete)}
          onOpenChange={(open) => {
            if (!open) setConfirmDelete(null);
          }}
          title="Confirmar eliminación"
          description={`¿Eliminar "${confirmDelete?.name}"? Esta acción no se puede deshacer.`}
          confirmLabel="Eliminar"
          onConfirm={() => void handleDelete()}
          onCancel={() => setConfirmDelete(null)}
        />
      </div>
    </TwinShell>
  );
}
