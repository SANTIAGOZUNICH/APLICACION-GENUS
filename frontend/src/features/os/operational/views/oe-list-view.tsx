"use client";

import { useMemo, useState } from "react";
import { Download, Eye } from "lucide-react";
import { displayField } from "@/lib/operational/display-fields";
import { usePreviewContext } from "@/features/os/session/preview-context";
import { TwinShell } from "@/features/os/shell/twin-shell";
import { UploadDocumentDialog } from "../components/upload-document-dialog";
import {
  OperationalTable,
  StatusChip,
  SyncStatusBar,
  type OperationalTableColumn,
} from "../components/operational-ui";
import { useOperationalPlan } from "../hooks/use-operational-plan";
import { mergeManualWorkItems } from "../adapters/manual-work-items-repository";
import { getLatestDocumentByRef } from "../adapters/order-documents-repository";
import { useRequiredWorkspace } from "@/features/os/workspace/workspace-provider";

interface OeRow {
  ref: string;
  fecha: string | null;
  cliente: string | null;
  producto: string | null;
  cantidad: string;
  responsable: string | null;
  estado: string;
  workItemId: string;
}

interface OeListViewProps {
  readOnly?: boolean;
  /** true cuando se embebe dentro de otra pantalla que ya provee el TwinShell (ej. Producción). */
  embedded?: boolean;
}

/** Listado de Órdenes de Elaboración — carga, visualización y relación con trabajo. */
export function OeListView({ readOnly = false, embedded = false }: OeListViewProps = {}) {
  const workspace = useRequiredWorkspace();
  const { openOe } = usePreviewContext();
  const { data, loading, error, lastRefreshAt, updatedAgoLabel, liveConnected } =
    useOperationalPlan("ELABORACION");
  const [search, setSearch] = useState("");
  const [refreshTick, setRefreshTick] = useState(0);

  const rows = useMemo<OeRow[]>(() => {
    const items = mergeManualWorkItems("ELABORACION", data?.workItems ?? []);
    const byRef = new Map<string, OeRow>();
    for (const item of items) {
      if (!item.oeRef) continue;
      if (!byRef.has(item.oeRef)) {
        byRef.set(item.oeRef, {
          ref: item.oeRef,
          fecha: item.plannedDate ?? item.dayLabel ?? item.date,
          cliente: item.client,
          producto: item.product,
          cantidad: [item.quantity, item.unit ?? "kg"].filter(Boolean).join(" "),
          responsable: item.ownerPerson,
          estado: item.status,
          workItemId: item.id,
        });
      }
    }
    return [...byRef.values()].filter((row) => {
      if (!search.trim()) return true;
      const q = search.trim().toLowerCase();
      return (
        row.ref.toLowerCase().includes(q) ||
        (row.cliente ?? "").toLowerCase().includes(q) ||
        (row.producto ?? "").toLowerCase().includes(q)
      );
    });
  }, [data?.workItems, search]);

  const refOptions = useMemo(() => rows.map((r) => r.ref), [rows]);

  const columns: OperationalTableColumn<OeRow>[] = [
    { key: "ref", header: "Número", render: (r) => <span className="font-mono text-xs">{r.ref}</span> },
    { key: "fecha", header: "Fecha", render: (r) => displayField(r.fecha) },
    { key: "cliente", header: "Cliente", render: (r) => displayField(r.cliente) },
    { key: "producto", header: "Producto", render: (r) => displayField(r.producto) },
    { key: "cantidad", header: "Cantidad", render: (r) => r.cantidad || "—" },
    { key: "responsable", header: "Responsable", render: (r) => displayField(r.responsable) },
    { key: "estado", header: "Estado", render: (r) => <StatusChip status={r.estado} /> },
    {
      key: "archivo",
      header: "Archivo",
      render: (r) => {
        const doc = getLatestDocumentByRef(r.ref);
        if (!doc) return <span className="text-xs text-[var(--os-text-muted)]">Sin archivo</span>;
        return (
          <div className="flex items-center gap-2">
            <a
              href={doc.fileDataUrl}
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center gap-1 text-xs text-[var(--os-teal)] hover:underline"
              aria-label={`Ver ${doc.fileName}`}
            >
              <Eye className="size-3.5" aria-hidden="true" />
              Ver
            </a>
            <a
              href={doc.fileDataUrl}
              download={doc.fileName}
              className="inline-flex items-center gap-1 text-xs text-[var(--os-teal)] hover:underline"
              aria-label={`Descargar ${doc.fileName}`}
            >
              <Download className="size-3.5" aria-hidden="true" />
              Descargar
            </a>
          </div>
        );
      },
    },
    {
      key: "carga",
      header: "Carga",
      render: (r) => {
        const doc = getLatestDocumentByRef(r.ref);
        if (!doc) return <span className="text-xs text-[var(--os-text-muted)]">—</span>;
        return (
          <span className="text-xs text-[var(--os-text-muted)]">
            {new Date(doc.uploadedAt).toLocaleDateString("es-AR")} · {doc.uploadedBy}
          </span>
        );
      },
    },
    {
      key: "acciones",
      header: "Acciones",
      render: (r) => (
        <button
          type="button"
          onClick={() => openOe(r.ref, r.workItemId)}
          className="text-xs font-medium text-[var(--os-teal)] hover:underline"
        >
          Ver trabajo
        </button>
      ),
    },
  ];

  const content = (
    <div className="space-y-4">
      <header className="space-y-2">
        <h2 className="text-2xl font-semibold tracking-tight">Órdenes de Elaboración</h2>
        <p className="text-sm text-[var(--os-text-muted)]">
          {workspace.sectorLabel} · {workspace.context.jobTitle}
        </p>
        <SyncStatusBar
          source={data?.source ?? "demo"}
          lastRefreshAt={lastRefreshAt}
          updatedAgoLabel={updatedAgoLabel}
          liveConnected={liveConnected}
          loading={loading}
          detailMessage={data?.source === "native" ? null : data?.message}
        />
      </header>

      {error && (
        <div className="rounded border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-900">
          {error}
        </div>
      )}

      <div className="flex flex-wrap items-center justify-between gap-3">
        <input
          type="search"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Buscar por número, cliente o producto…"
          aria-label="Buscar orden de elaboración"
          className="w-full max-w-xs rounded-[var(--os-radius-sm)] border border-[var(--os-border)] bg-[var(--os-surface)] px-3 py-2 text-sm"
        />
        {!readOnly && refOptions.length > 0 && (
          <UploadDocumentDialog
            kind="OE"
            refOptions={refOptions}
            uploadedBy={workspace.context.displayName}
            onUploaded={() => setRefreshTick((v) => v + 1)}
          />
        )}
      </div>

      <div key={refreshTick}>
        <OperationalTable
          columns={columns}
          rows={rows}
          rowKey={(r) => r.ref}
          emptyMessage="Sin órdenes de elaboración para mostrar."
        />
      </div>
    </div>
  );

  if (embedded) return content;
  return <TwinShell title="Órdenes de Elaboración">{content}</TwinShell>;
}
