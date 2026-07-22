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
import { OperationalTable, type OperationalTableColumn } from "@/features/os/operational/components/operational-ui";
import { displayCell, multiplyTotal, parseOptionalNumber } from "@/lib/inventory/calcs";
import { ME_INGRESO_COLUMNS, type MeIngresoRow } from "@/lib/inventory/types";
import { canWriteInventory } from "@/lib/inventory/rbac";
import { usePreviewSession } from "@/features/os/session/preview-context";

const ALIASES: Record<string, string[]> = {
  fecha: ["fecha"],
  ingresoNro: ["ingreso n", "ingreso nº", "ingreso nro", "ingreso"],
  proveedor: ["proveedor"],
  cliente: ["cliente"],
  remitoNro: ["remito", "remito n", "remito nº"],
  codigo: ["codigo", "código"],
  descripcionInsumo: ["descripcion", "descripción", "descripcion insumo", "descripción insumo"],
  bultos: ["bultos"],
  cantidad: ["cantidad"],
  total: ["total"],
  ubicacion: ["ubicacion", "ubicación"],
};

type FormState = {
  id?: string;
  fecha: string;
  ingresoNro: string;
  proveedor: string;
  cliente: string;
  remitoNro: string;
  codigo: string;
  descripcionInsumo: string;
  bultos: string;
  cantidad: string;
  ubicacion: string;
};

function emptyForm(): FormState {
  return {
    fecha: new Date().toISOString().slice(0, 10),
    ingresoNro: "",
    proveedor: "",
    cliente: "",
    remitoNro: "",
    codigo: "",
    descripcionInsumo: "",
    bultos: "",
    cantidad: "",
    ubicacion: "",
  };
}

export function MeIngresosView() {
  const { sectorId } = usePreviewSession();
  const canWrite = canWriteInventory(sectorId, "me_ingresos");
  const [rows, setRows] = useState<MeIngresoRow[]>([]);
  const [persistence, setPersistence] = useState(true);
  const [banner, setBanner] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [form, setForm] = useState<FormState | null>(null);
  const [deleteId, setDeleteId] = useState<string | null>(null);
  const [deleteReason, setDeleteReason] = useState("");
  const [pasteOpen, setPasteOpen] = useState(false);
  const [page, setPage] = useState(0);
  const pageSize = 20;

  const reload = useCallback(async () => {
    const res = await fetchInventory<MeIngresoRow>("me_ingresos");
    setRows(res.data);
    setPersistence(res.persistence);
    setBanner(res.message ?? null);
  }, []);

  useEffect(() => {
    let cancelled = false;
    queueMicrotask(() => {
      void (async () => {
        try {
          const res = await fetchInventory<MeIngresoRow>("me_ingresos");
          if (cancelled) return;
          setRows(res.data);
          setPersistence(res.persistence);
          setBanner(res.message ?? null);
        } catch (e) {
          if (!cancelled) setBanner(e instanceof Error ? e.message : "Error");
        }
      })();
    });
    return () => {
      cancelled = true;
    };
  }, []);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return rows;
    return rows.filter((r) =>
      [r.ingresoNro, r.proveedor, r.cliente, r.remitoNro, r.codigo, r.descripcionInsumo]
        .join(" ")
        .toLowerCase()
        .includes(q)
    );
  }, [rows, search]);

  const pageRows = filtered.slice(page * pageSize, page * pageSize + pageSize);

  const columns: OperationalTableColumn<MeIngresoRow>[] = ME_INGRESO_COLUMNS.map((label) => {
    const keyMap: Record<string, keyof MeIngresoRow> = {
      FECHA: "fecha",
      "INGRESO Nº": "ingresoNro",
      PROVEEDOR: "proveedor",
      CLIENTE: "cliente",
      "REMITO Nº": "remitoNro",
      CÓDIGO: "codigo",
      "DESCRIPCIÓN INSUMO": "descripcionInsumo",
      BULTOS: "bultos",
      CANTIDAD: "cantidad",
      TOTAL: "total",
      UBICACIÓN: "ubicacion",
    };
    const key = keyMap[label];
    return {
      key: label,
      header: label,
      render: (row) => displayCell(row[key]),
    };
  });

  async function saveForm() {
    if (!form || !canWrite) return;
    try {
      await mutateInventory({
        action: "upsert",
        resource: "me_ingresos",
        payload: {
          id: form.id,
          fecha: form.fecha,
          ingresoNro: form.ingresoNro,
          proveedor: form.proveedor,
          cliente: form.cliente,
          remitoNro: form.remitoNro,
          codigo: form.codigo,
          descripcionInsumo: form.descripcionInsumo,
          bultos: parseOptionalNumber(form.bultos),
          cantidad: parseOptionalNumber(form.cantidad),
          ubicacion: form.ubicacion,
        },
      });
      setForm(null);
      await reload();
    } catch (e) {
      setBanner(e instanceof InventoryClientError ? e.message : "No se pudo guardar");
    }
  }

  const liveTotal = form
    ? multiplyTotal(parseOptionalNumber(form.bultos), parseOptionalNumber(form.cantidad))
    : null;

  return (
    <TwinShell title="INGRESOS DE MATERIAL DE EMPAQUE">
      {banner && (
        <div className="mb-4 rounded border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-900">
          {banner}
          {!persistence && " · Tablas vacías; sin simulación de persistencia."}
        </div>
      )}
      <div className="mb-4 flex flex-wrap items-center gap-2">
        {canWrite && (
          <>
            <Button type="button" onClick={() => setForm(emptyForm())}>
              <Plus className="mr-1 size-4" /> Nuevo ingreso
            </Button>
            <Button type="button" variant="secondary" onClick={() => setPasteOpen(true)}>
              <ClipboardPaste className="mr-1 size-4" /> Pegar desde Excel
            </Button>
          </>
        )}
        <input
          className="rounded border border-[var(--os-border)] px-3 py-1.5 text-sm"
          placeholder="Buscar…"
          value={search}
          onChange={(e) => {
            setSearch(e.target.value);
            setPage(0);
          }}
        />
      </div>

      <OperationalTable
        columns={[
          ...columns,
          ...(canWrite
            ? [
                {
                  key: "acciones",
                  header: "",
                  render: (row: MeIngresoRow) => (
                    <div className="flex gap-1">
                      <button
                        type="button"
                        aria-label="Editar"
                        onClick={() =>
                          setForm({
                            id: row.id,
                            fecha: row.fecha,
                            ingresoNro: row.ingresoNro,
                            proveedor: row.proveedor,
                            cliente: row.cliente,
                            remitoNro: row.remitoNro,
                            codigo: row.codigo,
                            descripcionInsumo: row.descripcionInsumo,
                            bultos: row.bultos == null ? "" : String(row.bultos),
                            cantidad: row.cantidad == null ? "" : String(row.cantidad),
                            ubicacion: row.ubicacion,
                          })
                        }
                      >
                        <Pencil className="size-4" />
                      </button>
                      <button
                        type="button"
                        aria-label="Duplicar"
                        onClick={() =>
                          setForm({
                            ...emptyForm(),
                            fecha: row.fecha,
                            ingresoNro: row.ingresoNro,
                            proveedor: row.proveedor,
                            cliente: row.cliente,
                            remitoNro: row.remitoNro,
                            codigo: row.codigo,
                            descripcionInsumo: row.descripcionInsumo,
                            bultos: row.bultos == null ? "" : String(row.bultos),
                            cantidad: row.cantidad == null ? "" : String(row.cantidad),
                            ubicacion: row.ubicacion,
                          })
                        }
                      >
                        <Plus className="size-4" />
                      </button>
                      <button type="button" aria-label="Eliminar" onClick={() => setDeleteId(row.id)}>
                        <Trash2 className="size-4 text-red-700" />
                      </button>
                    </div>
                  ),
                } as OperationalTableColumn<MeIngresoRow>,
              ]
            : []),
        ]}
        rows={pageRows}
        rowKey={(r) => r.id}
        emptyMessage="Sin ingresos ME. Las tablas comienzan vacías (sin datos históricos)."
      />

      <div className="mt-3 flex items-center gap-2 text-sm">
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
            <h3 className="mb-3 text-lg font-semibold">
              {form.id ? "Editar ingreso ME" : "Nuevo ingreso ME"}
            </h3>
            <p className="mb-3 text-xs text-[var(--os-text-muted)]">
              Se permiten borradores incompletos. TOTAL = BULTOS × CANTIDAD (solo lectura).
            </p>
            <div className="grid grid-cols-2 gap-3 text-sm">
              {(
                [
                  ["fecha", "FECHA"],
                  ["ingresoNro", "INGRESO Nº"],
                  ["proveedor", "PROVEEDOR"],
                  ["cliente", "CLIENTE"],
                  ["remitoNro", "REMITO Nº"],
                  ["codigo", "CÓDIGO"],
                  ["descripcionInsumo", "DESCRIPCIÓN INSUMO"],
                  ["bultos", "BULTOS"],
                  ["cantidad", "CANTIDAD"],
                  ["ubicacion", "UBICACIÓN"],
                ] as const
              ).map(([key, label]) => (
                <label key={key} className="flex flex-col gap-1">
                  <span>{label}</span>
                  <input
                    className="rounded border border-[var(--os-border)] px-2 py-1"
                    value={form[key]}
                    onChange={(e) => setForm({ ...form, [key]: e.target.value })}
                  />
                </label>
              ))}
              <label className="flex flex-col gap-1">
                <span>TOTAL (auto)</span>
                <input
                  className="rounded border border-[var(--os-border)] bg-[var(--os-bg)] px-2 py-1"
                  readOnly
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
        title="Eliminar ingreso ME"
        description="Se revertirá el impacto en stock. Indicá el motivo."
        confirmLabel="Eliminar"
        onConfirm={() => {
          if (!deleteId) return;
          void mutateInventory({
            action: "delete",
            resource: "me_ingresos",
            id: deleteId,
            reason: deleteReason || "Eliminación de ingreso ME",
          })
            .then(() => reload())
            .catch((e) =>
              setBanner(e instanceof Error ? e.message : "No se pudo eliminar")
            )
            .finally(() => {
              setDeleteId(null);
              setDeleteReason("");
            });
        }}
      />
      {deleteId && (
        <div className="fixed bottom-4 left-1/2 z-[60] w-full max-w-md -translate-x-1/2 rounded border bg-white p-3 shadow">
          <label className="block text-sm">
            Motivo
            <input
              className="mt-1 w-full rounded border px-2 py-1"
              value={deleteReason}
              onChange={(e) => setDeleteReason(e.target.value)}
            />
          </label>
        </div>
      )}

      <ExcelPasteDialog
        open={pasteOpen}
        onOpenChange={setPasteOpen}
        fields={[
          { key: "fecha", label: "FECHA" },
          { key: "ingresoNro", label: "INGRESO Nº" },
          { key: "proveedor", label: "PROVEEDOR" },
          { key: "cliente", label: "CLIENTE" },
          { key: "remitoNro", label: "REMITO Nº" },
          { key: "codigo", label: "CÓDIGO" },
          { key: "descripcionInsumo", label: "DESCRIPCIÓN INSUMO" },
          { key: "bultos", label: "BULTOS" },
          { key: "cantidad", label: "CANTIDAD" },
          { key: "total", label: "TOTAL", calculated: true },
          { key: "ubicacion", label: "UBICACIÓN" },
        ]}
        fieldAliases={ALIASES}
        ignoreKeys={["total"]}
        onConfirm={async (mappedRows) => {
          for (const m of mappedRows) {
            await mutateInventory({
              action: "upsert",
              resource: "me_ingresos",
              payload: {
                fecha: m.fecha ?? "",
                ingresoNro: m.ingresoNro ?? "",
                proveedor: m.proveedor ?? "",
                cliente: m.cliente ?? "",
                remitoNro: m.remitoNro ?? "",
                codigo: m.codigo ?? "",
                descripcionInsumo: m.descripcionInsumo ?? "",
                bultos: parseOptionalNumber(m.bultos),
                cantidad: parseOptionalNumber(m.cantidad),
                ubicacion: m.ubicacion ?? "",
              },
            });
          }
          await reload();
        }}
      />
    </TwinShell>
  );
}
