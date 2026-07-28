"use client";

/**
 * Hub MP — pestañas: Stock | Ingresos MP | Control semanal | Compras MP | COA'S.
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import { ClipboardPaste, Pencil, Plus, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/dialog";
import { LifecycleConfirmDialog } from "../components/lifecycle-confirm-dialog";
import { syntheticLifecycleItem } from "../components/lifecycle-synthetic";
import { TwinShell } from "@/features/os/shell/twin-shell";
import {
  fetchInventory,
  mutateInventory,
  InventoryClientError,
} from "@/features/os/operational/adapters/inventory-client";
import { ExcelPasteDialog } from "@/features/os/operational/components/excel-paste-dialog";
import { MpWeeklyControlPanel } from "@/features/os/operational/components/mp-weekly-control-panel";
import { MpCoasPanel } from "@/features/os/operational/components/mp-coas-panel";
import { MpStockAjusteModal } from "@/features/os/operational/components/mp-stock-ajuste-modal";
import { MpStockLedgerPanel } from "@/features/os/operational/components/mp-stock-ledger-panel";
import { SchemaPendingBanner } from "@/components/ui/schema-pending-banner";
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
  isMpInternalCodigo,
  type MpCompraRow,
  type MpControlRow,
  type MpIngresoRow,
  type MpStockRow,
} from "@/lib/inventory/types";
import { canWriteInventory } from "@/lib/inventory/rbac";
import { usePreviewSession } from "@/features/os/session/preview-context";
import {
  ACTOR_EMAIL_HEADER,
  ACTOR_SECTOR_HEADER,
} from "@/lib/orders/actor";
import { FormulasAdminPanel } from "@/features/os/operational/components/formulas-admin-panel";

export type MpHubTab = (typeof MP_TABS)[number];

const STOCK_MOBILE_VISIBLE = new Set(["CÓDIGO", "DESCRIPCIÓN MATERIA PRIMA", "ESTADO STOCK"]);
const INGRESO_MOBILE_VISIBLE = new Set(["CÓDIGO", "DESCRIPCIÓN MATERIA PRIMA"]);
const COMPRA_MOBILE_VISIBLE = new Set(["MATERIA PRIMA", "ESTADO"]);
/** Tablas MP anchas: secundarias solo desde xl; bajo eso → “Más datos”. */
const COLLAPSE_WIDE = "xl" as const;

const TAB_TO_RESOURCE = {
  Stock: "mp_stock",
  "Ingresos MP": "mp_ingresos",
  "Control semanal": "mp_control",
  "Compras MP": "mp_compras",
  "COA'S": "mp_stock",
} as const;

export function MpHubView({ initialTab = "Stock" as MpHubTab }: { initialTab?: MpHubTab }) {
  const { email, sectorId } = usePreviewSession();
  const [tab, setTab] = useState<MpHubTab>(initialTab);
  const canWrite = canWriteInventory(sectorId, TAB_TO_RESOURCE[tab]);
  const [banner, setBanner] = useState<string | null>(null);
  const [persistence, setPersistence] = useState(true);
  const [schemaPending0005, setSchemaPending0005] = useState(false);
  const [ajusteOpen, setAjusteOpen] = useState(false);
  const [ledgerKey, setLedgerKey] = useState(0);
  const [search, setSearch] = useState("");
  const [pasteOpen, setPasteOpen] = useState(false);
  const [stock, setStock] = useState<MpStockRow[]>([]);
  const [ingresos, setIngresos] = useState<MpIngresoRow[]>([]);
  const [control, setControl] = useState<MpControlRow[]>([]);
  const [compras, setCompras] = useState<MpCompraRow[]>([]);
  const [ingresoPrefill, setIngresoPrefill] = useState<Record<string, unknown> | null>(null);
  const [formOpen, setFormOpen] = useState(false);
  const [formDraft, setFormDraft] = useState<Record<string, string>>({});
  const [deleteTarget, setDeleteTarget] = useState<{ id: string; label: string } | null>(null);
  const [page, setPage] = useState(0);
  const pageSize = 25;
  const formulaSession = useMemo(
    () => ({ email: email ?? "", sector: sectorId }),
    [email, sectorId]
  );

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

    // Probe schema 0005 via ledger (vacío / schemaPending)
    try {
      const probe = await fetch("/api/v1/mp-stock/ledger", {
        headers: {
          [ACTOR_EMAIL_HEADER]: email ?? "",
          [ACTOR_SECTOR_HEADER]: sectorId,
        },
      });
      const body = (await probe.json()) as { schemaPending?: boolean };
      setSchemaPending0005(Boolean(body.schemaPending));
    } catch {
      /* ignore */
    }
  }, [email, sectorId]);

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
      return stock.filter(
        (r) =>
          !q ||
          [r.descripcion, r.proveedor, r.cliente, r.lote, r.ubicacion, r.codigo, r.productosAsociados]
            .join(" ")
            .toLowerCase()
            .includes(q)
      );
    }
    if (tab === "Ingresos MP") {
      return ingresos.filter((r) => {
        const status = r.status ?? "BORRADOR";
        const statusVisible =
          status !== "ANULADO" ||
          q.includes("anulado") ||
          q === status.toLowerCase();
        if (!statusVisible) return false;
        if (!q) return true;
        return [r.ingresoNro, r.descripcion, r.proveedor, r.cliente, r.lote, r.codigo, r.producto, r.status]
          .join(" ")
          .toLowerCase()
          .includes(q);
      });
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
            producto: formDraft.producto ?? "",
            descripcion: formDraft.descripcion ?? "",
            bultos: parseOptionalNumber(formDraft.bultos),
            cantidad: parseOptionalNumber(formDraft.cantidad),
            ubicacion: formDraft.ubicacion ?? "",
            lote: formDraft.lote ?? "",
            vencimiento: formDraft.vencimiento ?? "",
            confirm: formDraft.confirm === "1" || undefined,
            confirmDemote: formDraft.confirmDemote === "1" || undefined,
          },
        });
        const saved = result.data as MpIngresoRow;
        if (saved.stockMessage && !saved.stockImpacted) {
          setBanner(saved.stockMessage);
        }
        if (formDraft.compraId) {
          await mutateInventory({
            action: "link_ingreso",
            resource: "mp_compras",
            id: formDraft.compraId,
            payload: { ingresoId: saved.id },
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
      CÓDIGO: "codigo",
      PRODUCTO: "productosAsociados",
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
    if (label === "CÓDIGO") {
      return {
        key: label,
        header: label,
        hideOnMobile: false,
        render: (r) => {
          const pending = Boolean(r.codigoPendiente) || isMpInternalCodigo(r.codigo);
          return (
            <span className="inline-flex flex-col gap-0.5">
              <span>{displayCell(r.codigo)}</span>
              {pending ? (
                <span
                  className="w-fit rounded bg-amber-100 px-1.5 py-0.5 text-[10px] font-medium text-amber-900"
                  title="Identidad interna: completar código de proveedor"
                  data-testid={`mp-stock-codigo-pendiente-${r.id}`}
                >
                  Sin código de proveedor
                </span>
              ) : null}
            </span>
          );
        },
      };
    }
    return {
      key: label,
      header: label,
      hideOnMobile: STOCK_MOBILE_VISIBLE.has(label) ? false : COLLAPSE_WIDE,
      render: (r) => displayCell(r[k]),
    };
  });

  function statusChip(status: MpIngresoRow["status"] | undefined) {
    const s = status ?? "BORRADOR";
    const cls =
      s === "CONFIRMADO"
        ? "bg-[var(--genus-success-soft)] text-[var(--genus-success)]"
        : s === "ANULADO"
          ? "bg-[var(--os-surface-muted)] text-[var(--os-text-muted)]"
          : "bg-amber-100 text-amber-900";
    return (
      <span className={`inline-block rounded px-2 py-0.5 text-xs font-medium ${cls}`}>{s}</span>
    );
  }

  async function confirmIngreso(row: MpIngresoRow) {
    try {
      const result = await mutateInventory({
        action: "upsert",
        resource: "mp_ingresos",
        payload: {
          id: row.id,
          codigo: row.codigo,
          producto: row.producto,
          descripcion: row.descripcion,
          bultos: row.bultos,
          cantidad: row.cantidad,
          confirm: true,
        },
      });
      const saved = result.data as MpIngresoRow;
      if (saved.stockMessage && !saved.stockImpacted) {
        setBanner(saved.stockMessage);
      } else {
        setBanner(null);
      }
      await reload();
    } catch (e) {
      setBanner(e instanceof InventoryClientError ? e.message : "Error al confirmar");
    }
  }

  const ingresoColumns: OperationalTableColumn<MpIngresoRow>[] = [
    ...MP_INGRESO_COLUMNS.map((label) => {
      const map: Record<string, keyof MpIngresoRow> = {
        FECHA: "fecha",
        "INGRESO Nº": "ingresoNro",
        PROVEEDOR: "proveedor",
        CLIENTE: "cliente",
        "REMITO Nº": "remitoNro",
        CÓDIGO: "codigo",
        PRODUCTO: "producto",
        "DESCRIPCIÓN MATERIA PRIMA": "descripcion",
        BULTOS: "bultos",
        "CANTIDAD (kg/u)": "cantidad",
        TOTAL: "total",
        UBICACIÓN: "ubicacion",
        LOTE: "lote",
        VENCIMIENTO: "vencimiento",
      };
      const k = map[label];
      return {
        key: label,
        header: label,
        hideOnMobile: INGRESO_MOBILE_VISIBLE.has(label) ? false : COLLAPSE_WIDE,
        render: (r: MpIngresoRow) => displayCell(r[k]),
      } as OperationalTableColumn<MpIngresoRow>;
    }),
    {
      key: "status",
      header: "ESTADO",
      render: (r) => statusChip(r.status),
    },
    ...(canWrite
      ? [
          {
            key: "acciones",
            header: "",
            render: (r: MpIngresoRow) => {
              const qtyReady =
                Boolean((r.codigo ?? "").trim()) &&
                ((r.total != null && r.total > 0) || (r.cantidad != null && r.cantidad > 0));
              return (
                <div className="flex flex-wrap items-center gap-1">
                  {r.status === "BORRADOR" && qtyReady ? (
                    <Button
                      type="button"
                      size="sm"
                      variant="secondary"
                      onClick={() => void confirmIngreso(r)}
                    >
                      Confirmar
                    </Button>
                  ) : null}
                  {r.status !== "ANULADO" ? (
                    <>
                      <button
                        type="button"
                        title="Editar"
                        onClick={() => {
                          setFormDraft({
                            id: r.id,
                            fecha: r.fecha,
                            ingresoNro: r.ingresoNro,
                            proveedor: r.proveedor,
                            cliente: r.cliente,
                            remitoNro: r.remitoNro,
                            codigo: r.codigo,
                            producto: r.producto ?? "",
                            descripcion: r.descripcion,
                            bultos: r.bultos == null ? "" : String(r.bultos),
                            cantidad: r.cantidad == null ? "" : String(r.cantidad),
                            ubicacion: r.ubicacion,
                            lote: r.lote,
                            vencimiento: r.vencimiento,
                          });
                          setFormOpen(true);
                        }}
                      >
                        <Pencil className="size-4" />
                      </button>
                      <button
                        type="button"
                        title="Borrar"
                        aria-label="Borrar"
                        onClick={() =>
                          setDeleteTarget({
                            id: r.id,
                            label: r.descripcion || r.codigo || r.id,
                          })
                        }
                      >
                        <Trash2 className="size-4 text-red-700" />
                      </button>
                    </>
                  ) : null}
                </div>
              );
            },
          } as OperationalTableColumn<MpIngresoRow>,
        ]
      : []),
  ];

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
    return {
      key: label,
      header: label,
      hideOnMobile: COMPRA_MOBILE_VISIBLE.has(label) ? false : COLLAPSE_WIDE,
      render: (r) => displayCell(r[k]),
    };
  });

  const formFields =
    tab === "Stock"
      ? [
          ["codigo", "CÓDIGO"],
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
            ["producto", "PRODUCTO"],
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
        <div className="mb-4 rounded border border-[var(--genus-warning)]/30 bg-[var(--genus-warning-soft)] px-3 py-2 text-sm">
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
        {canWrite && tab !== "Control semanal" && tab !== "COA'S" && (
          <>
            <Button type="button" onClick={openNew}>
              <Plus className="mr-1 size-4" /> Nuevo
            </Button>
            <Button type="button" variant="secondary" onClick={() => setPasteOpen(true)}>
              <ClipboardPaste className="mr-1 size-4" /> Pegar desde Excel
            </Button>
          </>
        )}
        {tab === "Stock" && canWrite ? (
          <Button
            type="button"
            data-testid="mp-stock-ajuste-open"
            disabled={schemaPending0005}
            onClick={() => setAjusteOpen(true)}
          >
            Registrar ajuste
          </Button>
        ) : null}
        {tab !== "Control semanal" && tab !== "COA'S" ? (
        <input
          className="rounded border px-3 py-1.5 text-sm"
          placeholder="Buscar…"
          value={search}
          onChange={(e) => {
            setSearch(e.target.value);
            setPage(0);
          }}
        />
        ) : null}
      </div>

      {tab === "Stock" ? <SchemaPendingBanner show={schemaPending0005} /> : null}

      {tab === "Stock" && (
        <>
        {stock.some((r) => r.codigoPendiente || isMpInternalCodigo(r.codigo)) ? (
          <div
            className="mb-3 rounded border border-[var(--genus-warning)]/30 bg-[var(--genus-warning-soft)] px-3 py-2 text-sm"
            data-testid="mp-stock-codigo-pendiente-banner"
          >
            Hay filas de Stock con identidad interna (sin código de proveedor). Completá el
            código desde Ingresos MP cuando esté disponible.
          </div>
        ) : null}
        <OperationalTable
          columns={[
            ...stockColumns,
            ...(canWrite
              ? [
                  {
                    key: "acciones",
                    header: "",
                    render: (r: MpStockRow) => (
                      <div className="flex flex-wrap items-center gap-1">
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
                              codigo: r.codigo,
                            });
                            setFormOpen(true);
                          }}
                        >
                          <Pencil className="size-4" />
                        </button>
                        <button
                          type="button"
                          title="Borrar"
                          aria-label="Borrar"
                          onClick={() =>
                            setDeleteTarget({
                              id: r.id,
                              label: r.descripcion || r.codigo || r.id,
                            })
                          }
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
        <div className="mt-4">
          <MpStockLedgerPanel key={ledgerKey} schemaPending={schemaPending0005} />
        </div>
        </>
      )}

      {tab === "Ingresos MP" && (
        <>
          {pageRows.some(
            (r) =>
              (r as MpIngresoRow).status === "BORRADOR" &&
              !(r as MpIngresoRow).stockImpacted
          ) ? (
            <div className="mb-3 rounded border border-[var(--genus-warning)]/30 bg-[var(--genus-warning-soft)] px-3 py-2 text-sm">
              Hay borradores sin afectar Stock (falta Cantidad/Total). Completá y confirmá
              para impactar inventario. Los ingresos sin código de proveedor usan identidad
              interna y aparecen en Stock con advertencia.
            </div>
          ) : null}
          <OperationalTable
            columns={ingresoColumns}
            rows={pageRows as MpIngresoRow[]}
            rowKey={(r) => r.id}
            emptyMessage="Sin ingresos MP."
          />
        </>
      )}

      {tab === "Control semanal" && <MpWeeklyControlPanel />}

      {tab === "COA'S" && <MpCoasPanel />}

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

      <MpStockAjusteModal
        open={ajusteOpen}
        onClose={() => setAjusteOpen(false)}
        schemaPending={schemaPending0005}
        onSaved={() => {
          setLedgerKey((k) => k + 1);
          void reload();
        }}
      />

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

      <LifecycleConfirmDialog
        pending={
          deleteTarget
            ? syntheticLifecycleItem(
                tab === "Ingresos MP" ? "anular" : "eliminar",
                tab === "Ingresos MP" ? "Anular ingreso MP" : "Eliminar registro",
                tab === "Ingresos MP"
                  ? "Se anula el ingreso (queda registrado). Si impactó stock, se revierte el ledger."
                  : "Confirmá la eliminación. Si impacta stock, se revertirá con auditoría."
              )
            : null
        }
        forceReason
        entityLabel={deleteTarget?.label}
        onClose={() => setDeleteTarget(null)}
        onConfirm={async (reason) => {
          if (!deleteTarget) return;
          await mutateInventory({
            action: tab === "Ingresos MP" ? "anular" : "delete",
            resource: TAB_TO_RESOURCE[tab],
            id: deleteTarget.id,
            reason,
          });
          await reload();
        }}
      />

      <ExcelPasteDialog
        open={pasteOpen}
        onOpenChange={setPasteOpen}
        fields={
          tab === "Stock"
            ? [
                { key: "codigo", label: "CÓDIGO" },
                { key: "producto", label: "PRODUCTO" },
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
                  { key: "producto", label: "PRODUCTO" },
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
          codigo: ["codigo", "código"],
          producto: ["producto", "producto destino", "productos"],
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
                  producto: m.producto ?? "",
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

      <div className="mt-6">
        <FormulasAdminPanel session={formulaSession} sectorId={sectorId} />
      </div>
    </TwinShell>
  );
}
