"use client";

import { useCallback, useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { usePreviewSession } from "@/features/os/session/preview-context";
import {
  ACTOR_EMAIL_HEADER,
  ACTOR_SECTOR_HEADER,
} from "@/lib/orders/actor";
import { canAdminCoas, canViewCoas, type CoaFileRecord, type CoaFolderRecord } from "@/lib/coa/types";

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
  const [newFolder, setNewFolder] = useState("");
  const [q, setQ] = useState("");

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
    };
    if (!res.ok) throw new Error(body.error ?? "Error COA");
    setFolders(body.folders ?? []);
    setFiles(body.files ?? []);
  }, [canView, parentId, headers]);

  useEffect(() => {
    void reload().catch((e) => setError(e instanceof Error ? e.message : "Error"));
  }, [reload]);

  if (!canView) {
    return (
      <p className="text-sm text-[var(--os-text-muted)]">
        Tu sector no tiene acceso a COA’S.
      </p>
    );
  }

  const filteredFolders = folders.filter((f) =>
    !q || f.name.toLowerCase().includes(q.toLowerCase())
  );
  const filteredFiles = files.filter((f) =>
    !q || f.name.toLowerCase().includes(q.toLowerCase())
  );

  return (
    <div className="space-y-3" data-testid="mp-coas-panel">
      {error ? (
        <p className="rounded border border-amber-300 bg-amber-50 px-3 py-2 text-sm" role="alert">
          {error}
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
          />
          <Button
            type="button"
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
                if (!r.ok) {
                  const b = (await r.json()) as { error?: string };
                  setError(b.error ?? "No se pudo crear carpeta");
                  return;
                }
                setNewFolder("");
                await reload();
              });
            }}
          >
            Crear carpeta
          </Button>
          <label className="inline-flex cursor-pointer items-center rounded border px-3 py-1.5 text-sm">
            Subir archivo
            <input
              type="file"
              accept=".pdf,.xls,.xlsx,.csv"
              className="hidden"
              onChange={(e) => {
                const file = e.target.files?.[0];
                if (!file || !parentId) {
                  setError("Entrá a una carpeta antes de subir.");
                  return;
                }
                const fd = new FormData();
                fd.set("action", "upload");
                fd.set("folderId", parentId);
                fd.set("file", file);
                void fetch("/api/v1/coa", {
                  method: "POST",
                  headers: headers(),
                  body: fd,
                }).then(async (r) => {
                  if (!r.ok) {
                    const b = (await r.json()) as { error?: string };
                    setError(b.error ?? "Upload falló");
                    return;
                  }
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
          <li key={f.id}>
            <button
              type="button"
              className="w-full px-3 py-2 text-left text-sm hover:bg-[var(--os-bg-muted)]"
              onClick={() => {
                setParentId(f.id);
                setStack((s) => [...s, { id: f.id, name: f.name }]);
              }}
            >
              📁 {f.name}
            </button>
          </li>
        ))}
        {filteredFiles.map((f) => (
          <li key={f.id} className="flex items-center justify-between px-3 py-2 text-sm">
            <span>
              {f.name} · v{f.currentVersion} · {(f.sizeBytes / 1024).toFixed(1)} KB ·{" "}
              {f.mimeType}
            </span>
            <span className="text-[11px] text-[var(--os-text-muted)]">
              {f.updatedBy} · {new Date(f.updatedAt).toLocaleString("es-AR")}
            </span>
          </li>
        ))}
        {filteredFolders.length === 0 && filteredFiles.length === 0 ? (
          <li className="px-3 py-4 text-sm text-[var(--os-text-muted)]">Vacío.</li>
        ) : null}
      </ul>
      <p className="text-[11px] text-[var(--os-text-muted)]">
        Binarios en Drive (`GOOGLE_DRIVE_COAS_FOLDER_ID`). No usa la carpeta de fórmulas.
      </p>
    </div>
  );
}
