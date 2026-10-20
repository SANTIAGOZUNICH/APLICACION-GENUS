"use client";

/**
 * Hub MP — pestañas: Stock | Ingresos MP | Control semanal | Compras MP | COA'S.
 */

import { readOnlyReason } from "@/features/os/operational/lib/readonly-reasons";
import { MP_TRACE_FIELDS, ingresoTraceNote, originalIngresoByLot, stockTraceNote, type MpTraceField } from "@/features/os/operational/lib/mp-trazabilidad";
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
  patchInventoryCells,
  InventoryClientError,
} from "@/features/os/operational/adapters/inventory-client";
import type { GenusGridDraftRows, GenusGridRowDelete } from "@/components/data-grid/genus-grid";
import {
  MP_INGRESO_DRAFT_CREATE_KEYS,
  MP_INGRESO_DRAFT_REQUIRED_KEYS,
  MP_STOCK_DRAFT_CREATE_KEYS,
  MP_STOCK_DRAFT_REQUIRED_KEYS,
  ingresoPayloadFromDraft,
  stockPayloadFromDraft,
} from "@/lib/inventory/mp-draft-rows";
import { ExcelPasteDialog } from "@/features/os/operational/components/excel-paste-dialog";
import { MpWeeklyControlPanel } from "@/features/os/operational/components/mp-weekly-control-panel";
import { MpCoasPanel } from "@/features/os/operational/components/mp-coas-panel";
import { MpStockAjusteModal } from "@/features/os/operational/components/mp-stock-ajuste-modal";
import { MpStockLedgerPanel } from "@/features/os/operational/components/mp-stock-ledger-panel";
import { SchemaPendingBanner } from "@/components/ui/schema-pending-banner";
import { OsClampedText } from "@/features/os/operational/components/os-clamped-text";
import {
  OperationalTable,
  type OperationalTableColumn,
} from "@/features/os/operational/components/operational-ui";
import {
  bulkDeleteConfirmMessage,
  ListSelectionEnterButton,
  ListSelectionToolbar,
  useListSelectionMode,
} from "@/features/os/operational/components/list-selection-mode";
import {
  calcMpEstadoStock,
  calcMpEstadoVencimiento,
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
import { MpIngresoCrearEtiquetaButton } from "@/features/os/operational/components/mp-ingreso-crear-etiqueta";
import { FormulasAdminPanel } from "@/features/os/operational/components/formulas-admin-panel";
import { usePreviewContext, usePreviewSession } from "@/features/os/session/preview-context";
import {
  ACTOR_EMAIL_HEADER,
  ACTOR_SECTOR_HEADER,
} from "@/lib/auth/header-names";
import { SortSelect } from "@/features/os/operational/components/sort-select";
import { useInventoryCellEditing } from "@/features/os/operational/hooks/use-inventory-cells";
import { useMpSheetEditing } from "@/features/os/operational/hooks/use-mp-sheet-cells";
import { IngresoRemitoFotosButton, useIngresoAdjuntoCounts } from "@/features/os/operational/components/ingreso-remito-fotos";
import { IngresoConRemitoButtons } from "@/features/os/operational/components/ingreso-con-remito";
import { canManageAdjuntos, canViewAdjuntos } from "@/lib/inventory/ingreso-adjuntos-rules";
import {
  applySort,
  compareDates,
  compareNumbers,
  compareStrings,
  compareVtoNearest,
  type SortOption,
} from "@/lib/sorting/sort-contract";

/**
 * Orden por defecto de TODA la hoja de Materias Primas: el orden en que se cargaron los registros (la API ya los trae
 * ordenados por `load_seq`). `Array.sort` es estable y este comparador devuelve 0, así que NO reordena nada: elegir otra
 * opción es una decisión explícita del usuario y volver acá recupera exactamente el orden de carga.
 */
export const MP_ORDEN_CARGA_KEY = "carga";
export const MP_ORDEN_CARGA_LABEL = "Orden de carga (original)";
const ordenCarga = <T,>(): SortOption<T> => ({ key: MP_ORDEN_CARGA_KEY, label: MP_ORDEN_CARGA_LABEL, compare: () => 0 });

export const MP_STOCK_SORT_OPTIONS: SortOption<MpStockRow>[] = [
  ordenCarga<MpStockRow>(),
  { key: "codigo_asc", label: "Código A-Z", compare: (a, b) => compareStrings(a.codigo, b.codigo, "asc") },
  { key: "descripcion_asc", label: "Descripción A-Z", compare: (a, b) => compareStrings(a.descripcion, b.descripcion, "asc") },
  { key: "cantidad_desc", label: "Cantidad mayor a menor", compare: (a, b) => compareNumbers(a.cantidadKg, b.cantidadKg, "desc") },
  { key: "cantidad_asc", label: "Cantidad menor a mayor", compare: (a, b) => compareNumbers(a.cantidadKg, b.cantidadKg, "asc") },
  { key: "vto_asc", label: "VTO más próximo", compare: (a, b) => compareVtoNearest(a.vencimiento, b.vencimiento) },
];

export const MP_INGRESO_SORT_OPTIONS: SortOption<MpIngresoRow>[] = [
  ordenCarga<MpIngresoRow>(),
  { key: "fecha_desc", label: "Más recientes", compare: (a, b) => compareDates(a.fecha, b.fecha, "desc") },
  { key: "fecha_asc", label: "Más antiguos", compare: (a, b) => compareDates(a.fecha, b.fecha, "asc") },
  { key: "codigo_asc", label: "Código A-Z", compare: (a, b) => compareStrings(a.codigo, b.codigo, "asc") },
  { key: "proveedor_asc", label: "Proveedor A-Z", compare: (a, b) => compareStrings(a.proveedor, b.proveedor, "asc") },
  { key: "total_desc", label: "Total mayor a menor", compare: (a, b) => compareNumbers(a.total, b.total, "desc") },
  { key: "total_asc", label: "Total menor a mayor", compare: (a, b) => compareNumbers(a.total, b.total, "asc") },
  { key: "vto_asc", label: "VTO más próximo", compare: (a, b) => compareVtoNearest(a.vencimiento, b.vencimiento) },
];

export const MP_COMPRA_SORT_OPTIONS: SortOption<MpCompraRow>[] = [
  ordenCarga<MpCompraRow>(),
  { key: "fecha_desc", label: "Más recientes", compare: (a, b) => compareDates(a.fecha, b.fecha, "desc") },
  { key: "fecha_asc", label: "Más antiguos", compare: (a, b) => compareDates(a.fecha, b.fecha, "asc") },
  { key: "entrega_asc", label: "Entrega más próxima", compare: (a, b) => compareDates(a.fechaEntrega, b.fechaEntrega, "asc") },
  { key: "materia_asc", label: "Materia prima A-Z", compare: (a, b) => compareStrings(a.materiaPrima, b.materiaPrima, "asc") },
  { key: "cantidad_desc", label: "Cantidad mayor a menor", compare: (a, b) => compareNumbers(a.cantidad, b.cantidad, "desc") },
  { key: "cantidad_asc", label: "Cantidad menor a mayor", compare: (a, b) => compareNumbers(a.cantidad, b.cantidad, "asc") },
];

export type MpHubTab = (typeof MP_TABS)[number];

/** Encabezados breves — no cortar a PROD…/PROVE… */
const STOCK_HEADER_SHORT: Record<string, string> = {
  CÓDIGO: "Código",
  PRODUCTO: "Producto",
  PROVEEDOR: "Proveedor",
  CLIENTE: "Cliente",
  "DESCRIPCIÓN MATERIA PRIMA": "Descripción",
  "CANTIDAD (KG)": "Kg lote",
  UBICACIÓN: "Ubicación",
  LOTE: "Lote",
  VENCIMIENTO: "Vencimiento",
  "ESTADO STOCK": "Estado stock",
  "DÍAS AL VENCE": "Días VTO",
  "ESTADO VENCIMIENTO": "Estado VTO",
  ORIGEN: "Origen",
};

/** Siempre visibles (móvil → desktop). */
const STOCK_ALWAYS = new Set([
  "CÓDIGO",
  "DESCRIPCIÓN MATERIA PRIMA",
  "ESTADO STOCK",
]);
/** Esenciales desde ~1024px (1366/1440). */
const STOCK_FROM_LG = new Set(["PRODUCTO", "CANTIDAD (KG)", "LOTE", "VENCIMIENTO"]);
/** Secundarias solo desde 2xl (~1536+ / 1920). */
const STOCK_FROM_2XL = new Set([
  "PROVEEDOR",
  "CLIENTE",
  "UBICACIÓN",
  "DÍAS AL VENCE",
  "ESTADO VENCIMIENTO",
  "ORIGEN",
]);

const INGRESO_ALWAYS = new Set(["CÓDIGO", "DESCRIPCIÓN MATERIA PRIMA", "CANTIDAD (kg/u)"]);
const INGRESO_FROM_LG = new Set(["FECHA", "PRODUCTO", "LOTE", "VENCIMIENTO"]);
const COMPRA_ALWAYS = new Set(["MATERIA PRIMA", "ESTADO"]);
const COMPRA_FROM_LG = new Set(["CANTIDAD", "PROVEEDOR", "FECHA ENTREGA"]);

function stockCollapse(
  label: string
): false | "lg" | "2xl" {
  if (STOCK_ALWAYS.has(label)) return false;
  if (STOCK_FROM_LG.has(label)) return "lg";
  if (STOCK_FROM_2XL.has(label)) return "2xl";
  return "2xl";
}

const TAB_TO_RESOURCE = {
  Stock: "mp_stock",
  "Ingresos MP": "mp_ingresos",
  "Control semanal": "mp_control",
  "Compras MP": "mp_compras",
  "COA'S": "mp_stock",
} as const;

/** Planilla de Ingresos MP: TODAS las columnas se editan (TOTAL corrige la cantidad por bulto; INGRESO Nº no se repite). */
const MP_INGRESO_CELL_FIELDS: Record<string, string> = {
  "INGRESO Nº": "ingresoNro",
  FECHA: "fecha",
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
/** Planilla de Compras MP: todas las columnas. */
const MP_COMPRA_CELL_FIELDS: Record<string, string> = {
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

/** Stock MP: TODAS las columnas se editan en la celda (las que mueven saldo, con motivo en la misma planilla). */
const MP_STOCK_CELL_FIELDS: Record<string, string> = {
  CÓDIGO: "codigo",
  PRODUCTO: "producto",
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

/** Nota de la celda en Stock MP: estados fijados a mano y códigos a revisar (no bloquea la edición). */
function stockCellNote(label: string, r: MpStockRow): string | null {
  if (label === "ESTADO STOCK" && r.estadoStockManual?.trim()) {
    return `Fijado a mano en la planilla (calculado: ${calcMpEstadoStock(r.cantidadKg)}). Vaciá la celda para volver al cálculo.`;
  }
  if (label === "ESTADO VENCIMIENTO" && r.estadoVencimientoManual?.trim()) {
    return `Fijado a mano en la planilla (calculado: ${calcMpEstadoVencimiento(r.diasAlVence)}). Vaciá la celda para volver al cálculo.`;
  }
  if (label === "CÓDIGO") {
    const code = displayCell(r.codigo);
    if (!/[\p{L}\p{N}]/u.test(code)) return "Código inválido: no tiene letras ni números. Corregilo en la celda (traspasa el saldo con motivo).";
    if (r.codigosAnteriores?.length) return `Código corregido en la planilla (antes: ${r.codigosAnteriores.join(", ")}). Los movimientos históricos quedan con el código anterior y su saldo se traspasó.`;
  }
  return null;
}

const traceField = (f: string | undefined): MpTraceField | null =>
  f && (MP_TRACE_FIELDS as readonly string[]).includes(f) ? (f as MpTraceField) : null;

export function MpHubView({ initialTab = "Stock" as MpHubTab }: { initialTab?: MpHubTab }) {
  const { email, sectorId } = usePreviewSession();
  const { showToast } = usePreviewContext();
  const [tab, setTab] = useState<MpHubTab>(initialTab);
  const canWrite = canWriteInventory(sectorId, TAB_TO_RESOURCE[tab]);
  // Fotos del remito por ingreso (tabla aparte: editar el ingreso no las pierde).
  const fotos = useIngresoAdjuntoCounts("MP", tab === "Ingresos MP" && canViewAdjuntos(sectorId, "MP"));
  const canManageFotos = canManageAdjuntos(sectorId, "MP");
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
  const [bulkPending, setBulkPending] = useState(false);
  const [bulkBusy, setBulkBusy] = useState(false);
  // Hoja única continua: SIN paginación y SIN orden automático. El orden elegido NO se recuerda entre visitas: al entrar
  // siempre se ve el orden de carga; ordenar por una columna es una opción explícita de esta sesión.
  const [stockSort, setStockSort] = useState(MP_ORDEN_CARGA_KEY);
  const [ingresoSort, setIngresoSort] = useState(MP_ORDEN_CARGA_KEY);
  const [compraSort, setCompraSort] = useState(MP_ORDEN_CARGA_KEY);
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
        credentials: "include",
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
      const filtered = stock.filter(
        (r) =>
          !q ||
          [r.descripcion, r.proveedor, r.cliente, r.lote, r.ubicacion, r.codigo, r.productosAsociados, r.producto, ...(r.codigosAnteriores ?? [])]
            .join(" ")
            .toLowerCase()
            .includes(q)
      );
      return applySort(filtered, MP_STOCK_SORT_OPTIONS, stockSort);
    }
    if (tab === "Ingresos MP") {
      const filtered = ingresos.filter((r) => {
        const status = r.status ?? "BORRADOR";
        const statusVisible =
          status !== "ANULADO" ||
          q.includes("anulado") ||
          q === status.toLowerCase();
        if (!statusVisible) return false;
        if (!q) return true;
        return [r.ingresoNro, r.descripcion, r.proveedor, r.cliente, r.lote, r.codigo, r.producto, r.status, r.remitoNro, r.codigoRecibido]
          .join(" ")
          .toLowerCase()
          .includes(q);
      });
      return applySort(filtered, MP_INGRESO_SORT_OPTIONS, ingresoSort);
    }
    if (tab === "Control semanal") {
      return control.filter(
        (r) =>
          !r.archived &&
          (!q ||
            [r.productoElaborar, r.materiaPrima, r.estado].join(" ").toLowerCase().includes(q))
      );
    }
    const filteredCompras = compras.filter(
      (r) =>
        String(r.estado).toLowerCase() !== "cancelada" &&
        (!q ||
          [r.materiaPrima, r.proveedor, r.estado, r.produccionesAfecta].join(" ").toLowerCase().includes(q))
    );
    return applySort(filteredCompras, MP_COMPRA_SORT_OPTIONS, compraSort);
  }, [tab, stock, ingresos, control, compras, search, stockSort, ingresoSort, compraSort]);

  // Hoja única: todas las filas (la planilla las virtualiza; la lista clásica las carga de a tandas al bajar).
  const pageRows = rows;
  const sortKey = tab === "Stock" ? stockSort : tab === "Ingresos MP" ? ingresoSort : tab === "Compras MP" ? compraSort : MP_ORDEN_CARGA_KEY;
  const totalForTab = tab === "Stock" ? stock.length : tab === "Ingresos MP" ? ingresos.length : tab === "Compras MP" ? compras.length : rows.length;
  const resetOrden = () => {
    setStockSort(MP_ORDEN_CARGA_KEY);
    setIngresoSort(MP_ORDEN_CARGA_KEY);
    setCompraSort(MP_ORDEN_CARGA_KEY);
  };
  const visibleIds = useMemo(() => rows.map((r) => r.id), [rows]);
  const sel = useListSelectionMode(visibleIds);
  const showBulkSelection =
    canWrite && (tab === "Stock" || tab === "Ingresos MP" || tab === "Compras MP");

  useEffect(() => {
    sel.cancel();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab]);

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
            pccMeNro: formDraft.pccMeNro ?? "",
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

  const stockCells = useInventoryCellEditing<MpStockRow>(
    "mp_stock",
    canWrite && tab === "Stock",
    MP_STOCK_CELL_FIELDS,
    (r) => r.id,
    reload
  );

  // Trazabilidad Stock ↔ Ingreso original (ver lib/mp-trazabilidad: Stock = vigente, Ingreso = documento).
  const originalByLot = useMemo(() => originalIngresoByLot(ingresos), [ingresos]);
  const stockById = useMemo(() => new Map(stock.map((r) => [r.id, r] as const)), [stock]);

  const ingresoCells = useMpSheetEditing<MpIngresoRow>(
    "mp_ingresos",
    sectorId,
    canWrite && tab === "Ingresos MP",
    MP_INGRESO_CELL_FIELDS,
    ingresos,
    reload
  );
  const compraCells = useMpSheetEditing<MpCompraRow>(
    "mp_compras",
    sectorId,
    canWrite && tab === "Compras MP",
    MP_COMPRA_CELL_FIELDS,
    compras,
    reload
  );
  // ---- Eliminar filas desde la planilla (sin motivo ni confirmación; con Deshacer donde se puede) ----
  const errText = (e: unknown) => (e instanceof Error ? e.message : "Error");
  // Filas en blanco al final de la planilla: se escribe directo y el registro se crea cuando la fila está completa.
  const stockDraftRows = useMemo<GenusGridDraftRows | undefined>(
    () =>
      canWrite && tab === "Stock"
        ? {
            createKeys: MP_STOCK_DRAFT_CREATE_KEYS,
            requiredKeys: MP_STOCK_DRAFT_REQUIRED_KEYS,
            storageKey: `genus-draft:${email ?? "anon"}:mp-stock`,
            validate: (v) => {
              const r = stockPayloadFromDraft("validate", v);
              return r.ok ? null : r.message;
            },
            onCreate: async (id, v) => {
              const r = stockPayloadFromDraft(id, v);
              if (!r.ok) return { ok: false, message: r.message };
              try {
                await mutateInventory({ action: "upsert", resource: "mp_stock", payload: r.payload });
                await reload();
                return { ok: true, message: "Lote creado en Stock." };
              } catch (e) {
                return { ok: false, message: errText(e) };
              }
            },
          }
        : undefined,
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [canWrite, tab, email]
  );
  const ingresoDraftRows = useMemo<GenusGridDraftRows | undefined>(
    () =>
      canWrite && tab === "Ingresos MP"
        ? {
            createKeys: MP_INGRESO_DRAFT_CREATE_KEYS,
            requiredKeys: MP_INGRESO_DRAFT_REQUIRED_KEYS,
            storageKey: `genus-draft:${email ?? "anon"}:mp-ingresos`,
            validate: (v) => {
              const r = ingresoPayloadFromDraft("validate", v);
              return r.ok ? null : r.message;
            },
            onCreate: async (id, v) => {
              const r = ingresoPayloadFromDraft(id, v);
              if (!r.ok) return { ok: false, message: r.message };
              try {
                const result = await mutateInventory({ action: "upsert", resource: "mp_ingresos", payload: r.payload });
                const saved = result.data as MpIngresoRow;
                await reload();
                return { ok: true, message: saved.stockImpacted ? "Ingreso registrado y sumado al stock." : (saved.stockMessage ?? "Ingreso registrado (borrador).") };
              } catch (e) {
                return { ok: false, message: errText(e) };
              }
            },
          }
        : undefined,
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [canWrite, tab, email]
  );
  const stockRowDelete = useMemo<GenusGridRowDelete | undefined>(
    () =>
      canWrite && tab === "Stock"
        ? {
            check: (id) =>
              ingresos.some((i) => i.stockLotId === id && i.status !== "ANULADO")
                ? "Vinculado a un ingreso activo: anulá el ingreso o usá Ajuste (el historial no se borra)."
                : null,
            onDelete: async (ids) => {
              const done: string[] = [];
              let failed = 0;
              let firstError = "";
              for (const id of ids) {
                try {
                  await mutateInventory({ action: "delete", resource: "mp_stock", id });
                  done.push(id);
                } catch (e) {
                  failed += 1;
                  firstError ||= errText(e);
                }
              }
              await reload();
              return {
                ok: done.length > 0,
                message: `${done.length} fila${done.length === 1 ? "" : "s"} eliminada${done.length === 1 ? "" : "s"} de Stock (se archivan: el saldo del libro mayor y los movimientos no cambian)${failed ? ` · ${failed} con error: ${firstError}` : ""}.`,
                undo: done.length
                  ? async () => {
                      for (const id of done) await mutateInventory({ action: "restore", resource: "mp_stock", id });
                      await reload();
                      showToast("Eliminación deshecha: las filas volvieron a Stock.");
                    }
                  : undefined,
              };
            },
          }
        : undefined,
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [canWrite, tab, ingresos]
  );
  const ingresoRowDelete = useMemo<GenusGridRowDelete | undefined>(
    () =>
      canWrite && tab === "Ingresos MP"
        ? {
            check: (id) => {
              const r = ingresos.find((x) => x.id === id);
              if (!r) return "El ingreso ya no existe.";
              if (r.status === "ANULADO") return "Ya está anulado.";
              if (r.status === "CONFIRMADO") return "Está confirmado y mueve el stock: se anula con «Anular» y motivo (revierte el stock con auditoría).";
              return null;
            },
            onDelete: async (ids) => {
              let done = 0;
              let failed = 0;
              let firstError = "";
              for (const id of ids) {
                try {
                  await mutateInventory({ action: "anular", resource: "mp_ingresos", id });
                  done += 1;
                } catch (e) {
                  failed += 1;
                  firstError ||= errText(e);
                }
              }
              await reload();
              return {
                ok: done > 0,
                message: `${done} borrador${done === 1 ? "" : "es"} descartado${done === 1 ? "" : "s"} (quedan anulados en el historial; no afectaron stock)${failed ? ` · ${failed} con error: ${firstError}` : ""}.`,
              };
            },
          }
        : undefined,
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [canWrite, tab, ingresos]
  );
  const compraRowDelete = useMemo<GenusGridRowDelete | undefined>(
    () =>
      canWrite && tab === "Compras MP"
        ? {
            check: (id) => {
              const r = compras.find((x) => x.id === id);
              if (!r) return "La compra ya no existe.";
              return String(r.estado ?? "").toLowerCase() === "cancelada" ? "Ya está cancelada." : null;
            },
            onDelete: async (ids) => {
              const undoList: Array<{ id: string; estado: string; version: string }> = [];
              let failed = 0;
              let firstError = "";
              for (const id of ids) {
                const before = compras.find((x) => x.id === id);
                try {
                  const res = await mutateInventory<MpCompraRow>({ action: "delete", resource: "mp_compras", id });
                  undoList.push({ id, estado: before?.estado ?? "", version: res.data.updatedAt });
                } catch (e) {
                  failed += 1;
                  firstError ||= errText(e);
                }
              }
              await reload();
              return {
                ok: undoList.length > 0,
                message: `${undoList.length} compra${undoList.length === 1 ? "" : "s"} cancelada${undoList.length === 1 ? "" : "s"} (queda en el historial)${failed ? ` · ${failed} con error: ${firstError}` : ""}.`,
                undo: undoList.length
                  ? async () => {
                      await patchInventoryCells(
                        "mp_compras",
                        undoList.map((u) => ({ id: u.id, field: "estado", value: u.estado, expectedVersion: u.version }))
                      );
                      await reload();
                      showToast("Cancelación deshecha.");
                    }
                  : undefined,
              };
            },
          }
        : undefined,
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [canWrite, tab, compras]
  );
  const borradoresConfirmables = ingresos.filter(
    (r) =>
      r.status === "BORRADOR" &&
      ((r.total != null && r.total > 0) || (r.cantidad != null && r.cantidad > 0))
  );
  /** Alta por pegado/planilla = borrador; recién al confirmar suma al stock (lote + libro mayor, en una transacción). */
  async function confirmBorradores() {
    try {
      const res = await mutateInventory({
        action: "confirm",
        resource: "mp_ingresos",
        payload: { items: borradoresConfirmables.map((r) => ({ id: r.id, expectedVersion: r.updatedAt })) },
      });
      const n = Array.isArray(res.data) ? res.data.length : borradoresConfirmables.length;
      showToast(`${n} ingreso(s) confirmado(s): ya suman al stock.`);
      setBanner(null);
    } catch (e) {
      setBanner(e instanceof InventoryClientError ? e.message : "No se pudieron confirmar los borradores.");
    }
    await reload();
  }

  // Columnas de la planilla original. «Stock código» (libro mayor) ya no se muestra: el libro mayor se sigue
  // calculando internamente (Control semanal, relaciones por lote, stock físico) pero no es una columna de la planilla.
  const stockColumnLabels: string[] = [...MP_STOCK_COLUMNS];
  const stockColumns: OperationalTableColumn<MpStockRow>[] = stockColumnLabels.map((label) => {
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
    const short = STOCK_HEADER_SHORT[label] ?? label;
    const collapse = stockCollapse(label);
    const mono = label === "CÓDIGO" || label === "LOTE";

    if (label === "CÓDIGO") {
      return {
        key: label,
        header: short,
        headerTitle: label,
        hideOnMobile: false,
        className: "w-[7.5rem]",
        // Texto de la planilla: el código y, si corresponde, su marca (se ve y se copia igual que en la lista).
        // Texto de la planilla = el código (se edita tal cual); sus avisos van como nota de la celda.
        text: (r) => displayCell(r.codigo),
        render: (r) => {
          const pending = Boolean(r.codigoPendiente) || isMpInternalCodigo(r.codigo);
          const code = displayCell(r.codigo);
          // «..», «-», vacío: no es un código. Se marca (no se oculta ni se borra) para que se revise.
          const invalid = !/[\p{L}\p{N}]/u.test(code);
          return (
            <span className="inline-flex min-w-0 flex-col gap-0.5">
              <OsClampedText fullText={code} mono>
                {code}
              </OsClampedText>
              {pending ? (
                <span
                  className="w-fit rounded bg-[var(--genus-warning-soft)] px-1.5 py-0.5 text-[10px] font-medium text-[var(--genus-warning)]"
                  title="Identidad interna: completar código de proveedor"
                  data-testid={`mp-stock-codigo-pendiente-${r.id}`}
                >
                  Sin código proveedor
                </span>
              ) : null}
              {invalid ? (
                <span
                  className="w-fit rounded bg-[var(--genus-warning-soft)] px-1.5 py-0.5 text-[10px] font-medium text-[var(--genus-warning)]"
                  title="El código no tiene letras ni números. Revisá el origen del lote antes de usarlo (no se borra solo)."
                  data-testid={`mp-stock-codigo-invalido-${r.id}`}
                >
                  Código inválido
                </span>
              ) : null}
            </span>
          );
        },
      };
    }

    return {
      key: label,
      header: short,
      headerTitle: label,
      hideOnMobile: collapse === false ? false : collapse,
      className:
        label === "DESCRIPCIÓN MATERIA PRIMA"
          ? "w-[18%]"
          : label === "PRODUCTO"
            ? "w-[14%]"
            : label === "CANTIDAD (KG)"
              ? "w-[6.5rem]"
              : undefined,
      render: (r) => {
        // PRODUCTO: lo escrito por Materia Prima; si está vacío, los productos de los ingresos confirmados del código.
        const value = label === "PRODUCTO" ? displayCell(r.producto) || displayCell(r.productosAsociados) : displayCell(r[k]);
        return (
          <OsClampedText fullText={value} mono={mono}>
            {value}
          </OsClampedText>
        );
      },
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

  const ingresoTipo = (r: MpIngresoRow, isOriginal: boolean) =>
    r.status === "ANULADO"
      ? "Anulado"
      : r.status !== "CONFIRMADO"
        ? "Borrador (no mueve stock)"
        : isOriginal
          ? "Ingreso · nuevo lote"
          : r.stockLotId
            ? "Ingreso adicional a lote"
            : "Ingreso";
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
      const short =
        label === "DESCRIPCIÓN MATERIA PRIMA"
          ? "Descripción"
          : label === "CANTIDAD (kg/u)"
            ? "Cantidad"
            : label === "INGRESO Nº"
              ? "Ingreso"
              : label === "REMITO Nº"
                ? "Remito"
                : label.charAt(0) + label.slice(1).toLowerCase();
      const collapse = INGRESO_ALWAYS.has(label)
        ? false
        : INGRESO_FROM_LG.has(label)
          ? ("lg" as const)
          : ("2xl" as const);
      const mono = label === "CÓDIGO" || label === "LOTE" || label === "INGRESO Nº";
      return {
        key: label,
        header: short,
        headerTitle: label,
        hideOnMobile: collapse === false ? false : collapse,
        render: (r: MpIngresoRow) => {
          const value = displayCell(r[k]);
          return (
            <OsClampedText fullText={value} mono={mono}>
              {value}
            </OsClampedText>
          );
        },
      } as OperationalTableColumn<MpIngresoRow>;
    }),
    {
      key: "status",
      header: "Estado",
      render: (r) => statusChip(r.status),
    },
    {
      // Tipo de movimiento (solo lectura, deducido): un ingreso NO es un ajuste de saldo.
      key: "tipoMovimiento",
      header: "Tipo",
      headerTitle: "Qué hace este renglón: nuevo lote, ingreso adicional a un lote existente, borrador (no mueve stock) o anulado. Los ajustes de saldo se hacen en Stock.",
      excelOnly: true,
      text: (r: MpIngresoRow) => ingresoTipo(r, originalByLot.get(r.stockLotId ?? "")?.id === r.id),
      render: (r: MpIngresoRow) => ingresoTipo(r, originalByLot.get(r.stockLotId ?? "")?.id === r.id),
    } as OperationalTableColumn<MpIngresoRow>,
    {
      key: "acciones",
      header: "Acciones",
      className: "w-[14rem]",
      render: (r: MpIngresoRow) => {
        const qtyReady =
          Boolean((r.codigo ?? "").trim()) &&
          ((r.total != null && r.total > 0) || (r.cantidad != null && r.cantidad > 0));
        return (
          <div className="os-row-actions">
            <IngresoRemitoFotosButton
              module="MP"
              ingresoId={r.id}
              label={`Ingreso ${r.ingresoNro || "s/n"} · Remito ${r.remitoNro || "s/n"} · ${r.proveedor || r.descripcion || ""}`}
              canManage={canManageFotos}
              onChanged={fotos.reload}
            />
            <MpIngresoCrearEtiquetaButton
              row={r}
              onToast={(msg) => showToast(msg)}
              onError={(msg) => setBanner(msg)}
            />
            {canWrite && r.status === "BORRADOR" && qtyReady ? (
              <Button
                type="button"
                size="sm"
                variant="secondary"
                onClick={() => void confirmIngreso(r)}
              >
                Confirmar
              </Button>
            ) : null}
            {canWrite && r.status !== "ANULADO" ? (
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
                      pccMeNro: r.pccMeNro ?? "",
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
    },
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
    const short =
      label === "MATERIA PRIMA"
        ? "Materia prima"
        : label === "FECHA ENTREGA"
          ? "Entrega"
          : label === "QUÉ PRODUCCIONES AFECTA"
            ? "Afecta a"
            : label.charAt(0) + label.slice(1).toLowerCase();
    const collapse = COMPRA_ALWAYS.has(label)
      ? false
      : COMPRA_FROM_LG.has(label)
        ? ("lg" as const)
        : ("2xl" as const);
    return {
      key: label,
      header: short,
      headerTitle: label,
      hideOnMobile: collapse === false ? false : collapse,
      render: (r) => {
        const value = displayCell(r[k]);
        return <OsClampedText fullText={value}>{value}</OsClampedText>;
      },
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
            ["fecha", "FECHA / Ingreso"],
            ["ingresoNro", "INGRESO Nº"],
            ["pccMeNro", "PCC-ME N.º"],
            ["proveedor", "PROVEEDOR"],
            ["cliente", "CLIENTE"],
            ["remitoNro", "REMITO Nº"],
            ["codigo", "CÓDIGO"],
            ["producto", "PRODUCTO"],
            ["descripcion", "DESCRIPCIÓN MATERIA PRIMA"],
            ["bultos", "BULTOS"],
            ["cantidad", "CANTIDAD"],
            ["ubicacion", "UBICACIÓN"],
            ["lote", "LOTE PROVEEDOR"],
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
        <div className="mb-4 rounded border border-[var(--genus-warning)]/30 bg-[var(--genus-warning-soft)] px-3 py-2 text-sm text-[var(--genus-warning)]">
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
            }}
          >
            {t}
          </button>
        ))}
      </div>

      <div className="mb-3 flex flex-wrap gap-2">
        {tab === "Ingresos MP" ? <IngresoConRemitoButtons module="MP" canWrite={canWrite} onChanged={() => { void reload(); fotos.reload(); }} /> : null}
        {canWrite && tab !== "Control semanal" && tab !== "COA'S" && (
          <>
            <Button type="button" variant={tab === "Ingresos MP" ? "secondary" : undefined} onClick={openNew}>
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
        {showBulkSelection &&
          (!sel.active ? (
            <ListSelectionEnterButton onClick={sel.enter} />
          ) : (
            <ListSelectionToolbar
              selectedCount={sel.selectedCount}
              onSelectAll={sel.selectAllVisible}
              onDeselectAll={sel.deselectAll}
              onDelete={() => setBulkPending(true)}
              onCancel={sel.cancel}
              busy={bulkBusy}
              deleteLabel={tab === "Ingresos MP" ? "Anular seleccionados" : "Eliminar seleccionados"}
            />
          ))}
        {tab !== "Control semanal" && tab !== "COA'S" ? (
        <span className="relative inline-flex items-center">
          <input
            className="min-w-[18rem] rounded border px-3 py-1.5 pr-8 text-sm"
            placeholder={
              tab === "Compras MP"
                ? "Buscar materia prima, proveedor, estado…"
                : tab === "Ingresos MP"
                  ? "Buscar código, producto, lote, remito, proveedor…"
                  : "Buscar código, producto, lote, proveedor…"
            }
            aria-label="Buscar en la planilla"
            value={search}
            onChange={(e) => {
              setSearch(e.target.value);
            }}
            onKeyDown={(e) => {
              if (e.key === "Escape" && search) {
                setSearch("");
              }
            }}
            data-testid="mp-search"
          />
          {search ? (
            <button
              type="button"
              className="absolute right-1.5 rounded px-1.5 text-base leading-none text-[var(--os-text-muted)] hover:bg-[var(--os-teal-soft)] hover:text-[var(--os-text)]"
              title="Quitar búsqueda (Esc)"
              aria-label="Quitar búsqueda"
              onClick={() => {
                setSearch("");
              }}
              data-testid="mp-search-clear"
            >
              ×
            </button>
          ) : null}
        </span>
        ) : null}
        {tab === "Stock" ? (
          <SortSelect
            value={stockSort}
            onChange={(key) => {
              setStockSort(key);
            }}
            options={MP_STOCK_SORT_OPTIONS}
            testId="mp-stock-sort"
          />
        ) : null}
        {tab === "Ingresos MP" ? (
          <SortSelect
            value={ingresoSort}
            onChange={(key) => {
              setIngresoSort(key);
            }}
            options={MP_INGRESO_SORT_OPTIONS}
            testId="mp-ingresos-sort"
          />
        ) : null}
        {tab === "Compras MP" ? (
          <SortSelect
            value={compraSort}
            onChange={(key) => {
              setCompraSort(key);
            }}
            options={MP_COMPRA_SORT_OPTIONS}
            testId="mp-compras-sort"
          />
        ) : null}
      </div>

      {tab === "Stock" || tab === "Ingresos MP" || tab === "Compras MP" ? (
        <div className="mb-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-[var(--os-text-muted)]" data-testid="mp-sheet-status">
          <span data-testid="mp-sheet-count">
            {search.trim() && rows.length !== totalForTab
              ? `${rows.length} de ${totalForTab} registros (búsqueda activa)`
              : `${rows.length} registro${rows.length === 1 ? "" : "s"}`}
          </span>
          <span data-testid="mp-sheet-order">
            {sortKey === MP_ORDEN_CARGA_KEY ? "Orden de carga: el de incorporación a la hoja" : "Ordenada por una columna (elegida por vos)"}
          </span>
          {sortKey !== MP_ORDEN_CARGA_KEY ? (
            <button
              type="button"
              className="rounded border border-[var(--os-border)] px-2 py-0.5 text-[var(--os-text)] hover:bg-[var(--os-teal-soft)]/50"
              onClick={resetOrden}
              data-testid="mp-sheet-order-reset"
            >
              Volver al orden de carga
            </button>
          ) : null}
        </div>
      ) : null}

      {tab === "Stock" ? <SchemaPendingBanner show={schemaPending0005} /> : null}

      {tab === "Stock" && (
        <>
        {stock.some((r) => r.codigoPendiente || isMpInternalCodigo(r.codigo)) ? (
          <div
            className="mb-3 rounded border border-[var(--genus-warning)]/30 bg-[var(--genus-warning-soft)] px-3 py-2 text-sm text-[var(--genus-warning)]"
            data-testid="mp-stock-codigo-pendiente-banner"
          >
            Hay filas de Stock con identidad interna (sin código de proveedor). Completá el
            código desde Ingresos MP cuando esté disponible.
          </div>
        ) : null}
        <OperationalTable
          tableId="mp-stock"
          continuous
          rowDelete={stockRowDelete}
          draftRows={stockDraftRows}
          canEditCells={stockCells.canEditCells}
          onCellsCommit={stockCells.onCellsCommit}
          reasonRequired={stockCells.reasonRequired}
          reasonInline
          rowVersion={stockCells.rowVersion}
          columns={[
            ...stockColumns.map((col) => {
              const field = traceField(MP_STOCK_CELL_FIELDS[String(col.key)]);
              return {
                ...col,
                edit: stockCells.edit(String(col.key)),
                readOnlyReason: readOnlyReason("mp_stock", String(col.key)),
                cellNote: (r: MpStockRow) => (field ? stockTraceNote(r, field, originalByLot.get(r.id)) : null) ?? stockCellNote(String(col.key), r),
              };
            }),
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
          selection={
            sel.active
              ? { active: true, isSelected: sel.isSelected, onToggle: sel.toggle }
              : undefined
          }
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
              !(r as MpIngresoRow).stockImpacted &&
              !(((r as MpIngresoRow).total ?? 0) > 0 || ((r as MpIngresoRow).cantidad ?? 0) > 0)
          ) ? (
            <div className="mb-3 rounded border border-[var(--genus-warning)]/30 bg-[var(--genus-warning-soft)] px-3 py-2 text-sm text-[var(--genus-warning)]">
              Hay borradores sin afectar Stock (falta Cantidad/Total). Completá y confirmá
              para impactar inventario. Los ingresos sin código de proveedor usan identidad
              interna y aparecen en Stock con advertencia.
            </div>
          ) : null}
          {canWrite && borradoresConfirmables.length > 0 ? (
            <div className="mb-3 flex flex-wrap items-center gap-3 rounded border border-[var(--os-border)] bg-[var(--os-surface)] px-3 py-2 text-sm" data-testid="mp-ingresos-borradores">
              <span>
                {borradoresConfirmables.length} ingreso(s) en borrador listos para confirmar. Revisalos en la planilla:
                recién al confirmar suman al stock.
              </span>
              <Button type="button" size="sm" variant="primary" onClick={() => void confirmBorradores()} data-testid="mp-ingresos-confirmar-borradores">
                Confirmar {borradoresConfirmables.length} borrador(es)
              </Button>
            </div>
          ) : null}
          <OperationalTable
            tableId="mp-ingresos"
            continuous
            rowDelete={ingresoRowDelete}
            draftRows={ingresoDraftRows}
            canEditCells={ingresoCells.canEditCells}
            onCellsCommit={ingresoCells.onCellsCommit}
            reasonRequired={ingresoCells.reasonRequired}
            reasonInline
            rowVersion={ingresoCells.rowVersion}
            columns={ingresoColumns.map((col) => {
              const field = traceField(MP_INGRESO_CELL_FIELDS[String(col.key)]);
              return {
                ...col,
                edit: ingresoCells.edit(String(col.key)),
                readOnlyReason: readOnlyReason("mp_ingresos", String(col.key)),
                cellNote: field
                  ? (r: MpIngresoRow) => ingresoTraceNote(r, field, r.stockLotId ? stockById.get(r.stockLotId) : undefined, originalByLot.get(r.stockLotId ?? "")?.id === r.id)
                  : undefined,
              };
            })}
            rows={pageRows as MpIngresoRow[]}
            rowKey={(r) => r.id}
            emptyMessage="Sin ingresos MP."
            selection={
              sel.active
                ? { active: true, isSelected: sel.isSelected, onToggle: sel.toggle }
                : undefined
            }
          />
        </>
      )}

      {tab === "Control semanal" && <MpWeeklyControlPanel />}

      {tab === "COA'S" && <MpCoasPanel />}

      {tab === "Compras MP" && (
        <OperationalTable
          tableId="mp-compras"
          continuous
          rowDelete={compraRowDelete}
          canEditCells={compraCells.canEditCells}
          onCellsCommit={compraCells.onCellsCommit}
          rowVersion={compraCells.rowVersion}
          columns={compraColumns.map((col) => ({ ...col, edit: compraCells.edit(String(col.key)) }))}
          rows={pageRows as MpCompraRow[]}
          rowKey={(r) => r.id}
          emptyMessage="Sin compras MP."
          selection={
            sel.active
              ? { active: true, isSelected: sel.isSelected, onToggle: sel.toggle }
              : undefined
          }
        />
      )}

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
            <div className="mt-4 flex flex-wrap items-center justify-between gap-2">
              {tab === "Ingresos MP" ? (
                <MpIngresoCrearEtiquetaButton
                  row={{
                    id: formDraft.id,
                    producto: formDraft.producto,
                    descripcion: formDraft.descripcion,
                    pccMeNro: formDraft.pccMeNro,
                    fecha: formDraft.fecha,
                    remitoNro: formDraft.remitoNro,
                    cantidad: formDraft.cantidad,
                    proveedor: formDraft.proveedor,
                    bultos: formDraft.bultos,
                    lote: formDraft.lote,
                  }}
                  compactOnMobile={false}
                  onToast={(msg) => showToast(msg)}
                  onError={(msg) => setBanner(msg)}
                />
              ) : (
                <span />
              )}
              <div className="flex gap-2">
                {tab === "Ingresos MP" && formDraft.id ? (
                  <IngresoRemitoFotosButton
                    module="MP"
                    ingresoId={formDraft.id}
                    label={`Ingreso ${formDraft.ingresoNro || "s/n"} · Remito ${formDraft.remitoNro || "s/n"}`}
                    canManage={canManageFotos}
                    onChanged={fotos.reload}
                  />
                ) : null}
                <Button type="button" variant="secondary" onClick={() => setFormOpen(false)}>
                  Cancelar
                </Button>
                <Button type="button" onClick={() => void saveDraft()}>
                  Guardar
                </Button>
              </div>
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

      <LifecycleConfirmDialog
        pending={
          bulkPending
            ? syntheticLifecycleItem(
                tab === "Ingresos MP" ? "anular" : "eliminar",
                tab === "Ingresos MP" ? "Anular ingresos MP" : "Eliminar registros",
                bulkDeleteConfirmMessage(sel.selectedCount)
              )
            : null
        }
        forceReason
        entityLabel={`${sel.selectedCount} registro(s)`}
        onClose={() => setBulkPending(false)}
        onConfirm={async (reason) => {
          setBulkBusy(true);
          let ok = 0;
          let skipped = 0;
          let failed = 0;
          const ingresoById =
            tab === "Ingresos MP"
              ? new Map((pageRows as MpIngresoRow[]).map((r) => [r.id, r]))
              : null;
          for (const id of sel.selectedIds) {
            if (tab === "Ingresos MP") {
              const row = ingresoById?.get(id);
              if (row?.status === "ANULADO") {
                skipped += 1;
                continue;
              }
            }
            try {
              await mutateInventory({
                action: tab === "Ingresos MP" ? "anular" : "delete",
                resource: TAB_TO_RESOURCE[tab],
                id,
                reason,
              });
              ok += 1;
            } catch {
              failed += 1;
            }
          }
          setBulkPending(false);
          sel.cancel();
          await reload();
          setBulkBusy(false);
          showToast(
            `${ok} procesado(s)${skipped ? ` · ${skipped} omitido(s)` : ""}${failed ? ` · ${failed} error(es)` : ""}`
          );
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
                  { key: "pccMeNro", label: "PCC-ME N.º" },
                  { key: "proveedor", label: "PROVEEDOR" },
                  { key: "cliente", label: "CLIENTE" },
                  { key: "remitoNro", label: "REMITO Nº" },
                  { key: "codigo", label: "CÓDIGO" },
                  { key: "producto", label: "PRODUCTO" },
                  { key: "descripcion", label: "DESCRIPCIÓN MATERIA PRIMA" },
                  { key: "bultos", label: "BULTOS" },
                  { key: "cantidad", label: "CANTIDAD" },
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
          pccMeNro: ["pcc", "pcc-me", "pcc me", "pcc me n"],
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
          fechaEntrega: ["fecha entrega"],
          produccionesAfecta: ["producciones", "que producciones"],
          nota: ["nota"],
          unidad: ["unidad"],
        }}
        ignoreKeys={["total", "falta", "estado", "estadoStock", "diasAlVence", "estadoVencimiento"]}
        onToast={(message) => showToast(message)}
        onConfirm={async (mapped) => {
          let pasted = 0;
          const rejected: string[] = [];
          for (const m of mapped) {
            setFormDraft(m);
            if (tab === "Ingresos MP") {
              // Pegado = BORRADOR (no mueve stock hasta confirmar). Un duplicado se informa y se sigue con el resto.
              try {
                await mutateInventory({
                  action: "upsert",
                  resource: "mp_ingresos",
                  payload: {
                    fecha: m.fecha ?? "",
                    ingresoNro: m.ingresoNro ?? "",
                    proveedor: m.proveedor ?? "",
                    cliente: m.cliente ?? "",
                    remitoNro: m.remitoNro ?? "",
                    pccMeNro: m.pccMeNro ?? "",
                    codigo: m.codigo ?? "",
                    producto: m.producto ?? "",
                    descripcion: m.descripcion ?? "",
                    bultos: parseOptionalNumber(m.bultos),
                    cantidad: parseOptionalNumber(m.cantidad),
                    ubicacion: m.ubicacion ?? "",
                    lote: m.lote ?? "",
                    vencimiento: m.vencimiento ?? "",
                    status: "BORRADOR",
                  },
                });
                pasted += 1;
              } catch (e) {
                rejected.push(e instanceof InventoryClientError ? e.message : "Error al cargar una fila.");
              }
              continue;
            }
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
          if (tab === "Ingresos MP") {
            setBanner(
              rejected.length
                ? `${pasted} ingreso(s) cargado(s) como borrador · ${rejected.length} omitido(s): ${rejected.slice(0, 3).join(" · ")}`
                : `${pasted} ingreso(s) cargado(s) como borrador. Revisalos y confirmalos para que sumen al stock.`
            );
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
