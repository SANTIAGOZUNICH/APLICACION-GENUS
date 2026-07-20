"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { FilePlus2, Search } from "lucide-react";
import { usePreviewSession } from "@/features/os/session/preview-context";
import { TwinShell } from "@/features/os/shell/twin-shell";
import { UploadDocumentDialog } from "../components/upload-document-dialog";
import {
  OperationalTable,
  StatusChip,
  type OperationalTableColumn,
} from "../components/operational-ui";
import { listDocumentsByKind } from "../adapters/order-documents-repository";
import { canOrderDocumentAction } from "../lib/order-documents-rbac";
import { canOrderAction } from "@/lib/orders/rbac";
import {
  createOrderApi,
  fetchOrderTemplates,
  fetchOrders,
} from "@/lib/orders/orders-client";
import type {
  OperationalOrderRecord,
  OrderDocType,
  OrderStatus,
  OrderTemplateRecord,
} from "@/lib/orders/types";
import type { SectorId } from "@/types/operational/sector";
import { useRequiredWorkspace } from "@/features/os/workspace/workspace-provider";
import { CreateOrderDialog } from "../components/create-order-dialog";
import { OperationalOrderEditor } from "../components/operational-order-editor";
import { Button } from "@/components/ui/button";

type TabKey = "pendientes" | "completas";

interface NativeOrdersListProps {
  type: OrderDocType;
  /** Para OA: sector de envasado embebido. */
  oaSector?: Extract<SectorId, "ENVASADO_MASIVO" | "ENVASADO_PREMIUM">;
  readOnly?: boolean;
  embedded?: boolean;
  title?: string;
}

export function NativeOrdersListView({
  type,
  oaSector,
  readOnly = false,
  embedded = false,
  title,
}: NativeOrdersListProps) {
  const workspace = useRequiredWorkspace();
  const { sectorId, email } = usePreviewSession();
  const session = useMemo(
    () => ({ email: email ?? "", sector: sectorId }),
    [email, sectorId]
  );

  const [tab, setTab] = useState<TabKey>("pendientes");
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState<OrderStatus | "">("");
  const [year, setYear] = useState("");
  const [month, setMonth] = useState("");
  const [sort, setSort] = useState("fecha_desc");
  const [page, setPage] = useState(1);
  const [items, setItems] = useState<OperationalOrderRecord[]>([]);
  const [pendingCount, setPendingCount] = useState(0);
  const [completeCount, setCompleteCount] = useState(0);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [dbUnavailable, setDbUnavailable] = useState(false);
  const [createOpen, setCreateOpen] = useState(false);
  const [templates, setTemplates] = useState<OrderTemplateRecord[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [histOpen, setHistOpen] = useState(false);
  const [refreshTick, setRefreshTick] = useState(0);

  const canCreate = canOrderAction(type, "create", sectorId);
  const canUploadHistorical = canOrderDocumentAction(type, "upload", sectorId);

  const load = useCallback(async () => {
    if (!session.email) return;
    setLoading(true);
    setError(null);
    try {
      const result = await fetchOrders(session, {
        type,
        tab,
        search: search || undefined,
        status: status || undefined,
        assignedSector: type === "OA" ? oaSector : undefined,
        year: year ? Number(year) : undefined,
        month: month ? Number(month) : undefined,
        sort: sort as never,
        page,
        pageSize: 25,
      });
      setItems(result.items);
      setPendingCount(result.pendingCount);
      setCompleteCount(result.completeCount);
      setTotal(result.total);
      setDbUnavailable(false);
    } catch (err) {
      const code = (err as { code?: string }).code;
      if (code === "DATABASE_UNAVAILABLE" || (err as { status?: number }).status === 503) {
        setDbUnavailable(true);
        setItems([]);
        setError(
          "Persistencia Neon no configurada en este entorno. Las órdenes legales no usan localStorage."
        );
      } else {
        setError(err instanceof Error ? err.message : "Error al cargar órdenes.");
      }
    } finally {
      setLoading(false);
    }
  }, [session, type, tab, search, status, oaSector, year, month, sort, page]);

  useEffect(() => {
    void load();
  }, [load, refreshTick]);

  useEffect(() => {
    if (!canCreate || !session.email) return;
    void fetchOrderTemplates(session, type)
      .then(setTemplates)
      .catch(() => setTemplates([]));
  }, [canCreate, session, type]);

  const historicalDocs = useMemo(() => listDocumentsByKind(type), [type, refreshTick]);

  const columns: OperationalTableColumn<OperationalOrderRecord>[] = [
    {
      key: "orderNumber",
      header: "Número",
      render: (r) => <span className="font-mono text-xs">{r.orderNumber}</span>,
    },
    {
      key: "createdAt",
      header: "Fecha",
      render: (r) => new Date(r.createdAt).toLocaleDateString("es-AR"),
    },
    { key: "product", header: "Producto", render: (r) => r.product },
    { key: "client", header: "Cliente", render: (r) => r.client },
    { key: "code", header: "Código", render: (r) => r.code || "—" },
    { key: "lot", header: "Lote", render: (r) => r.lot || "—" },
    {
      key: "assignedSector",
      header: "Sector",
      render: (r) => <span className="text-xs">{r.assignedSector}</span>,
    },
    {
      key: "status",
      header: "Estado",
      render: (r) => <StatusChip status={r.status} />,
    },
    {
      key: "completion",
      header: "%",
      render: (r) => <span className="text-xs">{r.completionPercentage}%</span>,
    },
    {
      key: "actions",
      header: "Acciones",
      render: (r) => (
        <button
          type="button"
          className="text-xs font-medium text-[var(--os-teal)] hover:underline"
          onClick={() => setSelectedId(r.id)}
        >
          Abrir
        </button>
      ),
    },
  ];

  const heading =
    title ??
    (type === "OE" ? "Órdenes de Elaboración" : "Órdenes de Acondicionamiento");

  const content = (
    <div className="space-y-4">
      <header className="space-y-2">
        <h2 className="text-2xl font-semibold tracking-tight">{heading}</h2>
        <p className="text-sm text-[var(--os-text-muted)]">
          {workspace.sectorLabel} · {workspace.context.jobTitle}
        </p>
      </header>

      {dbUnavailable && (
        <div className="rounded border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-950">
          <strong>No legalmente operativo en este entorno:</strong> falta{" "}
          <code>DATABASE_URL</code> (Neon). El modelo, APIs y UI están preparados; no se
          simula sincronización con localStorage.
        </div>
      )}

      {error && !dbUnavailable && (
        <div className="rounded border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-900">
          {error}
        </div>
      )}

      <div className="flex flex-wrap items-center gap-2 border-b border-[var(--os-border)] pb-2">
        <button
          type="button"
          onClick={() => {
            setTab("pendientes");
            setPage(1);
          }}
          className={`rounded px-3 py-1.5 text-sm ${
            tab === "pendientes"
              ? "bg-[var(--os-teal)] text-white"
              : "bg-[var(--os-surface)] text-[var(--os-text)]"
          }`}
        >
          Pendientes ({pendingCount})
        </button>
        <button
          type="button"
          onClick={() => {
            setTab("completas");
            setPage(1);
          }}
          className={`rounded px-3 py-1.5 text-sm ${
            tab === "completas"
              ? "bg-[var(--os-teal)] text-white"
              : "bg-[var(--os-surface)] text-[var(--os-text)]"
          }`}
        >
          Completas ({completeCount})
        </button>
        <div className="ml-auto flex flex-wrap items-center gap-2">
          {canCreate && !readOnly && (
            <Button type="button" onClick={() => setCreateOpen(true)} disabled={dbUnavailable}>
              <FilePlus2 className="mr-1.5 size-4" />
              {type === "OE" ? "Crear Orden de Elaboración" : "Crear Orden de Acondicionamiento"}
            </Button>
          )}
        </div>
      </div>

      <div className="flex flex-wrap items-end gap-2">
        <label className="flex min-w-[200px] flex-1 flex-col gap-1 text-xs">
          <span className="text-[var(--os-text-muted)]">Buscar</span>
          <div className="relative">
            <Search className="absolute left-2 top-2.5 size-3.5 text-[var(--os-text-muted)]" />
            <input
              value={search}
              onChange={(e) => {
                setSearch(e.target.value);
                setPage(1);
              }}
              placeholder="Número, producto, código, cliente, lote…"
              className="w-full rounded border border-[var(--os-border)] bg-[var(--os-surface)] py-2 pl-8 pr-3 text-sm"
            />
          </div>
        </label>
        <label className="flex flex-col gap-1 text-xs">
          <span className="text-[var(--os-text-muted)]">Estado</span>
          <select
            value={status}
            onChange={(e) => setStatus(e.target.value as OrderStatus | "")}
            className="rounded border border-[var(--os-border)] bg-[var(--os-surface)] px-2 py-2 text-sm"
          >
            <option value="">Todos</option>
            {[
              "BORRADOR",
              "PENDIENTE",
              "EN_PROCESO",
              "COMPLETA",
              "DEVUELTA_PARA_CORRECCION",
              "ANULADA",
              "ARCHIVADA",
            ].map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-1 text-xs">
          <span className="text-[var(--os-text-muted)]">Mes</span>
          <select
            value={month}
            onChange={(e) => setMonth(e.target.value)}
            className="rounded border border-[var(--os-border)] bg-[var(--os-surface)] px-2 py-2 text-sm"
          >
            <option value="">—</option>
            {Array.from({ length: 12 }, (_, i) => (
              <option key={i + 1} value={String(i + 1)}>
                {i + 1}
              </option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-1 text-xs">
          <span className="text-[var(--os-text-muted)]">Año</span>
          <input
            value={year}
            onChange={(e) => setYear(e.target.value)}
            placeholder="2026"
            className="w-20 rounded border border-[var(--os-border)] bg-[var(--os-surface)] px-2 py-2 text-sm"
          />
        </label>
        <label className="flex flex-col gap-1 text-xs">
          <span className="text-[var(--os-text-muted)]">Ordenar</span>
          <select
            value={sort}
            onChange={(e) => setSort(e.target.value)}
            className="rounded border border-[var(--os-border)] bg-[var(--os-surface)] px-2 py-2 text-sm"
          >
            <option value="fecha_desc">Fecha más reciente</option>
            <option value="fecha_asc">Fecha más antigua</option>
            <option value="producto">Producto</option>
            <option value="numero">Número de orden</option>
            <option value="entrega_desc">Fecha de entrega</option>
          </select>
        </label>
      </div>

      {selectedId ? (
        <OperationalOrderEditor
          orderId={selectedId}
          onClose={() => {
            setSelectedId(null);
            setRefreshTick((v) => v + 1);
          }}
        />
      ) : (
        <>
          <OperationalTable
            columns={columns}
            rows={items}
            rowKey={(r) => r.id}
            emptyMessage={
              loading ? "Cargando…" : "Sin órdenes para mostrar en esta pestaña."
            }
          />
          <div className="flex items-center justify-between text-xs text-[var(--os-text-muted)]">
            <span>
              {total} resultado{total === 1 ? "" : "s"}
            </span>
            <div className="flex gap-2">
              <button
                type="button"
                disabled={page <= 1}
                onClick={() => setPage((p) => Math.max(1, p - 1))}
                className="rounded border px-2 py-1 disabled:opacity-40"
              >
                Anterior
              </button>
              <span>Pág. {page}</span>
              <button
                type="button"
                disabled={page * 25 >= total}
                onClick={() => setPage((p) => p + 1)}
                className="rounded border px-2 py-1 disabled:opacity-40"
              >
                Siguiente
              </button>
            </div>
          </div>
        </>
      )}

      <section className="rounded border border-[var(--os-border)] bg-[var(--os-surface)]">
        <button
          type="button"
          className="flex w-full items-center justify-between px-4 py-3 text-left text-sm font-medium"
          onClick={() => setHistOpen((v) => !v)}
        >
          Documentos anteriores / Archivos históricos
          <span className="text-xs text-[var(--os-text-muted)]">
            {historicalDocs.length} archivo{historicalDocs.length === 1 ? "" : "s"} · solo este
            navegador
          </span>
        </button>
        {histOpen && (
          <div className="space-y-3 border-t border-[var(--os-border)] px-4 py-3">
            <p className="text-xs text-[var(--os-text-muted)]">
              Cargas previas conservadas. No son el flujo principal ni documentación legal
              compartida.
            </p>
            {canUploadHistorical && (
              <UploadDocumentDialog
                kind={type}
                refOptions={historicalDocs.map((d) => d.ref)}
                uploadedBy={workspace.context.displayName}
                canUpload={canUploadHistorical}
                actorSectorId={sectorId}
                onUploaded={() => setRefreshTick((v) => v + 1)}
              />
            )}
            <ul className="space-y-1 text-xs">
              {historicalDocs.length === 0 && (
                <li className="text-[var(--os-text-muted)]">Sin archivos históricos.</li>
              )}
              {historicalDocs.map((d) => (
                <li key={d.id} className="flex flex-wrap gap-2">
                  <span className="font-mono">{d.ref}</span>
                  <span>{d.fileName}</span>
                  <span className="text-[var(--os-text-muted)]">
                    v{d.version} · {new Date(d.uploadedAt).toLocaleDateString("es-AR")}
                  </span>
                </li>
              ))}
            </ul>
          </div>
        )}
      </section>

      <CreateOrderDialog
        open={createOpen}
        onOpenChange={setCreateOpen}
        type={type}
        templates={templates}
        defaultSector={
          type === "OE" ? "ELABORACION" : oaSector ?? "ENVASADO_MASIVO"
        }
        onCreate={async (input) => {
          const order = await createOrderApi(session, input);
          setCreateOpen(false);
          setSelectedId(order.id);
          setRefreshTick((v) => v + 1);
        }}
      />
    </div>
  );

  if (embedded) return content;
  return <TwinShell title={heading}>{content}</TwinShell>;
}
