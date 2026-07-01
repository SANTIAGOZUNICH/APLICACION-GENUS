import { ScanBarcode } from "lucide-react";
import { ActionIds } from "@/types/actions";
import { LOTE_FLOW } from "@/config/entity-pages";
import { EntityPageKinds, type EntityPageModel } from "@/types/entity-page";
import { Status } from "@/types/ui/status";
import type {
  LoteRow,
  LoteSheetData,
  MovimientoRow,
  SaldoRow,
} from "@/lib/adapters/sheets/types/sheets-row.types";
import { pickField, rowsToRecords } from "@/lib/adapters/sheets/parse-sheet-rows";

function mapLoteStatus(estado: string): Status {
  const normalized = estado.trim().toLowerCase();

  switch (normalized) {
    case "liberado":
      return Status.LIBERADO;
    case "rechazado":
      return Status.RECHAZADO;
    case "condicional":
      return Status.EN_TOLERANCIA;
    case "bloqueado":
      return Status.BLOQUEADO;
    case "cuarentena":
    default:
      return Status.CUARENTENA;
  }
}

function mapLoteStageId(estado: string): string {
  const normalized = estado.trim().toLowerCase();

  switch (normalized) {
    case "liberado":
      return "liberado";
    case "rechazado":
    case "condicional":
    case "bloqueado":
      return "disposicion";
    default:
      return "cuarentena";
  }
}

function formatDisplayDate(value: string): string {
  if (!value) return "—";
  const datePart = value.split(" ")[0];
  const [year, month, day] = datePart.split("-");
  if (year && month && day) {
    return `${day}/${month}/${year}`;
  }
  return value;
}

function formatDisplayDateTime(value: string): string {
  if (!value) return "—";
  const [datePart, timePart] = value.split(" ");
  const formattedDate = formatDisplayDate(datePart);
  if (!timePart) return formattedDate;
  const [hour, minute] = timePart.split(":");
  return `${formattedDate} ${hour}:${minute}`;
}

function formatSaldo(saldo: SaldoRow | null): string {
  if (!saldo?.cantidadActual) return "—";
  const unit = saldo.unidad || "";
  return `${saldo.cantidadActual}${unit ? ` ${unit}` : ""}`.trim();
}

function formatMovimientoCantidad(mov: MovimientoRow): string {
  const signo = mov.cantidadSigno.trim();
  if (signo.startsWith("-") || signo.startsWith("+")) {
    const unit = mov.unidad ? ` ${mov.unidad}` : "";
    return `${signo}${unit}`;
  }

  const qty = mov.cantidad.trim();
  if (!qty) return "—";
  const unit = mov.unidad ? ` ${mov.unidad}` : "";
  return `${qty}${unit}`;
}

function buildActivityFromMovimientos(movimientos: MovimientoRow[]) {
  return [...movimientos]
    .sort((a, b) => b.fechaHora.localeCompare(a.fechaHora))
    .slice(0, 8)
    .map((mov) => ({
      id: mov.movId || `mov-${mov.fechaHora}`,
      timestamp: formatDisplayDateTime(mov.fechaHora),
      user: mov.usuario || "Sistema",
      action: mov.tipoMovimiento || "Movimiento",
      description:
        mov.motivo ||
        [mov.referenciaTipo, mov.referenciaId].filter(Boolean).join(" · ") ||
        "Registro de inventario",
    }));
}

export function mapRecordsToLoteRow(record: Record<string, string>): LoteRow {
  return {
    loteId: pickField(record, "loteId", "LOTE_ID"),
    tipoItem: pickField(record, "tipoItem", "tipo_item"),
    itemId: pickField(record, "itemId", "ITEM_ID"),
    nroLote: pickField(record, "nroLote", "nro_lote"),
    proveedor: pickField(record, "proveedor"),
    fechaRecepcion: pickField(record, "fechaRecepcion", "fecha_recepcion"),
    fechaVencimiento: pickField(record, "fechaVencimiento", "fecha_vencimiento"),
    estado: pickField(record, "estado"),
    coaLink: pickField(record, "coaLink", "coa_link"),
  };
}

export function mapRecordsToSaldoRow(record: Record<string, string>): SaldoRow {
  return {
    loteId: pickField(record, "loteId", "LOTE_ID"),
    itemId: pickField(record, "itemId", "ITEM_ID"),
    tipoItem: pickField(record, "tipoItem", "tipo_item"),
    descripcion: pickField(record, "descripcion"),
    cantidadActual: pickField(record, "cantidadActual", "cantidad_actual"),
    unidad: pickField(record, "unidad"),
    estadoLote: pickField(record, "estadoLote", "estado_lote"),
    fechaVencimiento: pickField(record, "fechaVencimiento", "fecha_vencimiento"),
  };
}

export function mapRecordsToMovimientoRow(
  record: Record<string, string>
): MovimientoRow {
  return {
    movId: pickField(record, "movId", "MOV_ID"),
    fechaHora: pickField(record, "fechaHora", "fecha_hora"),
    tipoItem: pickField(record, "tipoItem", "tipo_item"),
    itemId: pickField(record, "itemId", "ITEM_ID"),
    loteId: pickField(record, "loteId", "LOTE_ID"),
    tipoMovimiento: pickField(record, "tipoMovimiento", "tipo_movimiento"),
    cantidad: pickField(record, "cantidad"),
    unidad: pickField(record, "unidad"),
    cantidadSigno: pickField(record, "cantidadSigno", "cantidad_signo"),
    motivo: pickField(record, "motivo"),
    usuario: pickField(record, "usuario"),
    referenciaTipo: pickField(record, "referenciaTipo", "referencia_tipo"),
    referenciaId: pickField(record, "referenciaId", "referencia_id"),
  };
}

export function parseLoteRows(rows: string[][]): LoteRow[] {
  return rowsToRecords(rows)
    .map(mapRecordsToLoteRow)
    .filter((row) => row.loteId);
}

export function parseSaldoRows(rows: string[][]): SaldoRow[] {
  return rowsToRecords(rows)
    .map(mapRecordsToSaldoRow)
    .filter((row) => row.loteId);
}

export function parseMovimientoRows(rows: string[][]): MovimientoRow[] {
  return rowsToRecords(rows)
    .map(mapRecordsToMovimientoRow)
    .filter((row) => row.loteId);
}

export function buildLoteEntityPage(data: LoteSheetData): EntityPageModel {
  const { lote, saldo, movimientos } = data;
  const status = mapLoteStatus(lote.estado || saldo?.estadoLote || "Cuarentena");
  const title =
    saldo?.descripcion?.trim() ||
    `${lote.tipoItem || "Lote"} ${lote.nroLote || lote.loteId}`.trim();

  const sortedMovimientos = [...movimientos].sort((a, b) =>
    b.fechaHora.localeCompare(a.fechaHora)
  );

  return {
    kind: EntityPageKinds.LOTE,
    entityId: lote.loteId,
    title,
    subtitle: [lote.tipoItem, lote.itemId].filter(Boolean).join(" · ") || "Lote",
    status,
    identityIcon: ScanBarcode,
    statusFlow: LOTE_FLOW,
    currentStageId: mapLoteStageId(lote.estado || saldo?.estadoLote || ""),
    primaryAction:
      status === Status.CUARENTENA
        ? { label: "Cargar análisis", actionId: ActionIds.LOTE_CARGAR_ANALISIS }
        : undefined,
    secondaryActions: lote.coaLink
      ? [{ label: "Ver COA", variant: "secondary", href: lote.coaLink }]
      : undefined,
    sections: [
      {
        id: "datos",
        title: "Datos del lote",
        description: "Identificación y estado de inventario (Google Sheets).",
        content: {
          type: "key-values",
          items: [
            { id: "lote-id", label: "ID", value: lote.loteId },
            { id: "nro-lote", label: "Nro. lote", value: lote.nroLote || "—" },
            { id: "tipo", label: "Tipo", value: lote.tipoItem || "—" },
            { id: "item", label: "Ítem", value: lote.itemId || "—" },
            { id: "saldo", label: "Saldo", value: formatSaldo(saldo) },
            {
              id: "estado",
              label: "Estado",
              value: lote.estado || saldo?.estadoLote || "—",
            },
            {
              id: "proveedor",
              label: "Proveedor",
              value: lote.proveedor || "—",
            },
            {
              id: "recepcion",
              label: "Recepción",
              value: formatDisplayDate(lote.fechaRecepcion),
            },
            {
              id: "vencimiento",
              label: "Vencimiento",
              value: formatDisplayDate(
                lote.fechaVencimiento || saldo?.fechaVencimiento || ""
              ),
            },
          ],
        },
      },
      {
        id: "analisis",
        title: "Análisis y controles",
        description: "Fuera del slice E7 — se conectará en una entrega posterior.",
        content: {
          type: "cards",
          cards: [
            {
              id: "analisis-pendiente",
              title: "Análisis no conectados",
              status: Status.PENDIENTE,
              description:
                "E7 trae LOTES, SALDOS y MOVIMIENTOS. Los análisis siguen en mock hasta una entrega futura.",
              items: [],
            },
          ],
        },
      },
      {
        id: "movimientos",
        title: "Movimientos",
        description: "Auditoría de movimientos de stock del lote.",
        content: {
          type: "audit-table",
          table: {
            id: `mov-lote-${lote.loteId}`,
            columns: [
              { id: "fecha", label: "Fecha" },
              { id: "tipo", label: "Tipo" },
              { id: "cantidad", label: "Cantidad" },
              { id: "referencia", label: "Referencia" },
              { id: "usuario", label: "Usuario" },
            ],
            rows: sortedMovimientos.map((mov) => ({
              id: mov.movId || `${mov.loteId}-${mov.fechaHora}`,
              cells: {
                fecha: formatDisplayDateTime(mov.fechaHora),
                tipo: mov.tipoMovimiento || "—",
                cantidad: formatMovimientoCantidad(mov),
                referencia:
                  [mov.referenciaTipo, mov.referenciaId]
                    .filter(Boolean)
                    .join(" · ") || mov.motivo || "—",
                usuario: mov.usuario || "—",
              },
            })),
          },
        },
      },
    ],
    activityLog: buildActivityFromMovimientos(sortedMovimientos),
    relatedObjects: [],
  };
}

export function composeLoteSheetData(
  lote: LoteRow,
  saldos: SaldoRow[],
  movimientos: MovimientoRow[]
): LoteSheetData {
  const saldo = saldos.find((row) => row.loteId === lote.loteId) ?? null;
  const loteMovimientos = movimientos.filter(
    (row) => row.loteId === lote.loteId
  );

  return {
    lote,
    saldo,
    movimientos: loteMovimientos,
  };
}
