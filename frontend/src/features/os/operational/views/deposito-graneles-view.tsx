"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { TwinShell } from "@/features/os/shell/twin-shell";
import { usePreviewContext, usePreviewSession } from "@/features/os/session/preview-context";
import { Button } from "@/components/ui/button";
import { displayField } from "@/lib/operational/display-fields";
import {
  bulkDeleteConfirmMessage,
  ListSelectionEnterButton,
  ListSelectionToolbar,
  SelectionCheckbox,
  selectedRowClassName,
  useListSelectionMode,
} from "../components/list-selection-mode";
import {
  createManualGranelApi,
  deleteOrAnnulGranelApi,
  fetchGranelesApi,
  updateGranelApi,
} from "@/lib/graneles/graneles-client";
import type { GranelRemainderRecord, GranelStatus } from "@/lib/graneles/types";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { SortSelect } from "../components/sort-select";
import { useSortPreference } from "../lib/use-sort-preference";
import {
  applySort,
  compareDates,
  compareNumbers,
  compareStrings,
  type SortOption,
} from "@/lib/sorting/sort-contract";

type StatusFilter = "ACTIVOS" | "TODOS" | GranelStatus;

export const GRANELES_SORT_OPTIONS: SortOption<GranelRemainderRecord>[] = [
  { key: "ingreso_desc", label: "Más recientes", compare: (a, b) => compareDates(a.intakeDate, b.intakeDate, "desc") },
  { key: "ingreso_asc", label: "Más antiguos", compare: (a, b) => compareDates(a.intakeDate, b.intakeDate, "asc") },
  { key: "producto_asc", label: "Producto A-Z", compare: (a, b) => compareStrings(a.product, b.product, "asc") },
  { key: "producto_desc", label: "Producto Z-A", compare: (a, b) => compareStrings(a.product, b.product, "desc") },
  { key: "cliente_asc", label: "Cliente A-Z", compare: (a, b) => compareStrings(a.client, b.client, "asc") },
  { key: "kg_desc", label: "Kg mayor a menor", compare: (a, b) => compareNumbers(a.kgAvailable, b.kgAvailable, "desc") },
  { key: "kg_asc", label: "Kg menor a mayor", compare: (a, b) => compareNumbers(a.kgAvailable, b.kgAvailable, "asc") },
];
const GRANELES_SORT_KEYS = GRANELES_SORT_OPTIONS.map((o) => o.key);

/**
 * Depósito Graneles — sobrantes de granel independientes de MP/ME.
 * Persistencia Neon (migración 0014) vía API autorizada.
 */
export function DepositoGranelesView() {
  const { sectorId, email } = usePreviewSession();
  const { showToast } = usePreviewContext();
  const session = useMemo(() => ({ email, sector: sectorId }), [email, sectorId]);
  const canEdit = sectorId === "DEPOSITO";

  const [items, setItems] = useState<GranelRemainderRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [offline, setOffline] = useState(false);
  const [q, setQ] = useState("");
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("ACTIVOS");
  const [createOpen, setCreateOpen] = useState(false);
  const [edit, setEdit] = useState<GranelRemainderRecord | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<GranelRemainderRecord | null>(null);
  const [bulkPending, setBulkPending] = useState(false);
  const [bulkBusy, setBulkBusy] = useState(false);
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);

  const [form, setForm] = useState({
    product: "",
    client: "",
    bulkLot: "",
    kg: "",
    intakeDate: new Date().toISOString().slice(0, 10),
    location: "",
    observation: "",
  });

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const filters =
        statusFilter === "ACTIVOS"
          ? {}
          : statusFilter === "TODOS"
            ? { includeAnnulled: true }
            : { status: statusFilter };
      const { items: fetched } = await fetchGranelesApi(session, filters);
      setItems(fetched);
      setOffline(false);
    } catch (err) {
      showToast(err instanceof Error ? err.message : "No se pudo cargar Depósito Graneles.", "info");
      setOffline(true);
    } finally {
      setLoading(false);
    }
  }, [session, statusFilter, showToast]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const [sort, setSort] = useSortPreference("deposito-graneles", "ingreso_desc", GRANELES_SORT_KEYS);
  const filtered = useMemo(() => {
    const qq = q.trim().toLowerCase();
    const base = !qq
      ? items
      : items.filter((i) =>
          [i.product, i.client, i.bulkLot, i.reportedBy, i.originSector ?? ""]
            .join(" ")
            .toLowerCase()
            .includes(qq)
        );
    return applySort(base, GRANELES_SORT_OPTIONS, sort);
  }, [items, q, sort]);

  const visibleIds = useMemo(() => filtered.map((r) => r.id), [filtered]);
  const sel = useListSelectionMode(visibleIds);

  async function submitCreate() {
    const kg = Number.parseFloat(form.kg.replace(",", "."));
    if (!Number.isFinite(kg) || kg < 0) {
      showToast("Indicá kg válidos.", "info");
      return;
    }
    setBusy(true);
    try {
      await createManualGranelApi(session, {
        product: form.product,
        client: form.client,
        bulkLot: form.bulkLot,
        kg,
        intakeDate: form.intakeDate,
        location: form.location,
        observation: form.observation,
        asDraft: !form.product.trim() && !form.client.trim(),
      });
      setCreateOpen(false);
      setForm({
        product: "",
        client: "",
        bulkLot: "",
        kg: "",
        intakeDate: new Date().toISOString().slice(0, 10),
        location: "",
        observation: "",
      });
      await refresh();
      showToast("Sobrante registrado.");
    } catch (err) {
      showToast(err instanceof Error ? err.message : "No se pudo registrar el sobrante.", "info");
    } finally {
      setBusy(false);
    }
  }

  async function submitEdit() {
    if (!edit) return;
    setBusy(true);
    try {
      await updateGranelApi(session, edit.id, {
        product: edit.product,
        client: edit.client,
        bulkLot: edit.bulkLot,
        kgAvailable: edit.kgAvailable,
        intakeDate: edit.intakeDate,
        location: edit.location,
        observation: edit.observation,
      });
      setEdit(null);
      await refresh();
      showToast("Sobrante actualizado.");
    } catch (err) {
      showToast(err instanceof Error ? err.message : "No se pudo actualizar.", "info");
    } finally {
      setBusy(false);
    }
  }

  async function submitDelete() {
    if (!deleteTarget) return;
    setBusy(true);
    try {
      const result = await deleteOrAnnulGranelApi(session, deleteTarget.id, reason);
      showToast(result.action === "eliminar" ? "Eliminado." : "Anulado.");
      setDeleteTarget(null);
      setReason("");
      await refresh();
    } catch (err) {
      showToast(err instanceof Error ? err.message : "No se pudo eliminar.", "info");
    } finally {
      setBusy(false);
    }
  }

  async function submitBulkDelete(bulkReason: string) {
    setBulkBusy(true);
    let ok = 0;
    let failed = 0;
    for (const id of sel.selectedIds) {
      try {
        await deleteOrAnnulGranelApi(session, id, bulkReason);
        ok += 1;
      } catch {
        failed += 1;
      }
    }
    setBulkPending(false);
    sel.cancel();
    setBulkBusy(false);
    await refresh();
    const parts = [`${ok} eliminado(s)/anulado(s)`];
    if (failed) parts.push(`${failed} error(es)`);
    showToast(parts.join(" · "));
  }

  return (
    <TwinShell title="Depósito Graneles">
      <header className="mb-4 flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 className="text-2xl font-semibold tracking-tight">Depósito Graneles</h2>
          <p className="text-sm text-[var(--os-text-muted)]">
            Sobrantes de granel · independiente de MP / ME
          </p>
        </div>
        {canEdit ? (
          <Button onClick={() => setCreateOpen(true)} data-testid="graneles-create">
            Nuevo sobrante
          </Button>
        ) : null}
      </header>

      <div className="mb-3 rounded-[var(--os-radius-sm)] border border-[var(--os-teal)]/40 bg-[var(--os-teal-soft)]/30 px-4 py-2 text-sm text-[var(--os-text)]">
        {offline ? "Sin conexión al servidor — reintentá recargar." : "Sincronizado con servidor (Neon)."}
      </div>

      <div className="mb-3 flex flex-wrap items-center gap-2">
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Buscar producto, cliente, lote…"
          className="min-w-[12rem] flex-1 rounded border px-3 py-2 text-sm"
        />
        <select
          value={statusFilter}
          onChange={(e) => setStatusFilter(e.target.value as StatusFilter)}
          className="rounded border px-3 py-2 text-sm"
        >
          <option value="ACTIVOS">Activos (sin anulados/archivados)</option>
          <option value="TODOS">Todos</option>
          <option value="BORRADOR">Borrador</option>
          <option value="DISPONIBLE">Disponible</option>
          <option value="AGOTADO">Agotado</option>
          <option value="ANULADO">Anulado</option>
          <option value="ARCHIVADO">Archivado</option>
        </select>
        <SortSelect value={sort} onChange={setSort} options={GRANELES_SORT_OPTIONS} testId="graneles-sort" />
        {canEdit &&
          (!sel.active ? (
            <ListSelectionEnterButton onClick={sel.enter} disabled={filtered.length === 0} />
          ) : (
            <ListSelectionToolbar
              selectedCount={sel.selectedCount}
              onSelectAll={sel.selectAllVisible}
              onDeselectAll={sel.deselectAll}
              onDelete={() => setBulkPending(true)}
              onCancel={sel.cancel}
              busy={bulkBusy}
              deleteLabel="Eliminar/anular seleccionados"
            />
          ))}
      </div>

      {loading ? (
        <p className="text-sm text-[var(--os-text-muted)]">Cargando…</p>
      ) : filtered.length === 0 ? (
        <p className="text-sm text-[var(--os-text-muted)]">Sin registros de granel.</p>
      ) : (
        <>
          <div className="hidden overflow-x-hidden md:block">
            <table className="os-table w-full max-w-full table-fixed text-sm" data-testid="graneles-table">
              <thead>
                <tr className="text-left text-xs uppercase text-[var(--os-text-muted)]">
                  {sel.active ? <th className="w-[4%] py-2" /> : null}
                  <th className="w-[16%] py-2">Producto</th>
                  <th className="w-[13%] py-2">Cliente</th>
                  <th className="w-[11%] py-2">Lote granel</th>
                  <th className="w-[9%] py-2">Kg</th>
                  <th className="w-[11%] py-2">Ingreso</th>
                  <th className="w-[11%] py-2">Origen</th>
                  <th className="w-[9%] py-2">Estado</th>
                  <th className="w-[16%] py-2">Acciones</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((row) => (
                  <tr
                    key={row.id}
                    className={`border-t border-[var(--os-border)] ${selectedRowClassName(sel.isSelected(row.id))}`}
                  >
                    {sel.active ? (
                      <td className="py-2">
                        <SelectionCheckbox
                          checked={sel.isSelected(row.id)}
                          onChange={() => sel.toggle(row.id)}
                          label={`Seleccionar ${row.product || row.id}`}
                        />
                      </td>
                    ) : null}
                    <td className="py-2">
                      <span className="line-clamp-2">{displayField(row.product || "—")}</span>
                    </td>
                    <td className="py-2">
                      <span className="line-clamp-2">{displayField(row.client || "—")}</span>
                    </td>
                    <td className="py-2">{displayField(row.bulkLot || "Sin lote")}</td>
                    <td className="py-2 tabular-nums">{row.kgAvailable}</td>
                    <td className="py-2">{row.intakeDate}</td>
                    <td className="py-2 text-xs">{row.originSector ?? "—"}</td>
                    <td className="py-2 text-xs">{row.status}</td>
                    <td className="py-2">
                      <div className="flex flex-wrap gap-1">
                        <Button size="sm" variant="secondary" onClick={() => setEdit({ ...row })}>
                          Abrir
                        </Button>
                        {canEdit ? (
                          <Button
                            size="sm"
                            variant="destructive"
                            onClick={() => {
                              setDeleteTarget(row);
                              setReason("");
                            }}
                          >
                            Eliminar
                          </Button>
                        ) : null}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="space-y-3 md:hidden">
            {filtered.map((row) => (
              <article
                key={row.id}
                className="rounded border border-[var(--os-border)] p-3 text-sm"
              >
                <p className="line-clamp-2 font-medium">{displayField(row.product || "—")}</p>
                <p className="line-clamp-2 text-[var(--os-text-muted)]">
                  {displayField(row.client || "—")}
                </p>
                <p className="mt-1 text-xs">
                  Lote granel {displayField(row.bulkLot || "Sin lote")} · {row.kgAvailable} kg ·{" "}
                  {row.status}
                </p>
                <div className="mt-2 flex gap-2">
                  <Button size="sm" variant="secondary" onClick={() => setEdit({ ...row })}>
                    Abrir
                  </Button>
                  {canEdit ? (
                    <Button
                      size="sm"
                      variant="destructive"
                      onClick={() => {
                        setDeleteTarget(row);
                        setReason("");
                      }}
                    >
                      Eliminar
                    </Button>
                  ) : null}
                </div>
              </article>
            ))}
          </div>
        </>
      )}

      <Dialog open={createOpen} onOpenChange={setCreateOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Nuevo sobrante de granel</DialogTitle>
          </DialogHeader>
          <div className="grid gap-2 text-sm">
            {(
              [
                ["product", "Producto"],
                ["client", "Cliente"],
                ["bulkLot", "Lote de granel"],
                ["kg", "Kg *"],
                ["intakeDate", "Fecha"],
                ["location", "Ubicación"],
                ["observation", "Observación"],
              ] as const
            ).map(([key, label]) => (
              <label key={key} className="block">
                {label}
                <input
                  className="mt-1 w-full rounded border px-3 py-2"
                  type={key === "intakeDate" ? "date" : "text"}
                  value={form[key]}
                  onChange={(e) => setForm((f) => ({ ...f, [key]: e.target.value }))}
                />
              </label>
            ))}
          </div>
          <DialogFooter>
            <Button variant="secondary" onClick={() => setCreateOpen(false)} disabled={busy}>
              Cancelar
            </Button>
            <Button onClick={() => void submitCreate()} disabled={busy}>
              Guardar
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={Boolean(edit)} onOpenChange={(o) => !o && setEdit(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Detalle sobrante</DialogTitle>
          </DialogHeader>
          {edit ? (
            <div className="grid gap-2 text-sm">
              <label>
                Producto
                <input
                  className="mt-1 w-full rounded border px-3 py-2"
                  value={edit.product}
                  disabled={!canEdit}
                  onChange={(e) => setEdit({ ...edit, product: e.target.value })}
                />
              </label>
              <label>
                Cliente
                <input
                  className="mt-1 w-full rounded border px-3 py-2"
                  value={edit.client}
                  disabled={!canEdit}
                  onChange={(e) => setEdit({ ...edit, client: e.target.value })}
                />
              </label>
              <label>
                Lote de granel
                <input
                  className="mt-1 w-full rounded border px-3 py-2"
                  value={edit.bulkLot}
                  disabled={!canEdit}
                  onChange={(e) => setEdit({ ...edit, bulkLot: e.target.value })}
                />
              </label>
              <label>
                Kg
                <input
                  className="mt-1 w-full rounded border px-3 py-2"
                  value={String(edit.kgAvailable)}
                  disabled={!canEdit}
                  onChange={(e) =>
                    setEdit({
                      ...edit,
                      kgAvailable: Number.parseFloat(e.target.value.replace(",", ".")) || 0,
                    })
                  }
                />
              </label>
              <label>
                Fecha
                <input
                  type="date"
                  className="mt-1 w-full rounded border px-3 py-2"
                  value={edit.intakeDate}
                  disabled={!canEdit}
                  onChange={(e) => setEdit({ ...edit, intakeDate: e.target.value })}
                />
              </label>
              <label>
                Ubicación
                <input
                  className="mt-1 w-full rounded border px-3 py-2"
                  value={edit.location}
                  disabled={!canEdit}
                  onChange={(e) => setEdit({ ...edit, location: e.target.value })}
                />
              </label>
              <label>
                Observación
                <textarea
                  className="mt-1 w-full rounded border px-3 py-2"
                  value={edit.observation}
                  disabled={!canEdit}
                  onChange={(e) => setEdit({ ...edit, observation: e.target.value })}
                />
              </label>
              <p className="text-xs text-[var(--os-text-muted)]">
                Responsable: {edit.reportedBy} · Origen: {edit.originSector ?? "—"}
              </p>
            </div>
          ) : null}
          <DialogFooter>
            <Button variant="secondary" onClick={() => setEdit(null)} disabled={busy}>
              Cerrar
            </Button>
            {canEdit ? (
              <Button onClick={() => void submitEdit()} disabled={busy}>
                Guardar
              </Button>
            ) : null}
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={Boolean(deleteTarget)} onOpenChange={(o) => !o && setDeleteTarget(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Eliminar / anular sobrante</DialogTitle>
          </DialogHeader>
          <p className="text-sm">
            Motivo opcional. Los originados en Envasado se anulan con auditoría (no hard-delete
            inseguro). Si no informás motivo, se registrará “Sin motivo informado”.
          </p>
          <textarea
            className="w-full rounded border px-3 py-2 text-sm"
            rows={3}
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            placeholder="Motivo (opcional)…"
          />
          <DialogFooter>
            <Button variant="secondary" onClick={() => setDeleteTarget(null)} disabled={busy}>
              Cancelar
            </Button>
            <Button variant="destructive" onClick={() => void submitDelete()} disabled={busy}>
              Confirmar
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={bulkPending} onOpenChange={(o) => !o && setBulkPending(false)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Eliminar / anular seleccionados</DialogTitle>
          </DialogHeader>
          <p className="text-sm">{bulkDeleteConfirmMessage(sel.selectedCount)}</p>
          <textarea
            className="w-full rounded border px-3 py-2 text-sm"
            rows={3}
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            placeholder="Motivo (opcional)…"
          />
          <DialogFooter>
            <Button variant="secondary" onClick={() => setBulkPending(false)} disabled={bulkBusy}>
              Cancelar
            </Button>
            <Button
              variant="destructive"
              onClick={() => void submitBulkDelete(reason)}
              disabled={bulkBusy}
            >
              Confirmar
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </TwinShell>
  );
}
