"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { TwinShell } from "@/features/os/shell/twin-shell";
import { useRequiredWorkspace } from "@/features/os/workspace/workspace-provider";
import {
  addDaysIso,
  todayInBuenosAires,
  weekStartMonday,
  workWeekDays,
  formatOperationalLongDate,
} from "@/lib/operational/operational-calendar";
import {
  createPlanningItem,
  createPlanningWeek,
  deletePlanningItem,
  getPlanningWeek,
  listPlanningWeeks,
  patchPlanningItem,
  publishPlanningWeek,
} from "@/lib/planning/planning-client";
import type {
  CreateWorkItemInput,
  PlanningSector,
  PlanningWeekRecord,
  PlanningWorkItemRecord,
} from "@/lib/planning/types";

const SECTORS: PlanningSector[] = [
  "ELABORACION",
  "ENVASADO_MASIVO",
  "ENVASADO_PREMIUM",
];

function emptyForm(weekStart: string): CreateWorkItemInput {
  return {
    plannedDate: weekStart,
    client: "",
    product: "",
    plannedQuantity: "",
    unit: "KG",
    sector: "ELABORACION",
    branchOwner: "Cristian",
    line: null,
    priority: "NORMAL",
    notes: "",
  };
}

/** Planificación nativa Producción — grilla funcional lun–vie (sin drag-and-drop). */
export function ProduccionPlanningView() {
  const workspace = useRequiredWorkspace();
  const actor = useMemo(
    () => ({
      email: workspace.context.email,
      sector: workspace.context.sectorId,
    }),
    [workspace.context.email, workspace.context.sectorId]
  );

  const [weekStart, setWeekStart] = useState(() =>
    weekStartMonday(todayInBuenosAires())
  );
  const [week, setWeek] = useState<PlanningWeekRecord | null>(null);
  const [items, setItems] = useState<PlanningWorkItemRecord[]>([]);
  const [form, setForm] = useState<CreateWorkItemInput>(() =>
    emptyForm(weekStartMonday(todayInBuenosAires()))
  );
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editVersion, setEditVersion] = useState(1);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  const days = useMemo(() => workWeekDays(weekStart), [weekStart]);
  const isDraft = week?.status === "DRAFT";

  const load = useCallback(async () => {
    setError(null);
    try {
      const weeks = await listPlanningWeeks(actor, weekStart);
      if (weeks[0]) {
        const detail = await getPlanningWeek(actor, weeks[0].id);
        setWeek(detail.week);
        setItems(detail.items);
      } else {
        setWeek(null);
        setItems([]);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Error al cargar semana.");
    }
  }, [actor, weekStart]);

  useEffect(() => {
    void load();
    if (!editingId) {
      setForm((prev) => ({ ...prev, plannedDate: weekStart }));
    }
  }, [load, weekStart, editingId]);

  const ensureWeek = async () => {
    if (week) return week;
    const created = await createPlanningWeek(actor, { weekStart });
    setWeek(created);
    setMessage("Semana creada en borrador.");
    return created;
  };

  const beginEdit = (item: PlanningWorkItemRecord) => {
    setEditingId(item.id);
    setEditVersion(item.version);
    setForm({
      plannedDate: item.plannedDate,
      client: item.client,
      product: item.product,
      plannedQuantity: item.plannedQuantity,
      unit: item.unit,
      sector: item.sector,
      branchOwner: item.branchOwner,
      line: item.line,
      priority: item.priority,
      notes: item.notes ?? "",
    });
    setMessage(null);
    setError(null);
  };

  const cancelEdit = () => {
    setEditingId(null);
    setForm(emptyForm(weekStart));
  };

  const onSaveItem = async () => {
    setBusy(true);
    setError(null);
    setMessage(null);
    try {
      const payload: CreateWorkItemInput = {
        ...form,
        line: form.sector === "ELABORACION" ? null : form.line,
        branchOwner: form.sector === "ELABORACION" ? form.branchOwner : null,
      };

      if (editingId) {
        await patchPlanningItem(actor, editingId, {
          version: editVersion,
          ...payload,
        });
        setMessage(
          week?.status === "PUBLISHED"
            ? "Trabajo reprogramado (evento registrado)."
            : "Trabajo actualizado."
        );
        setEditingId(null);
        setForm(emptyForm(weekStart));
      } else {
        const w = await ensureWeek();
        await createPlanningItem(actor, w.id, payload);
        setForm(emptyForm(weekStart));
        setMessage("Trabajo agregado al borrador.");
      }
      await load();
    } catch (err) {
      const e = err as Error & { status?: number; current?: { version?: number } };
      if (e.status === 409) {
        setError(
          "Conflicto de versión (otro usuario modificó el registro). Recargá la pantalla."
        );
        await load();
      } else {
        setError(e.message || "No se pudo guardar.");
      }
    } finally {
      setBusy(false);
    }
  };

  const onDelete = async (itemId: string) => {
    setBusy(true);
    setError(null);
    try {
      await deletePlanningItem(actor, itemId);
      if (editingId === itemId) cancelEdit();
      setMessage("Trabajo eliminado.");
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "No se pudo eliminar.");
    } finally {
      setBusy(false);
    }
  };

  const onPublish = async () => {
    if (!week) return;
    setBusy(true);
    setError(null);
    try {
      await publishPlanningWeek(actor, week.id);
      setMessage("Semana publicada. Los sectores ya pueden verla.");
      cancelEdit();
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "No se pudo publicar.");
    } finally {
      setBusy(false);
    }
  };

  const grouped = useMemo(() => {
    const byKey = (predicate: (i: PlanningWorkItemRecord) => boolean) =>
      items.filter(predicate);
    return {
      elaboracionCristian: byKey(
        (i) => i.sector === "ELABORACION" && i.branchOwner === "Cristian"
      ),
      elaboracionNicolas: byKey(
        (i) => i.sector === "ELABORACION" && i.branchOwner === "Nicolás"
      ),
      masivo: [1, 2, 3, 4].map((n) =>
        byKey((i) => i.sector === "ENVASADO_MASIVO" && i.line === `Línea ${n}`)
      ),
      premium: [1, 2].map((n) =>
        byKey((i) => i.sector === "ENVASADO_PREMIUM" && i.line === `Línea ${n}`)
      ),
    };
  }, [items]);

  return (
    <TwinShell title="Planificación Producción">
      <header className="mb-6 space-y-2">
        <h2 className="text-2xl font-semibold tracking-tight">
          Planificación nativa
        </h2>
        <p className="text-sm text-[var(--os-text-muted)]">
          Responsable: Agustina Zunich · Genus OS es la fuente de verdad (Preview)
        </p>
      </header>

      <div className="mb-6 flex flex-wrap items-end gap-3">
        <label className="text-sm">
          Semana (lunes)
          <input
            type="date"
            className="mt-1 block rounded border border-[var(--os-border)] bg-[var(--os-surface)] px-3 py-2"
            value={weekStart}
            onChange={(e) => {
              cancelEdit();
              setWeekStart(weekStartMonday(e.target.value));
            }}
          />
        </label>
        <button
          type="button"
          className="rounded bg-[var(--os-teal)] px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
          disabled={busy}
          onClick={() => void ensureWeek().then(load)}
        >
          Crear / abrir borrador
        </button>
        <button
          type="button"
          className="rounded border border-[var(--os-border)] px-4 py-2 text-sm disabled:opacity-50"
          disabled={busy || !week || week.status === "PUBLISHED"}
          onClick={() => void onPublish()}
        >
          Publicar semana
        </button>
        <p className="text-sm text-[var(--os-text-muted)]">
          Estado: <strong>{week?.status ?? "sin semana"}</strong>
          {week ? ` · v${week.version} · ${items.length} trabajos` : null}
        </p>
      </div>

      {error && (
        <div className="mb-4 rounded border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-900">
          {error}
        </div>
      )}
      {message && (
        <div className="mb-4 rounded border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-900">
          {message}
        </div>
      )}

      <section className="mb-8 rounded-[var(--os-radius)] border border-[var(--os-border)] bg-[var(--os-surface)] p-4">
        <h3 className="mb-3 text-sm font-semibold uppercase tracking-wide text-[var(--os-text-muted)]">
          {editingId ? "Editar / mover trabajo" : "Agregar trabajo"}
        </h3>
        <div className="grid gap-3 md:grid-cols-3">
          <label className="text-sm">
            Día
            <select
              className="mt-1 w-full rounded border border-[var(--os-border)] px-3 py-2"
              value={form.plannedDate}
              onChange={(e) => setForm({ ...form, plannedDate: e.target.value })}
            >
              {days.map((d) => (
                <option key={d} value={d}>
                  {formatOperationalLongDate(d)}
                </option>
              ))}
            </select>
          </label>
          <label className="text-sm">
            Sector
            <select
              className="mt-1 w-full rounded border border-[var(--os-border)] px-3 py-2"
              value={form.sector}
              onChange={(e) => {
                const sector = e.target.value as PlanningSector;
                setForm({
                  ...form,
                  sector,
                  branchOwner: sector === "ELABORACION" ? "Cristian" : null,
                  line: sector === "ELABORACION" ? null : "Línea 1",
                });
              }}
            >
              {SECTORS.map((s) => (
                <option key={s} value={s}>
                  {s}
                </option>
              ))}
            </select>
          </label>
          {form.sector === "ELABORACION" ? (
            <label className="text-sm">
              Rama
              <select
                className="mt-1 w-full rounded border border-[var(--os-border)] px-3 py-2"
                value={form.branchOwner ?? "Cristian"}
                onChange={(e) =>
                  setForm({ ...form, branchOwner: e.target.value })
                }
              >
                <option value="Cristian">Cristian</option>
                <option value="Nicolás">Nicolás</option>
              </select>
            </label>
          ) : (
            <label className="text-sm">
              Línea
              <select
                className="mt-1 w-full rounded border border-[var(--os-border)] px-3 py-2"
                value={form.line ?? "Línea 1"}
                onChange={(e) => setForm({ ...form, line: e.target.value })}
              >
                {(form.sector === "ENVASADO_PREMIUM"
                  ? ["Línea 1", "Línea 2"]
                  : ["Línea 1", "Línea 2", "Línea 3", "Línea 4"]
                ).map((l) => (
                  <option key={l} value={l}>
                    {l}
                  </option>
                ))}
              </select>
            </label>
          )}
          <label className="text-sm">
            Cliente
            <input
              className="mt-1 w-full rounded border border-[var(--os-border)] px-3 py-2"
              value={form.client}
              onChange={(e) => setForm({ ...form, client: e.target.value })}
            />
          </label>
          <label className="text-sm">
            Producto
            <input
              className="mt-1 w-full rounded border border-[var(--os-border)] px-3 py-2"
              value={form.product}
              onChange={(e) => setForm({ ...form, product: e.target.value })}
            />
          </label>
          <label className="text-sm">
            Cantidad
            <input
              className="mt-1 w-full rounded border border-[var(--os-border)] px-3 py-2"
              value={form.plannedQuantity}
              onChange={(e) =>
                setForm({ ...form, plannedQuantity: e.target.value })
              }
            />
          </label>
        </div>
        <div className="mt-4 flex flex-wrap gap-2">
          <button
            type="button"
            className="rounded bg-[var(--os-teal)] px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
            disabled={busy}
            onClick={() => void onSaveItem()}
          >
            {editingId ? "Guardar cambios" : "Guardar trabajo en borrador"}
          </button>
          {editingId && (
            <button
              type="button"
              className="rounded border border-[var(--os-border)] px-4 py-2 text-sm"
              disabled={busy}
              onClick={cancelEdit}
            >
              Cancelar edición
            </button>
          )}
        </div>
        {!isDraft && week && (
          <p className="mt-2 text-xs text-[var(--os-text-muted)]">
            Semana publicada: editar mueve/reprograma y registra OperationalEvent.
            Delete deshabilitado.
          </p>
        )}
      </section>

      <div className="mb-4 grid gap-2 sm:grid-cols-5">
        {days.map((d) => (
          <div
            key={d}
            className="rounded border border-[var(--os-border)] px-3 py-2 text-center text-xs"
          >
            <div className="font-semibold">{formatOperationalLongDate(d)}</div>
            <div className="text-[var(--os-text-muted)]">
              {items.filter((i) => i.plannedDate === d).length} trabajos
            </div>
          </div>
        ))}
      </div>

      <Section
        title="ELABORACIÓN · Cristian"
        items={grouped.elaboracionCristian}
        onEdit={beginEdit}
        onDelete={onDelete}
        canDelete={Boolean(isDraft)}
      />
      <Section
        title="ELABORACIÓN · Nicolás"
        items={grouped.elaboracionNicolas}
        onEdit={beginEdit}
        onDelete={onDelete}
        canDelete={Boolean(isDraft)}
      />
      {grouped.masivo.map((list, idx) => (
        <Section
          key={`m${idx}`}
          title={`ENVASADO MASIVO · Línea ${idx + 1}`}
          items={list}
          onEdit={beginEdit}
          onDelete={onDelete}
          canDelete={Boolean(isDraft)}
        />
      ))}
      {grouped.premium.map((list, idx) => (
        <Section
          key={`p${idx}`}
          title={`ENVASADO PREMIUM · Línea ${idx + 1}`}
          items={list}
          onEdit={beginEdit}
          onDelete={onDelete}
          canDelete={Boolean(isDraft)}
        />
      ))}

      <p className="mt-6 text-xs text-[var(--os-text-muted)]">
        Navegar semana:{" "}
        <button
          type="button"
          className="underline"
          onClick={() => {
            cancelEdit();
            setWeekStart(addDaysIso(weekStart, -7));
          }}
        >
          anterior
        </button>{" "}
        ·{" "}
        <button
          type="button"
          className="underline"
          onClick={() => {
            cancelEdit();
            setWeekStart(addDaysIso(weekStart, 7));
          }}
        >
          siguiente
        </button>
      </p>
    </TwinShell>
  );
}

function Section({
  title,
  items,
  onEdit,
  onDelete,
  canDelete,
}: {
  title: string;
  items: PlanningWorkItemRecord[];
  onEdit: (item: PlanningWorkItemRecord) => void;
  onDelete: (id: string) => void;
  canDelete: boolean;
}) {
  return (
    <section className="mb-6">
      <h3 className="mb-2 text-sm font-semibold uppercase tracking-wide text-[var(--os-text-muted)]">
        {title}
      </h3>
      {items.length === 0 ? (
        <p className="text-sm text-[var(--os-text-muted)]">Sin trabajos</p>
      ) : (
        <ul className="space-y-2">
          {items.map((item) => (
            <li
              key={item.id}
              className="flex flex-wrap items-center justify-between gap-2 rounded border border-[var(--os-border)] bg-[var(--os-surface)] px-3 py-2 text-sm"
            >
              <span>
                <strong>{item.plannedDate}</strong> · {item.client} · {item.product}{" "}
                · {item.plannedQuantity} {item.unit} · {item.status} · v{item.version}
              </span>
              <span className="flex gap-3">
                <button
                  type="button"
                  className="underline"
                  onClick={() => onEdit(item)}
                >
                  Editar
                </button>
                {canDelete && (
                  <button
                    type="button"
                    className="text-rose-700 underline"
                    onClick={() => onDelete(item.id)}
                  >
                    Eliminar
                  </button>
                )}
              </span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
