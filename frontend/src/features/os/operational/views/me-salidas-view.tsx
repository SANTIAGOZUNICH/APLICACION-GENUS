"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { ClipboardPaste, Pencil, Plus, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/dialog";
import { TwinShell } from "@/features/os/shell/twin-shell";
import {
  fetchInventory,
  mutateInventory,
  InventoryClientError,
} from "@/features/os/operational/adapters/inventory-client";
import { ExcelPasteDialog } from "@/features/os/operational/components/excel-paste-dialog";
import {
  OperationalTable,
  type OperationalTableColumn,
} from "@/features/os/operational/components/operational-ui";
import { displayCell, multiplyTotal, parseOptionalNumber } from "@/lib/inventory/calcs";
import { ME_SALIDA_COLUMNS, type MeMaterial, type MeSalidaRow } from "@/lib/inventory/types";
import { canWriteInventory } from "@/lib/inventory/rbac";
import { usePreviewSession } from "@/features/os/session/preview-context";

const ALIASES: Record<string, string[]> = {
  fecha: ["fecha"],
  egresoNro: ["egreso", "egreso n", "egreso n.º", "egreso nº"],
  cliente: ["cliente"],
  remitoNro: ["remito", "remito n", "remito n.º"],
  descripcion: ["descripcion", "descripción"],
  bultos: ["bultos"],
  cantidad: ["cantidad"],
  total: ["total"],
  control: ["control"],
  entregado: ["entregado"],
  comentarios: ["comentarios", "comentario"],
};

type FormState = {
  id?: string;
  fecha: string;
  egresoNro: string;
  cliente: string;
  remitoNro: string;
  descripcion: string;
  bultos: string;
  cantidad: string;
  control: boolean;
  entregado: boolean;
  comentarios: string;
  materialId: string;
};

function emptyForm(): FormState {
  return {
    fecha: new Date().toISOString().slice(0, 10),
    egresoNro: "",
    cliente: "",
    remitoNro: "",
    descripcion: "",
    bultos: "",
    cantidad: "",
    control: false,
    entregado: false,
    comentarios: "",
    materialId: "",
  };
}

export function MeSalidasView() {
  const { sectorId } = usePreviewSession();
  const canWrite = canWriteInventory(sectorId, "me_salidas");
  const [rows, setRows] = useState<MeSalidaRow[]>([]);
  const [materials, setMaterials] = useState<MeMaterial[]>([]);
  const [banner, setBanner] = useState<string | null>(null);
  const [persistence, setPersistence] = useState(true);
  const [search, setSearch] = useState("");
  const [filterControl, setFilterControl] = useState<"todos" | "si" | "no">("todos");
  const [filterEntregado, setFilterEntregado] = useState<"todos" | "si" | "no">("todos");
  const [form, setForm] = useState<FormState | null>(null);
  const [deleteId, setDeleteId] = useState<string | null>(null);
  const [deleteReason, setDeleteReason] = useState("");
  const [pasteOpen, setPasteOpen] = useState(false);
  const [page, setPage] = useState(0);
  const pageSize = 20;

  const reload = useCallback(async () => {
    const [salidas, stock] = await Promise.all([
      fetchInventory<MeSalidaRow>("me_salidas"),
      fetchInventory<MeMaterial>("me_stock"),
    ]);
    setRows(salidas.data);
    setMaterials(stock.data);
    setPersistence(salidas.persistence);
    setBanner(salidas.message ?? null);
  }, []);

  useEffect(() => {
    let cancelled = false;
    queueMicrotask(() => {
      void (async () => {
        try {
          await reload();
        } catch (e) {
          if (!cancelled) setBanner(e instanceof Error ? e.message : "Error");
        }
      })();
    });
    return () => {
      cancelled = true;
    };
  }, [reload]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return rows.filter((r) => {
      if (filterControl === "si" && !r.control) return false;
      if (filterControl === "no" && r.control) return false;
      if (filterEntregado === "si" && !r.entregado) return false;
      if (filterEntregado === "no" && r.entregado) return false;
      if (!q) return true;
      return [r.egresoNro, r.cliente, r.remitoNro, r.descripcion].join(" ").toLowerCase().includes(q);
    });
  }, [rows, search, filterControl, filterEntregado]);

  const pageRows = filtered.slice(page * pageSize, page * pageSize + pageSize);

  const columns: OperationalTableColumn<MeSalidaRow>[] = ME_SALIDA_COLUMNS.map((label) => {
    const keyMap: Record<string, keyof MeSalidaRow> = {
      FECHA: "fecha",
      "EGRESO N.º": "egresoNro",
      CLIENTE: "cliente",
      "REMITO N.º": "remitoNro",
      DESCRIPCIÓN: "descripcion",
      BULTOS: "bultos",
      CANTIDAD: "cantidad",
      TOTAL: "total",
      CONTROL: "control",
      ENTREGADO: "entregado",
      COMENTARIOS: "comentarios",
    };
    const key = keyMap[label];
    return {
      key: label,
      header: label,
      render: (row) => {
        const v = row[key];
        if (typeof v === "boolean") return v ? "Sí" : "No";
        return displayCell(v);
      },
    };
  });

  const liveTotal = form
    ? multiplyTotal(parseOptionalNumber(form.bultos), parseOptionalNumber(form.cantidad))
    : null;

  async function saveForm() {
    if (!form || !canWrite) return;
    try {
      const mat = materials.find((m) => m.id === form.materialId);
      await mutateInventory({
        action: "upsert",
        resource: "me_salidas",
        payload: {
          id: form.id,
          fecha: form.fecha,
          egresoNro: form.egresoNro,
          cliente: form.cliente,
          remitoNro: form.remitoNro,
          descripcion: form.descripcion || mat?.descripcion || "",
          bultos: parseOptionalNumber(form.bultos),
          cantidad: parseOptionalNumber(form.cantidad),
          control: form.control,
          entregado: form.entregado,
          comentarios: form.comentarios,
          materialId: form.materialId || null,
        },
      });
      setForm(null);
      await reload();
    } catch (e) {
      setBanner(e instanceof InventoryClientError ? e.message : "No se pudo guardar");
    }
  }

  return (
    <TwinShell title="SALIDAS ME">
      {banner && (
        <div className="mb-4 rounded border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-900">
          {banner}
          {!persistence && " · Sin persistencia simulada."}
        </div>
      )}
      <p className="mb-3 text-xs text-[var(--os-text-muted)]">
        Módulo «Salidas ME» (la hoja de referencia decía Salidas Producto Terminado). Columnas
        exactas sin cambios.
      </p>
      <div className="mb-4 flex flex-wrap items-center gap-2">
        {canWrite && (
          <>
            <Button type="button" onClick={() => setForm(emptyForm())}>
              <Plus className="mr-1 size-4" /> Nueva salida
            </Button>
            <Button type="button" variant="secondary" onClick={() => setPasteOpen(true)}>
              <ClipboardPaste className="mr-1 size-4" /> Pegar desde Excel
            </Button>
          </>
        )}
        <input
          className="rounded border px-3 py-1.5 text-sm"
          placeholder="Buscar egreso, cliente, remito, descripción…"
          value={search}
          onChange={(e) => {
            setSearch(e.target.value);
            setPage(0);
          }}
        />
        <select
          className="rounded border px-2 py-1.5 text-sm"
          value={filterControl}
          onChange={(e) => setFilterControl(e.target.value as typeof filterControl)}
        >
          <option value="todos">Control: todos</option>
          <option value="si">Control: Sí</option>
          <option value="no">Control: No</option>
        </select>
        <select
          className="rounded border px-2 py-1.5 text-sm"
          value={filterEntregado}
          onChange={(e) => setFilterEntregado(e.target.value as typeof filterEntregado)}
        >
          <option value="todos">Entregado: todos</option>
          <option value="si">Entregado: Sí</option>
          <option value="no">Entregado: No</option>
        </select>
      </div>

      <OperationalTable
        columns={[
          ...columns,
          ...(canWrite
            ? [
                {
                  key: "acciones",
                  header: "",
                  render: (row: MeSalidaRow) => (
                    <div className="flex gap-1">
                      <button
                        type="button"
                        onClick={() =>
                          setForm({
                            id: row.id,
                            fecha: row.fecha,
                            egresoNro: row.egresoNro,
                            cliente: row.cliente,
                            remitoNro: row.remitoNro,
                            descripcion: row.descripcion,
                            bultos: row.bultos == null ? "" : String(row.bultos),
                            cantidad: row.cantidad == null ? "" : String(row.cantidad),
                            control: row.control,
                            entregado: row.entregado,
                            comentarios: row.comentarios,
                            materialId: row.materialId ?? "",
                          })
                        }
                      >
                        <Pencil className="size-4" />
                      </button>
                      <button type="button" onClick={() => setDeleteId(row.id)}>
                        <Trash2 className="size-4 text-red-700" />
                      </button>
                    </div>
                  ),
                } as OperationalTableColumn<MeSalidaRow>,
              ]
            : []),
        ]}
        rows={pageRows}
        rowKey={(r) => r.id}
        emptyMessage="Sin salidas ME."
      />

      <div className="mt-3 flex gap-2 text-sm">
        <Button type="button" variant="secondary" disabled={page === 0} onClick={() => setPage((p) => p - 1)}>
          Anterior
        </Button>
        <span>
          Página {page + 1} / {Math.max(1, Math.ceil(filtered.length / pageSize))}
        </span>
        <Button
          type="button"
          variant="secondary"
          disabled={(page + 1) * pageSize >= filtered.length}
          onClick={() => setPage((p) => p + 1)}
        >
          Siguiente
        </Button>
      </div>

      {form && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
          <div className="max-h-[90vh] w-full max-w-lg overflow-y-auto rounded bg-[var(--os-surface)] p-5 shadow">
            <h3 className="mb-3 text-lg font-semibold">{form.id ? "Editar salida" : "Nueva salida"}</h3>
            <div className="grid grid-cols-2 gap-3 text-sm">
              <label className="col-span-2 flex flex-col gap-1">
                Material (inventario ME)
                <select
                  className="rounded border px-2 py-1"
                  value={form.materialId}
                  onChange={(e) => {
                    const mat = materials.find((m) => m.id === e.target.value);
                    setForm({
                      ...form,
                      materialId: e.target.value,
                      descripcion: mat?.descripcion || form.descripcion,
                    });
                  }}
                >
                  <option value="">— Seleccionar materialId (obligatorio para descontar) —</option>
                  {materials.map((m) => (
                    <option key={m.id} value={m.id}>
                      {displayCell(m.codigo)} {m.descripcion} (stock {m.stockActual})
                    </option>
                  ))}
                </select>
              </label>
              {(
                [
                  ["fecha", "FECHA"],
                  ["egresoNro", "EGRESO N.º"],
                  ["cliente", "CLIENTE"],
                  ["remitoNro", "REMITO N.º"],
                  ["descripcion", "DESCRIPCIÓN"],
                  ["bultos", "BULTOS"],
                  ["cantidad", "CANTIDAD"],
                  ["comentarios", "COMENTARIOS"],
                ] as const
              ).map(([key, label]) => (
                <label key={key} className="flex flex-col gap-1">
                  <span>{label}</span>
                  <input
                    className="rounded border px-2 py-1"
                    value={form[key] as string}
                    onChange={(e) => setForm({ ...form, [key]: e.target.value })}
                  />
                </label>
              ))}
              <label className="flex items-center gap-2">
                <input
                  type="checkbox"
                  checked={form.control}
                  onChange={(e) => setForm({ ...form, control: e.target.checked })}
                />
                CONTROL
              </label>
              <label className="flex items-center gap-2">
                <input
                  type="checkbox"
                  checked={form.entregado}
                  onChange={(e) => setForm({ ...form, entregado: e.target.checked })}
                />
                ENTREGADO
              </label>
              <label className="flex flex-col gap-1">
                TOTAL (auto)
                <input
                  readOnly
                  className="rounded border bg-[var(--os-bg)] px-2 py-1"
                  value={liveTotal == null ? "" : String(liveTotal)}
                />
              </label>
            </div>
            <div className="mt-4 flex justify-end gap-2">
              <Button type="button" variant="secondary" onClick={() => setForm(null)}>
                Cancelar
              </Button>
              <Button type="button" onClick={() => void saveForm()}>
                Guardar
              </Button>
            </div>
          </div>
        </div>
      )}

      <ConfirmDialog
        open={Boolean(deleteId)}
        onOpenChange={(o) => !o && setDeleteId(null)}
        title="Eliminar salida ME"
        description="Se revertirá el impacto en stock."
        confirmLabel="Eliminar"
        onConfirm={() => {
          if (!deleteId) return;
          void mutateInventory({
            action: "delete",
            resource: "me_salidas",
            id: deleteId,
            reason: deleteReason || "Eliminación de salida ME",
          })
            .then(() => reload())
            .finally(() => {
              setDeleteId(null);
              setDeleteReason("");
            });
        }}
      />

      <ExcelPasteDialog
        open={pasteOpen}
        onOpenChange={setPasteOpen}
        fields={[
          { key: "fecha", label: "FECHA" },
          { key: "egresoNro", label: "EGRESO N.º" },
          { key: "cliente", label: "CLIENTE" },
          { key: "remitoNro", label: "REMITO N.º" },
          { key: "descripcion", label: "DESCRIPCIÓN" },
          { key: "bultos", label: "BULTOS" },
          { key: "cantidad", label: "CANTIDAD" },
          { key: "total", label: "TOTAL", calculated: true },
          { key: "control", label: "CONTROL" },
          { key: "entregado", label: "ENTREGADO" },
          { key: "comentarios", label: "COMENTARIOS" },
        ]}
        fieldAliases={ALIASES}
        ignoreKeys={["total"]}
        onConfirm={async (mapped) => {
          for (const m of mapped) {
            await mutateInventory({
              action: "upsert",
              resource: "me_salidas",
              payload: {
                fecha: m.fecha ?? "",
                egresoNro: m.egresoNro ?? "",
                cliente: m.cliente ?? "",
                remitoNro: m.remitoNro ?? "",
                descripcion: m.descripcion ?? "",
                bultos: parseOptionalNumber(m.bultos),
                cantidad: parseOptionalNumber(m.cantidad),
                control: /^(si|sí|true|1|x)$/i.test(m.control ?? ""),
                entregado: /^(si|sí|true|1|x)$/i.test(m.entregado ?? ""),
                comentarios: m.comentarios ?? "",
                materialId: null,
              },
            });
          }
          await reload();
        }}
      />
    </TwinShell>
  );
}
