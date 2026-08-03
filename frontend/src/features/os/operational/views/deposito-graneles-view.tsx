"use client";

import { useMemo, useState } from "react";
import { TwinShell } from "@/features/os/shell/twin-shell";
import { usePreviewContext, usePreviewSession } from "@/features/os/session/preview-context";
import { Button } from "@/components/ui/button";
import { displayField } from "@/lib/operational/display-fields";
import {
  createManualGranel,
  deleteOrAnnulGranel,
  listGranelRemainders,
  updateGranel,
  type GranelRemainderRecord,
} from "../adapters/graneles-repository";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

/**
 * Depósito Graneles — sobrantes de granel independientes de MP/ME.
 * Persistencia local (Neon 0014 diferida).
 */
export function DepositoGranelesView() {
  const { sectorId, email } = usePreviewSession();
  const { showToast } = usePreviewContext();
  const [tick, setTick] = useState(0);
  const [q, setQ] = useState("");
  const [statusFilter, setStatusFilter] = useState("TODOS");
  const [createOpen, setCreateOpen] = useState(false);
  const [edit, setEdit] = useState<GranelRemainderRecord | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<GranelRemainderRecord | null>(null);
  const [reason, setReason] = useState("");

  const [form, setForm] = useState({
    product: "",
    client: "",
    bulkLot: "",
    kg: "",
    intakeDate: new Date().toISOString().slice(0, 10),
    location: "",
    observation: "",
  });

  const canEdit = sectorId === "DEPOSITO";
  const items = useMemo(() => {
    void tick;
    return listGranelRemainders({ includeAnnulled: true });
  }, [tick]);

  const filtered = useMemo(() => {
    const qq = q.trim().toLowerCase();
    return items.filter((i) => {
      if (statusFilter !== "TODOS" && i.status !== statusFilter) return false;
      if (!qq) return true;
      return [i.product, i.client, i.bulkLot, i.reportedBy, i.originSector]
        .join(" ")
        .toLowerCase()
        .includes(qq);
    });
  }, [items, q, statusFilter]);

  function refresh() {
    setTick((t) => t + 1);
  }

  function submitCreate() {
    const kg = Number.parseFloat(form.kg.replace(",", "."));
    if (!Number.isFinite(kg) || kg < 0) {
      showToast("Indicá kg válidos.");
      return;
    }
    const result = createManualGranel({
      actorSector: sectorId,
      actorName: email ?? "Depósito",
      product: form.product,
      client: form.client,
      bulkLot: form.bulkLot,
      kg,
      intakeDate: form.intakeDate,
      location: form.location,
      observation: form.observation,
      asDraft: !form.product.trim() && !form.client.trim(),
    });
    if (!result.ok) {
      showToast(result.error);
      return;
    }
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
    refresh();
    showToast("Sobrante registrado.");
  }

  function submitEdit() {
    if (!edit) return;
    const result = updateGranel({
      id: edit.id,
      actorSector: sectorId,
      actorName: email ?? "Depósito",
      patch: {
        product: edit.product,
        client: edit.client,
        bulkLot: edit.bulkLot,
        kgAvailable: edit.kgAvailable,
        intakeDate: edit.intakeDate,
        location: edit.location,
        observation: edit.observation,
      },
    });
    if (!result.ok) {
      showToast(result.error);
      return;
    }
    setEdit(null);
    refresh();
    showToast("Sobrante actualizado.");
  }

  function submitDelete() {
    if (!deleteTarget) return;
    const result = deleteOrAnnulGranel({
      id: deleteTarget.id,
      actorSector: sectorId,
      actorName: email ?? "Depósito",
      reason,
    });
    if (!result.ok) {
      showToast(result.error);
      return;
    }
    showToast(result.action === "eliminar" ? "Eliminado." : "Anulado.");
    setDeleteTarget(null);
    setReason("");
    refresh();
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

      <div className="mb-3 flex flex-wrap gap-2">
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Buscar producto, cliente, lote…"
          className="min-w-[12rem] flex-1 rounded border px-3 py-2 text-sm"
        />
        <select
          value={statusFilter}
          onChange={(e) => setStatusFilter(e.target.value)}
          className="rounded border px-3 py-2 text-sm"
        >
          <option value="TODOS">Todos</option>
          <option value="BORRADOR">Borrador</option>
          <option value="DISPONIBLE">Disponible</option>
          <option value="AGOTADO">Agotado</option>
          <option value="ANULADO">Anulado</option>
          <option value="ARCHIVADO">Archivado</option>
        </select>
      </div>

      {filtered.length === 0 ? (
        <p className="text-sm text-[var(--os-text-muted)]">Sin registros de granel.</p>
      ) : (
        <>
          <div className="hidden overflow-x-hidden md:block">
            <table className="os-table w-full max-w-full table-fixed text-sm" data-testid="graneles-table">
              <thead>
                <tr className="text-left text-xs uppercase text-[var(--os-text-muted)]">
                  <th className="w-[18%] py-2">Producto</th>
                  <th className="w-[14%] py-2">Cliente</th>
                  <th className="w-[12%] py-2">Lote granel</th>
                  <th className="w-[10%] py-2">Kg</th>
                  <th className="w-[12%] py-2">Ingreso</th>
                  <th className="w-[12%] py-2">Origen</th>
                  <th className="w-[10%] py-2">Estado</th>
                  <th className="w-[12%] py-2">Acciones</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((row) => (
                  <tr key={row.id} className="border-t border-[var(--os-border)]">
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
            <Button variant="secondary" onClick={() => setCreateOpen(false)}>
              Cancelar
            </Button>
            <Button onClick={submitCreate}>Guardar</Button>
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
            <Button variant="secondary" onClick={() => setEdit(null)}>
              Cerrar
            </Button>
            {canEdit ? <Button onClick={submitEdit}>Guardar</Button> : null}
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={Boolean(deleteTarget)} onOpenChange={(o) => !o && setDeleteTarget(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Eliminar / anular sobrante</DialogTitle>
          </DialogHeader>
          <p className="text-sm">
            Motivo obligatorio. Los originados en Envasado se anulan con auditoría (no hard-delete
            inseguro).
          </p>
          <textarea
            className="w-full rounded border px-3 py-2 text-sm"
            rows={3}
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            placeholder="Motivo…"
          />
          <DialogFooter>
            <Button variant="secondary" onClick={() => setDeleteTarget(null)}>
              Cancelar
            </Button>
            <Button variant="destructive" onClick={submitDelete}>
              Confirmar
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </TwinShell>
  );
}
