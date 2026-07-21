"use client";

/**
 * Hub MP — exactamente 4 pestañas: Stock | Ingresos MP | Control semanal | Compras MP.
 * Columnas y cálculos según GESTION_MP_GENUS.xlsx (sin datos históricos).
 */

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
import {
  displayCell,
  multiplyTotal,
  parseOptionalNumber,
} from "@/lib/inventory/calcs";
import {
  MP_COMPRA_COLUMNS,
  MP_CONTROL_COLUMNS,
  MP_INGRESO_COLUMNS,
  MP_STOCK_COLUMNS,
  MP_TABS,
  type MpCompraRow,
  type MpControlRow,
  type MpIngresoRow,
  type MpStockRow,
} from "@/lib/inventory/types";
import { canWriteInventory } from "@/lib/inventory/rbac";
import { usePreviewSession } from "@/features/os/session/preview-context";

export type MpHubTab = (typeof MP_TABS)[number];

const TAB_TO_RESOURCE = {
  Stock: "mp_stock",
  "Ingresos MP": "mp_ingresos",
  "Control semanal": "mp_control",
  "Compras MP": "mp_compras",
} as const;

export function MpHubView({ initialTab = "Stock" as MpHubTab }: { initialTab?: MpHubTab }) {
  const { sectorId } = usePreviewSession();
  const [tab, setTab] = useState<MpHubTab>(initialTab);
  const canWrite = canWriteInventory(sectorId, TAB_TO_RESOURCE[tab]);
  const [banner, setBanner] = useState<string | null>(null);
  const [persistence, setPersistence] = useState(true);
  const [search, setSearch] = useState("");
  const [pasteOpen, setPasteOpen] = useState(false);
  const [stock, setStock] = useState<MpStockRow[]>([]);
  const [ingresos, setIngresos] = useState<MpIngresoRow[]>([]);
  const [control, setControl] = useState<MpControlRow[]>([]);
  const [compras, setCompras] = useState<MpCompraRow[]>([]);
  const [ingresoPrefill, setIngresoPrefill] = useState<Record<string, unknown> | null>(null);
  const [formOpen, setFormOpen] = useState(false);
  const [formDraft, setFormDraft] = useState<Record<string, string>>({});
  const [deleteTarget, setDeleteTarget] = useState<{ id: string; reason: string } | null>(null);
  const [page, setPage] = useState(0);
  const pageSize = 25;

  const reload = useCallback(async () => {
    const [s, i, c, p] = await Promise.all([
      fetchInventory<MpStockRow>("mp_stock"),
      fetchInventory<MpIngresoRow>("mp_ingresos"),
      fetchInventory<MpControlRow>("mp_control"),
      fetchInventory<MpCompraRow>("mp_compras"),
    ]);
    setStock(s.data);
    setIngresos(i.data);
    setControl(c.data);
    setCompras(p.data);
    setPersistence(s.persistence);
    setBanner(s.message ?? null);
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

  // initialTab controlled via remount key from TwinRouter — no sync effect.

  const rows = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (tab === "Stock") {
      return stock.filter((r) =>
        !q ||
        [r.descripcion, r.proveedor, r.cliente, r.lote, r.ubicacion].join(" ").toLowerCase().includes(q)
      );
    }
    if (tab === "Ingresos MP") {
      return ingresos.filter(
        (r) =>
          !q ||
          [r.ingresoNro, r.descripcion, r.proveedor, r.cliente, r.lote].join(" ").toLowerCase().includes(q)
      );
    }
    if (tab === "Control semanal") {
      return control.filter(
        (r) =>
          !r.archived &&
          (!q ||
            [r.productoElaborar, r.materiaPrima, r.estado].join(" ").toLowerCase().includes(q))
      );
    }
    return compras.filter(
      (r) =>
        !q ||
        [r.materiaPrima, r.proveedor, r.estado, r.produccionesAfecta].join(" ").toLowerCase().includes(q)
    );
  }, [tab, stock, ingresos, control, compras, search]);

  const pageRows = rows.slice(page * pageSize, page * pageSize + pageSize);

  function openNew() {
    setFormDraft({ fecha: new Date().toISOString().slice(0, 10) });
    setFormOpen(true);
  }

  async function saveDraft() {
    try {
      if (tab === "Stock") {
        await mutateInventory({
          action: "upsert",
          resource: "mp_stock",
          payload: {
            id: formDraft.id || undefined,
            proveedor: formDraft.proveedor ?? "",
            cliente: formDraft.cliente ?? "",
            descripcion: formDraft.descripcion ?? "",
            cantidadKg: parseOptionalNumber(formDraft.cantidadKg),
            ubicacion: formDraft.ubicacion ?? "",
            lote: formDraft.lote ?? "",
            vencimiento: formDraft.vencimiento ?? "",
            origen: formDraft.origen ?? "manual",
            codigo: formDraft.codigo ?? "",
          },
        });
      } else if (tab === "Ingresos MP") {
        const result = await mutateInventory({
          action: "upsert",
          resource: "mp_ingresos",
          payload: {
            id: formDraft.id || undefined,
            fecha: formDraft.fecha ?? "",
            ingresoNro: formDraft.ingresoNro ?? "",
            proveedor: formDraft.proveedor ?? "",
            cliente: formDraft.cliente ?? "",
            remitoNro: formDraft.remitoNro ?? "",
            codigo: formDraft.codigo ?? "",
            descripcion: formDraft.descripcion ?? "",
            bultos: parseOptionalNumber(formDraft.bultos),
            cantidad: parseOptionalNumber(formDraft.cantidad),
            ubicacion: formDraft.ubicacion ?? "",
            lote: formDraft.lote ?? "",
            vencimiento: formDraft.vencimiento ?? "",
          },
        });
        if (formDraft.compraId) {
          await mutateInventory({
            action: "link_ingreso",
            resource: "mp_compras",
            id: formDraft.compraId,
            payload: { ingresoId: (result.data as MpIngresoRow).id },
          });
        }
      } else if (tab === "Control semanal") {
        await mutateInventory({
          action: "upsert",
          resource: "mp_control",
          payload: {
            id: formDraft.id || undefined,
            semanaLabel: formDraft.semanaLabel ?? "",
            productoElaborar: formDraft.productoElaborar ?? "",
            materiaPrima: formDraft.materiaPrima ?? "",
            cantNecesaria: parseOptionalNumber(formDraft.cantNecesaria),
            enInventario: parseOptionalNumber(formDraft.enInventario),
            observacion: formDraft.observacion ?? "",
          },
        });
      } else {
        const res = await mutateInventory<{
          compra: MpCompraRow;
          offerCreateIngreso: boolean;
          ingresoPrefill: Record<string, unknown> | null;
        }>({
          action: "upsert",
          resource: "mp_compras",
          payload: {
            id: formDraft.id || undefined,
            fecha: formDraft.fecha ?? "",
            materiaPrima: formDraft.materiaPrima ?? "",
            cantidad: parseOptionalNumber(formDraft.cantidad),
            unidad: formDraft.unidad ?? "",
            proveedor: formDraft.proveedor ?? "",
            fechaEntrega: formDraft.fechaEntrega ?? "",
            produccionesAfecta: formDraft.produccionesAfecta ?? "",
            estado: formDraft.estado ?? "",
            nota: formDraft.nota ?? "",
          },
        });
        if (res.data.offerCreateIngreso && res.data.ingresoPrefill) {
          setIngresoPrefill(res.data.ingresoPrefill);
        }
      }
      setFormOpen(false);
      await reload();
    } catch (e) {
      setBanner(e instanceof InventoryClientError ? e.message : "Error al guardar");
    }
  }

  const stockColumns: OperationalTableColumn<MpStockRow>[] = MP_STOCK_COLUMNS.map((label) => {
    const map: Record<string, keyof MpStockRow> = {
      PROVEEDOR: "proveedor",
      CLIENTE: "cliente",
      "DESCRIPCIÓN MATERIA PRIMA": "descripcion",
      "CANTIDAD (KG)": "cantidadKg",
      UBICACIÓN: "ubicacion",
      LOTE: "lote",
      VENCIMIENTO: "vencimiento",
      "ESTADO STOCK": "estadoStock",
      "DÍAS AL VENCE": "diasAlVence",
      "ESTADO VENCIMIENTO": "estadoVencimiento",
      ORIGEN: "origen",
    };
    const k = map[label];
    return { key: label, header: label, render: (r) => displayCell(r[k]) };
  });

  const ingresoColumns: OperationalTableColumn<MpIngresoRow>[] = MP_INGRESO_COLUMNS.map((label) => {
    const map: Record<string, keyof MpIngresoRow> = {
      FECHA: "fecha",
      "INGRESO Nº": "ingresoNro",
      PROVEEDOR: "proveedor",
      CLIENTE: "cliente",
      "REMITO Nº": "remitoNro",
      CÓDIGO: "codigo",
      "DESCRIPCIÓN MATERIA PRIMA": "descripcion",
      BULTOS: "bultos",
      "CANTIDAD (kg/u)": "cantidad",
      TOTAL: "total",
      UBICACIÓN: "ubicacion",
      LOTE: "lote",
      VENCIMIENTO: "vencimiento",
    };
    const k = map[label];
    return { key: label, header: label, render: (r) => displayCell(r[k]) };
  });

  const controlColumns: OperationalTableColumn<MpControlRow>[] = MP_CONTROL_COLUMNS.map((label) => {
    const map: Record<string, keyof MpControlRow> = {
      "PRODUCTO A ELABORAR": "productoElaborar",
      "MATERIA PRIMA": "materiaPrima",
      "CANT. NECESARIA": "cantNecesaria",
      "EN INVENTARIO": "enInventario",
      FALTA: "falta",
      ESTADO: "estado",
      OBSERVACIÓN: "observacion",
    };
    const k = map[label];
    return {
      key: label,
      header: label,
      render: (r) => {
        const v = displayCell(r[k]);
        if (label === "ESTADO" && r.estado === "FALTA") {
          return <span className="font-semibold text-red-700">{v}</span>;
        }
        return v;
      },
      className: label === "ESTADO" ? "min-w-[5rem]" : undefined,
    };
  });

  const compraColumns: OperationalTableColumn<MpCompraRow>[] = MP_COMPRA_COLUMNS.map((label) => {
    const map: Record<string, keyof MpCompraRow> = {
      FECHA: "fecha",
      "MATERIA PRIMA": "materiaPrima",
      CANTIDAD: "cantidad",
      UNIDAD: "unidad",
      PROVEEDOR: "proveedor",
      "FECHA ENTREGA": "fechaEntrega",
      "QUÉ PRODUCCIONES AFECTA": "produccionesAfecta",
      ESTADO: "estado",
      NOTA: "nota",
    };
    const k = map[label];
    return { key: label, header: label, render: (r) => displayCell(r[k]) };
  });

  const formFields =
    tab === "Stock"
      ? [
          ["proveedor", "PROVEEDOR"],
          ["cliente", "CLIENTE"],
          ["descripcion", "DESCRIPCIÓN MATERIA PRIMA"],
          ["cantidadKg", "CANTIDAD (KG)"],
          ["ubicacion", "UBICACIÓN"],
          ["lote", "LOTE"],
          ["vencimiento", "VENCIMIENTO"],
          ["origen", "ORIGEN"],
        ]
      : tab === "Ingresos MP"
        ? [
            ["fecha", "FECHA"],
            ["ingresoNro", "INGRESO Nº"],
            ["proveedor", "PROVEEDOR"],
            ["cliente", "CLIENTE"],
            ["remitoNro", "REMITO Nº"],
            ["codigo", "CÓDIGO"],
            ["descripcion", "DESCRIPCIÓN MATERIA PRIMA"],
            ["bultos", "BULTOS"],
            ["cantidad", "CANTIDAD (kg/u)"],
            ["ubicacion", "UBICACIÓN"],
            ["lote", "LOTE"],
            ["vencimiento", "VENCIMIENTO"],
          ]
        : tab === "Control semanal"
          ? [
              ["semanaLabel", "Semana"],
              ["productoElaborar", "PRODUCTO A ELABORAR"],
              ["materiaPrima", "MATERIA PRIMA"],
              ["cantNecesaria", "CANT. NECESARIA"],
              ["enInventario", "EN INVENTARIO (manual si no hay match)"],
              ["observacion", "OBSERVACIÓN"],
            ]
          : [
              ["fecha", "FECHA"],
              ["materiaPrima", "MATERIA PRIMA"],
              ["cantidad", "CANTIDAD"],
              ["unidad", "UNIDAD"],
              ["proveedor", "PROVEEDOR"],
              ["fechaEntrega", "FECHA ENTREGA"],
              ["produccionesAfecta", "QUÉ PRODUCCIONES AFECTA"],
              ["estado", "ESTADO"],
              ["nota", "NOTA"],
            ];

  const liveTotal =
    tab === "Ingresos MP"
      ? multiplyTotal(
          parseOptionalNumber(formDraft.bultos),
          parseOptionalNumber(formDraft.cantidad)
        )
      : null;

  return (
    <TwinShell title={`Materias Primas — ${tab}`}>
      {banner && (
        <div className="mb-4 rounded border border-amber-300 bg-amber-50 px-3 py-2 text-sm">
          {banner}
          {!persistence && " · Vista vacía sin persistencia simulada."}
        </div>
      )}

      <div className="mb-4 flex flex-wrap gap-2 border-b border-[var(--os-border)] pb-2">
        {MP_TABS.map((t) => (
          <button
            key={t}
            type="button"
            className={`rounded px-3 py-1.5 text-sm ${
              tab === t ? "bg-[var(--os-teal)] text-white" : "border border-[var(--os-border)]"
            }`}
            onClick={() => {
              setTab(t);
              setPage(0);
            }}
          >
            {t}
          </button>
        ))}
      </div>

      <div className="mb-3 flex flex-wrap gap-2">
        {canWrite && (
          <>
            <Button type="button" onClick={openNew}>
              <Plus className="mr-1 size-4" /> Nuevo
            </Button>
            <Button type="button" variant="secondary" onClick={() => setPasteOpen(true)}>
              <ClipboardPaste className="mr-1 size-4" /> Pegar desde Excel
            </Button>
          </>
        )}
        <input
          className="rounded border px-3 py-1.5 text-sm"
          placeholder="Buscar…"
          value={search}
          onChange={(e) => {
            setSearch(e.target.value);
            setPage(0);
          }}
        />
      </div>

      {tab === "Stock" && (
        <OperationalTable
          columns={[
            ...stockColumns,
            ...(canWrite
              ? [
                  {
                    key: "acciones",
                    header: "",
                    render: (r: MpStockRow) => (
                      <div className="flex gap-1">
                        <button
                          type="button"
                          onClick={() => {
                            setFormDraft({
                              id: r.id,
                              proveedor: r.proveedor,
                              cliente: r.cliente,
                              descripcion: r.descripcion,
                              cantidadKg: r.cantidadKg == null ? "" : String(r.cantidadKg),
                              ubicacion: r.ubicacion,
                              lote: r.lote,
                              vencimiento: r.vencimiento,
                              origen: r.origen,
                            });
                            setFormOpen(true);
                          }}
                        >
                          <Pencil className="size-4" />
                        </button>
                        <button
                          type="button"
                          onClick={() => setDeleteTarget({ id: r.id, reason: "" })}
                        >
                          <Trash2 className="size-4 text-red-700" />
                        </button>
                      </div>
                    ),
                  } as OperationalTableColumn<MpStockRow>,
                ]
              : []),
          ]}
          rows={pageRows as MpStockRow[]}
          rowKey={(r) => r.id}
          emptyMessage="Stock MP vacío (sin registros históricos)."
        />
      )}

      {tab === "Ingresos MP" && (
        <OperationalTable
          columns={ingresoColumns}
          rows={pageRows as MpIngresoRow[]}
          rowKey={(r) => r.id}
          emptyMessage="Sin ingresos MP."
        />
      )}

      {tab === "Control semanal" && (
        <OperationalTable
          columns={[
            ...controlColumns,
            ...(canWrite
              ? [
                  {
                    key: "compra",
                    header: "",
                    render: (r: MpControlRow) =>
                      r.estado === "FALTA" ? (
                        <Button
                          type="button"
                          variant="secondary"
                          onClick={() => {
                            setTab("Compras MP");
                            setFormDraft({
                              fecha: new Date().toISOString().slice(0, 10),
                              materiaPrima: r.materiaPrima,
                              cantidad: r.falta == null ? "" : String(r.falta),
                              estado: "Pendiente de definir",
                              produccionesAfecta: r.productoElaborar,
                            });
                            setFormOpen(true);
                          }}
                        >
                          Crear compra MP
                        </Button>
                      ) : null,
                  } as OperationalTableColumn<MpControlRow>,
                ]
              : []),
          ]}
          rows={pageRows as MpControlRow[]}
          rowKey={(r) => r.id}
          emptyMessage="Sin control semanal."
        />
      )}

      {tab === "Compras MP" && (
        <OperationalTable
          columns={compraColumns}
          rows={pageRows as MpCompraRow[]}
          rowKey={(r) => r.id}
          emptyMessage="Sin compras MP."
        />
      )}

      <div className="mt-3 flex gap-2 text-sm">
        <Button type="button" variant="secondary" disabled={page === 0} onClick={() => setPage((p) => p - 1)}>
          Anterior
        </Button>
        <span>
          Página {page + 1} / {Math.max(1, Math.ceil(rows.length / pageSize))}
        </span>
        <Button
          type="button"
          variant="secondary"
          disabled={(page + 1) * pageSize >= rows.length}
          onClick={() => setPage((p) => p + 1)}
        >
          Siguiente
        </Button>
      </div>

      {formOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
          <div className="max-h-[90vh] w-full max-w-lg overflow-y-auto rounded bg-[var(--os-surface)] p-5 shadow">
            <h3 className="mb-3 text-lg font-semibold">{formDraft.id ? "Editar" : "Nuevo"} — {tab}</h3>
            <div className="grid grid-cols-2 gap-3 text-sm">
              {formFields.map(([key, label]) => (
                <label key={key} className="flex flex-col gap-1">
                  <span>{label}</span>
                  {key === "estado" && tab === "Compras MP" ? (
                    <select
                      className="rounded border px-2 py-1"
                      value={formDraft.estado ?? ""}
                      onChange={(e) => setFormDraft({ ...formDraft, estado: e.target.value })}
                    >
                      <option value="">(vacío)</option>
                      {[
                        "Pendiente de definir",
                        "Solicitada",
                        "Cotizando",
                        "Comprada",
                        "En camino",
                        "Entrega demorada",
                        "En planta",
                        "Aporta cliente",
                        "Cancelada",
                      ].map((s) => (
                        <option key={s} value={s}>
                          {s}
                        </option>
                      ))}
                    </select>
                  ) : (
                    <input
                      className="rounded border px-2 py-1"
                      value={formDraft[key] ?? ""}
                      onChange={(e) => setFormDraft({ ...formDraft, [key]: e.target.value })}
                    />
                  )}
                </label>
              ))}
              {tab === "Ingresos MP" && (
                <label className="flex flex-col gap-1">
                  TOTAL (auto)
                  <input
                    readOnly
                    className="rounded border bg-[var(--os-bg)] px-2 py-1"
                    value={liveTotal == null ? "" : String(liveTotal)}
                  />
                </label>
              )}
            </div>
            <div className="mt-4 flex justify-end gap-2">
              <Button type="button" variant="secondary" onClick={() => setFormOpen(false)}>
                Cancelar
              </Button>
              <Button type="button" onClick={() => void saveDraft()}>
                Guardar
              </Button>
            </div>
          </div>
        </div>
      )}

      <ConfirmDialog
        open={Boolean(ingresoPrefill)}
        onOpenChange={(o) => !o && setIngresoPrefill(null)}
        title="¿Registrar como Ingreso MP?"
        description="La compra pasó a «En planta». No se aumenta stock hasta confirmar el ingreso."
        confirmLabel="Abrir Ingreso MP"
        onConfirm={() => {
          if (!ingresoPrefill) return;
          setTab("Ingresos MP");
          setFormDraft({
            fecha: new Date().toISOString().slice(0, 10),
            descripcion: String(ingresoPrefill.descripcion ?? ""),
            cantidad: ingresoPrefill.cantidad == null ? "" : String(ingresoPrefill.cantidad),
            proveedor: String(ingresoPrefill.proveedor ?? ""),
            compraId: String(ingresoPrefill.compraId ?? ""),
            bultos: "1",
          });
          setFormOpen(true);
          setIngresoPrefill(null);
        }}
      />

      <ConfirmDialog
        open={Boolean(deleteTarget)}
        onOpenChange={(o) => !o && setDeleteTarget(null)}
        title="Eliminar registro"
        description="Confirmá la eliminación. Si impacta stock, se revertirá con auditoría."
        confirmLabel="Eliminar"
        onConfirm={() => {
          if (!deleteTarget) return;
          void mutateInventory({
            action: "delete",
            resource: TAB_TO_RESOURCE[tab],
            id: deleteTarget.id,
            reason: deleteTarget.reason || "Eliminación MP",
          })
            .then(reload)
            .finally(() => setDeleteTarget(null));
        }}
      />

      <ExcelPasteDialog
        open={pasteOpen}
        onOpenChange={setPasteOpen}
        fields={
          tab === "Stock"
            ? [
                { key: "proveedor", label: "PROVEEDOR" },
                { key: "cliente", label: "CLIENTE" },
                { key: "descripcion", label: "DESCRIPCIÓN MATERIA PRIMA" },
                { key: "cantidadKg", label: "CANTIDAD (KG)" },
                { key: "ubicacion", label: "UBICACIÓN" },
                { key: "lote", label: "LOTE" },
                { key: "vencimiento", label: "VENCIMIENTO" },
                { key: "estadoStock", label: "ESTADO STOCK", calculated: true },
                { key: "diasAlVence", label: "DÍAS AL VENCE", calculated: true },
                { key: "estadoVencimiento", label: "ESTADO VENCIMIENTO", calculated: true },
                { key: "origen", label: "ORIGEN" },
              ]
            : tab === "Ingresos MP"
              ? [
                  { key: "fecha", label: "FECHA" },
                  { key: "ingresoNro", label: "INGRESO Nº" },
                  { key: "proveedor", label: "PROVEEDOR" },
                  { key: "cliente", label: "CLIENTE" },
                  { key: "remitoNro", label: "REMITO Nº" },
                  { key: "codigo", label: "CÓDIGO" },
                  { key: "descripcion", label: "DESCRIPCIÓN MATERIA PRIMA" },
                  { key: "bultos", label: "BULTOS" },
                  { key: "cantidad", label: "CANTIDAD (kg/u)" },
                  { key: "total", label: "TOTAL", calculated: true },
                  { key: "ubicacion", label: "UBICACIÓN" },
                  { key: "lote", label: "LOTE" },
                  { key: "vencimiento", label: "VENCIMIENTO" },
                ]
              : tab === "Control semanal"
                ? [
                    { key: "productoElaborar", label: "PRODUCTO A ELABORAR" },
                    { key: "materiaPrima", label: "MATERIA PRIMA" },
                    { key: "cantNecesaria", label: "CANT. NECESARIA" },
                    { key: "enInventario", label: "EN INVENTARIO" },
                    { key: "falta", label: "FALTA", calculated: true },
                    { key: "estado", label: "ESTADO", calculated: true },
                    { key: "observacion", label: "OBSERVACIÓN" },
                  ]
                : [
                    { key: "fecha", label: "FECHA" },
                    { key: "materiaPrima", label: "MATERIA PRIMA" },
                    { key: "cantidad", label: "CANTIDAD" },
                    { key: "unidad", label: "UNIDAD" },
                    { key: "proveedor", label: "PROVEEDOR" },
                    { key: "fechaEntrega", label: "FECHA ENTREGA" },
                    { key: "produccionesAfecta", label: "QUÉ PRODUCCIONES AFECTA" },
                    { key: "estado", label: "ESTADO" },
                    { key: "nota", label: "NOTA" },
                  ]
        }
        fieldAliases={{
          proveedor: ["proveedor"],
          cliente: ["cliente"],
          descripcion: ["descripcion", "descripción", "descripcion materia prima", "materia prima"],
          cantidadKg: ["cantidad", "cantidad (kg)", "cantidad kg"],
          ubicacion: ["ubicacion", "ubicación"],
          lote: ["lote"],
          vencimiento: ["vencimiento", "vto"],
          origen: ["origen"],
          fecha: ["fecha"],
          ingresoNro: ["ingreso", "ingreso n", "ingreso nº"],
          remitoNro: ["remito"],
          codigo: ["codigo", "código"],
          bultos: ["bultos"],
          cantidad: ["cantidad"],
          total: ["total"],
          productoElaborar: ["producto", "producto a elaborar"],
          materiaPrima: ["materia prima"],
          cantNecesaria: ["cant necesaria", "cantidad necesaria"],
          enInventario: ["en inventario", "inventario"],
          falta: ["falta"],
          estado: ["estado"],
          observacion: ["observacion", "observación"],
          unidad: ["unidad"],
          fechaEntrega: ["fecha entrega"],
          produccionesAfecta: ["producciones", "que producciones"],
          nota: ["nota"],
        }}
        ignoreKeys={["total", "falta", "estado", "estadoStock", "diasAlVence", "estadoVencimiento"]}
        onConfirm={async (mapped) => {
          for (const m of mapped) {
            setFormDraft(m);
            if (tab === "Stock") {
              await mutateInventory({
                action: "upsert",
                resource: "mp_stock",
                payload: {
                  proveedor: m.proveedor ?? "",
                  cliente: m.cliente ?? "",
                  descripcion: m.descripcion ?? "",
                  cantidadKg: parseOptionalNumber(m.cantidadKg),
                  ubicacion: m.ubicacion ?? "",
                  lote: m.lote ?? "",
                  vencimiento: m.vencimiento ?? "",
                  origen: m.origen ?? "import",
                },
              });
            } else if (tab === "Ingresos MP") {
              await mutateInventory({
                action: "upsert",
                resource: "mp_ingresos",
                payload: {
                  fecha: m.fecha ?? "",
                  ingresoNro: m.ingresoNro ?? "",
                  proveedor: m.proveedor ?? "",
                  cliente: m.cliente ?? "",
                  remitoNro: m.remitoNro ?? "",
                  codigo: m.codigo ?? "",
                  descripcion: m.descripcion ?? "",
                  bultos: parseOptionalNumber(m.bultos),
                  cantidad: parseOptionalNumber(m.cantidad),
                  ubicacion: m.ubicacion ?? "",
                  lote: m.lote ?? "",
                  vencimiento: m.vencimiento ?? "",
                },
              });
            } else if (tab === "Control semanal") {
              await mutateInventory({
                action: "upsert",
                resource: "mp_control",
                payload: {
                  productoElaborar: m.productoElaborar ?? "",
                  materiaPrima: m.materiaPrima ?? "",
                  cantNecesaria: parseOptionalNumber(m.cantNecesaria),
                  enInventario: parseOptionalNumber(m.enInventario),
                  observacion: m.observacion ?? "",
                },
              });
            } else {
              await mutateInventory({
                action: "upsert",
                resource: "mp_compras",
                payload: {
                  fecha: m.fecha ?? "",
                  materiaPrima: m.materiaPrima ?? "",
                  cantidad: parseOptionalNumber(m.cantidad),
                  unidad: m.unidad ?? "",
                  proveedor: m.proveedor ?? "",
                  fechaEntrega: m.fechaEntrega ?? "",
                  produccionesAfecta: m.produccionesAfecta ?? "",
                  estado: m.estado ?? "",
                  nota: m.nota ?? "",
                },
              });
            }
          }
          await reload();
        }}
      />
    </TwinShell>
  );
}
