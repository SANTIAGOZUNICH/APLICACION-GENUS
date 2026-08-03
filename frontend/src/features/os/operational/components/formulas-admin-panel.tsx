"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Archive, RotateCcw, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { OperationalTable, type OperationalTableColumn } from "./operational-ui";
import type { FormulaAdminEntry } from "@/lib/formulas/formula-bank-service";
import {
  fetchFormulaAdminEntriesApi,
  mutateFormulaAdminApi,
} from "@/lib/formulas/formulas-client";
import type { OrdersClientSession } from "@/lib/orders/orders-client";
import { canManageFormulas } from "@/lib/formulas/formula-admin-rbac";
import { normalizeOptionalReason } from "@/lib/lifecycle";

type PendingAction = {
  action: "archive" | "restore" | "delete";
  entry: FormulaAdminEntry;
};

interface FormulasAdminPanelProps {
  session: OrdersClientSession;
  sectorId: string;
  /** Panel colapsable dentro de otra vista. */
  collapsible?: boolean;
}

export function FormulasAdminPanel({
  session,
  sectorId,
  collapsible = true,
}: FormulasAdminPanelProps) {
  const canManage = canManageFormulas(sectorId as never);
  const [open, setOpen] = useState(!collapsible);
  const [entries, setEntries] = useState<FormulaAdminEntry[]>([]);
  const [includeArchived, setIncludeArchived] = useState(false);
  const [query, setQuery] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState<PendingAction | null>(null);
  const [reason, setReason] = useState("");

  const reload = useCallback(async () => {
    if (!canManage || !session.email) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetchFormulaAdminEntriesApi(session, {
        q: query.trim() || undefined,
        includeArchived,
        limit: 300,
      });
      setEntries(res.entries);
    } catch (e) {
      setError(e instanceof Error ? e.message : "No se pudo cargar el banco.");
    } finally {
      setBusy(false);
    }
  }, [canManage, session, query, includeArchived]);

  useEffect(() => {
    if (open && canManage) void reload();
  }, [open, canManage, reload]);

  const columns = useMemo((): OperationalTableColumn<FormulaAdminEntry>[] => {
    return [
      { key: "client", header: "Cliente", render: (r) => r.client },
      { key: "product", header: "Producto", render: (r) => r.productLabel },
      { key: "code", header: "Código", render: (r) => r.code || "—" },
      {
        key: "status",
        header: "Estado",
        render: (r) => (r.archived ? "Archivada" : "Activa"),
      },
      {
        key: "versions",
        header: "Versiones",
        render: (r) => String(r.versionCount),
      },
      {
        key: "actions",
        header: "",
        render: (r) => (
          <div className="flex flex-wrap gap-1">
            {!r.archived ? (
              <Button
                type="button"
                size="sm"
                variant="secondary"
                disabled={busy}
                data-testid={`formula-archive-${r.productId}`}
                onClick={() => {
                  setReason("");
                  setPending({ action: "archive", entry: r });
                }}
              >
                <Archive className="mr-1 h-3.5 w-3.5" />
                Archivar
              </Button>
            ) : (
              <Button
                type="button"
                size="sm"
                variant="secondary"
                disabled={busy}
                data-testid={`formula-restore-${r.productId}`}
                onClick={() => {
                  setReason("");
                  setPending({ action: "restore", entry: r });
                }}
              >
                <RotateCcw className="mr-1 h-3.5 w-3.5" />
                Restaurar
              </Button>
            )}
            <Button
              type="button"
              size="sm"
              variant="destructive"
              disabled={busy}
              data-testid={`formula-delete-${r.productId}`}
              onClick={() => {
                setReason("");
                setPending({ action: "delete", entry: r });
              }}
            >
              <Trash2 className="mr-1 h-3.5 w-3.5" />
              Eliminar
            </Button>
          </div>
        ),
      },
    ];
  }, [busy]);

  const confirmLabel =
    pending?.action === "archive"
      ? "Archivar fórmula"
      : pending?.action === "restore"
        ? "Restaurar fórmula"
        : "Eliminar definitivamente";

  const confirmDescription =
    pending?.action === "delete"
      ? "Solo se elimina si nunca fue usada en OE, OA o Control MP. Las órdenes históricas conservan su snapshot."
      : pending?.action === "archive"
        ? "La fórmula dejará de aparecer en selectores de OE. Las órdenes existentes mantienen su snapshot."
        : "La fórmula volverá a estar disponible en selectores de OE.";

  async function confirmAction() {
    if (!pending) return;
    setBusy(true);
    setError(null);
    try {
      await mutateFormulaAdminApi(session, {
        action: pending.action,
        productId: pending.entry.productId,
        reason: normalizeOptionalReason(reason),
        actorSectorId: sectorId,
      });
      setPending(null);
      setReason("");
      await reload();
    } catch (e) {
      const err = e as Error & {
        usageRefs?: Array<{ kind: string; label: string }>;
      };
      if (err.usageRefs?.length) {
        const refs = err.usageRefs.map((u) => `${u.kind}: ${u.label}`).join("; ");
        setError(`${err.message} Referencias: ${refs}`);
      } else {
        setError(err.message);
      }
    } finally {
      setBusy(false);
    }
  }

  if (!canManage) return null;

  const body = (
    <div className="space-y-3 p-4">
      {error && (
        <div
          className="rounded border border-red-300 bg-red-50 px-3 py-2 text-sm text-red-900"
          data-testid="formulas-admin-error"
        >
          {error}
        </div>
      )}
      <div className="flex flex-wrap items-center gap-2">
        <input
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Buscar cliente o producto…"
          className="rounded border px-2 py-1 text-sm"
          data-testid="formulas-admin-search"
        />
        <label className="flex items-center gap-1 text-xs text-muted-foreground">
          <input
            type="checkbox"
            checked={includeArchived}
            onChange={(e) => setIncludeArchived(e.target.checked)}
            data-testid="formulas-admin-include-archived"
          />
          Ver archivadas
        </label>
        <Button size="sm" variant="secondary" disabled={busy} onClick={() => void reload()}>
          Actualizar
        </Button>
      </div>
      <OperationalTable
        columns={columns}
        rows={entries}
        rowKey={(r) => r.productId}
        emptyMessage="Sin fórmulas en el catálogo activo."
        data-testid="formulas-admin-table"
      />
      <p className="text-xs text-muted-foreground">
        Listado administrativo: no muestra ingredientes ni porcentajes. Archivar desactiva
        activeVersionId; restaurar la reactiva.
      </p>
    </div>
  );

  return (
    <section
      className="rounded border border-[var(--os-border)] bg-[var(--os-surface)]"
      data-testid="formulas-admin-panel"
    >
      {collapsible ? (
        <>
          <button
            type="button"
            className="flex w-full items-center justify-between px-4 py-3 text-left text-sm font-medium"
            onClick={() => setOpen((v) => !v)}
          >
            Administración de fórmulas
            <span className="text-xs text-muted-foreground">{open ? "▾" : "▸"}</span>
          </button>
          {open ? body : null}
        </>
      ) : (
        <>
          <div className="border-b px-4 py-3 text-sm font-medium">Administración de fórmulas</div>
          {body}
        </>
      )}

      <Dialog open={Boolean(pending)} onOpenChange={(v) => !v && setPending(null)}>
        <DialogContent data-testid="formulas-admin-confirm">
          <DialogHeader>
            <DialogTitle>{confirmLabel}</DialogTitle>
            <DialogDescription>
              {pending ? (
                <>
                  <strong>{pending.entry.client}</strong> — {pending.entry.productLabel}
                  <br />
                  {confirmDescription}
                </>
              ) : null}
            </DialogDescription>
          </DialogHeader>
          <label className="block space-y-1 text-sm">
            <span>Motivo (opcional)</span>
            <textarea
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              className="min-h-[80px] w-full rounded border px-2 py-1"
              data-testid="formulas-admin-reason"
              placeholder="Si no informás motivo, se registrará “Sin motivo informado”."
            />
          </label>
          <DialogFooter>
            <Button type="button" variant="secondary" onClick={() => setPending(null)}>
              Cancelar
            </Button>
            <Button
              type="button"
              variant={pending?.action === "delete" ? "destructive" : "primary"}
              disabled={busy}
              data-testid="formulas-admin-confirm-btn"
              onClick={() => void confirmAction()}
            >
              {confirmLabel}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </section>
  );
}
