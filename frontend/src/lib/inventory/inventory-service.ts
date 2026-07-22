/**
 * Servicio de inventario ME/MP — reglas de negocio, stock y avisos.
 * Persistencia vía MemoryInventoryRepo (tests) o Drizzle (Neon).
 */

import { randomUUID } from "node:crypto";
import type { SectorId } from "@/types/operational/sector";
import {
  calcControlEstado,
  calcDiasAlVence,
  calcFalta,
  calcMeAlertLevel,
  calcMpEstadoStock,
  calcMpEstadoVencimiento,
  formatMeBultosDisplay,
  multiplyTotal,
  parseOptionalNumber,
} from "./calcs";
import type { MemoryInventoryRepo, StockAjuste } from "./memory-repo";
import {
  ME_ALERT_NOTIFY_SECTORS,
  canReadInventory,
  canWriteInventory,
  canWriteOaMeSalida,
  type InventoryModule,
} from "./rbac";
import type {
  InventoryAudit,
  MeAlert,
  MeAlertStatus,
  MeIngresoRow,
  MeInventarioViewRow,
  MeMaterial,
  MeSalidaRow,
  MpCompraRow,
  MpControlRow,
  MpIngresoRow,
  MpStockRow,
} from "./types";

export type InventoryActor = {
  email: string;
  sector: SectorId;
  displayName?: string;
};

export type InventoryNotificationPayload = {
  kind: "me_aviso";
  title: string;
  message: string;
  sectors: SectorId[];
  href?: string;
  alertId: string;
};

type OaMeShortageLite = {
  codigo: string;
  material: string;
  materialId: string | null;
  stockDisponible: number;
  cantidadSolicitada: number;
  diferencia: number;
};

function nowIso() {
  return new Date().toISOString();
}

function todayIso() {
  return new Date().toISOString().slice(0, 10);
}

export class InventoryForbiddenError extends Error {
  status = 403;
  code = "FORBIDDEN";
  constructor(message: string) {
    super(message);
    this.name = "InventoryForbiddenError";
  }
}

export class InventoryValidationError extends Error {
  status = 400;
  code = "VALIDATION";
  shortages?: OaMeShortageLite[];
  constructor(message: string, shortages?: OaMeShortageLite[]) {
    super(message);
    this.name = "InventoryValidationError";
    this.shortages = shortages;
  }
}

export class InventoryNotFoundError extends Error {
  status = 404;
  code = "NOT_FOUND";
  constructor(message: string) {
    super(message);
    this.name = "InventoryNotFoundError";
  }
}

type NotifyFn = (payload: InventoryNotificationPayload) => void | Promise<void>;

export class InventoryService {
  private notifyFn: NotifyFn | null = null;

  constructor(private readonly repo: MemoryInventoryRepo) {}

  onNotify(fn: NotifyFn) {
    this.notifyFn = fn;
  }

  private guard(actor: InventoryActor | null | undefined, module: InventoryModule, write: boolean) {
    if (!actor?.sector) {
      throw new InventoryForbiddenError("actorSectorId requerido");
    }
    if (write) {
      if (!canWriteInventory(actor.sector, module)) {
        throw new InventoryForbiddenError(`Sector ${actor.sector} no puede escribir ${module}`);
      }
    } else if (!canReadInventory(actor.sector, module)) {
      throw new InventoryForbiddenError(`Sector ${actor.sector} no puede leer ${module}`);
    }
  }

  private audit(
    actor: InventoryActor,
    module: string,
    entityId: string,
    action: string,
    before: Record<string, unknown> | null,
    after: Record<string, unknown> | null,
    reason: string | null = null
  ) {
    const row: InventoryAudit = {
      id: randomUUID(),
      module,
      entityId,
      action,
      actor: actor.email,
      actorSector: actor.sector,
      reason,
      before,
      after,
      createdAt: nowIso(),
    };
    this.repo.addAudit(row);
    return row;
  }

  // ─── ME Ingresos ───────────────────────────────────────────

  listMeIngresos(actor: InventoryActor) {
    this.guard(actor, "me_ingresos", false);
    return this.repo.listMeIngresos();
  }

  upsertMeIngreso(
    actor: InventoryActor,
    input: Partial<MeIngresoRow> & { id?: string },
    opts?: { allowNegativeStock?: boolean; negativeReason?: string }
  ) {
    this.guard(actor, "me_ingresos", true);
    const existing = input.id ? this.repo.getMeIngreso(input.id) : null;
    const bultos = parseOptionalNumber(input.bultos);
    const cantidad = parseOptionalNumber(input.cantidad);
    const total = multiplyTotal(bultos, cantidad);
    const now = nowIso();
    const material = this.resolveOrCreateMeMaterial(actor, {
      materialId: input.materialId ?? existing?.materialId ?? null,
      codigo: input.codigo ?? existing?.codigo ?? "",
      descripcion: input.descripcionInsumo ?? existing?.descripcionInsumo ?? "",
      ubicacion: input.ubicacion ?? existing?.ubicacion ?? "",
      cliente: input.cliente ?? existing?.cliente ?? "",
    });

    const row: MeIngresoRow = {
      id: existing?.id ?? input.id ?? randomUUID(),
      fecha: input.fecha ?? existing?.fecha ?? todayIso(),
      ingresoNro: input.ingresoNro ?? existing?.ingresoNro ?? this.nextMeIngresoNro(),
      proveedor: input.proveedor ?? existing?.proveedor ?? "",
      cliente: input.cliente ?? existing?.cliente ?? "",
      remitoNro: input.remitoNro ?? existing?.remitoNro ?? "",
      codigo: input.codigo ?? existing?.codigo ?? material.codigo,
      descripcionInsumo: input.descripcionInsumo ?? existing?.descripcionInsumo ?? material.descripcion,
      bultos,
      cantidad,
      total,
      ubicacion: input.ubicacion ?? existing?.ubicacion ?? material.ubicacion,
      materialId: material.id,
      createdBy: existing?.createdBy ?? actor.email,
      updatedBy: actor.email,
      createdAt: existing?.createdAt ?? now,
      updatedAt: now,
    };

    // Revert previous impact then apply new
    if (existing?.materialId && existing.total != null) {
      this.applyMeStockDelta(existing.materialId, -existing.total);
    }
    if (row.materialId && row.total != null) {
      this.applyMeStockDelta(row.materialId, row.total, {
        allowNegative: opts?.allowNegativeStock,
        reason: opts?.negativeReason,
        actor,
      });
    }

    this.repo.upsertMeIngreso(row);
    this.audit(
      actor,
      "me_ingresos",
      row.id,
      existing ? "update" : "create",
      existing as unknown as Record<string, unknown> | null,
      row as unknown as Record<string, unknown>
    );
    this.syncMeAlerts(actor, row.materialId!);
    return row;
  }

  deleteMeIngreso(actor: InventoryActor, id: string, reason: string) {
    this.guard(actor, "me_ingresos", true);
    if (!reason.trim()) throw new InventoryValidationError("Motivo obligatorio para eliminar ingreso.");
    const existing = this.repo.getMeIngreso(id);
    if (!existing) throw new InventoryNotFoundError("Ingreso ME no encontrado.");
    if (existing.materialId && existing.total != null) {
      this.applyMeStockDelta(existing.materialId, -existing.total, { actor, reason });
    }
    this.repo.deleteMeIngreso(id);
    this.audit(
      actor,
      "me_ingresos",
      id,
      "delete",
      existing as unknown as Record<string, unknown>,
      null,
      reason
    );
    if (existing.materialId) this.syncMeAlerts(actor, existing.materialId);
  }

  private nextMeIngresoNro() {
    const n = this.repo.listMeIngresos().length + 1;
    return `ME-I-${String(n).padStart(5, "0")}`;
  }

  // ─── ME Salidas ────────────────────────────────────────────

  listMeSalidas(actor: InventoryActor) {
    this.guard(actor, "me_salidas", false);
    return this.repo.listMeSalidas();
  }

  upsertMeSalida(
    actor: InventoryActor,
    input: Partial<MeSalidaRow> & { id?: string },
    opts?: { allowNegativeStock?: boolean; negativeReason?: string }
  ) {
    void opts;
    this.guard(actor, "me_salidas", true);
    const existing = input.id ? this.repo.getMeSalida(input.id) : null;
    const bultos = parseOptionalNumber(input.bultos);
    const cantidad = parseOptionalNumber(input.cantidad);
    // Prefer cantidad as unidades when bultos empty (salidas OA)
    const total =
      multiplyTotal(bultos, cantidad) ??
      (cantidad != null ? cantidad : null);
    const now = nowIso();
    const origen = input.origen ?? existing?.origen ?? "MANUAL";

    let materialId = input.materialId ?? existing?.materialId ?? null;
    const codigo = (input.codigo ?? existing?.codigo ?? "").trim();
    if (!materialId && codigo) {
      materialId = this.repo.findMeMaterialByCodigo(codigo)?.id ?? null;
    }

    const row: MeSalidaRow = {
      id: existing?.id ?? input.id ?? randomUUID(),
      fecha: input.fecha ?? existing?.fecha ?? todayIso(),
      egresoNro: input.egresoNro ?? existing?.egresoNro ?? this.nextMeEgresoNro(),
      cliente: input.cliente ?? existing?.cliente ?? "",
      remitoNro: input.remitoNro ?? existing?.remitoNro ?? "",
      descripcion: input.descripcion ?? existing?.descripcion ?? "",
      bultos,
      cantidad,
      total,
      control: input.control ?? existing?.control ?? false,
      entregado: input.entregado ?? existing?.entregado ?? false,
      comentarios: input.comentarios ?? existing?.comentarios ?? "",
      materialId,
      codigo,
      unidad: input.unidad ?? existing?.unidad ?? "u",
      origen,
      oaId: input.oaId ?? existing?.oaId ?? null,
      oaNumber: input.oaNumber ?? existing?.oaNumber ?? null,
      oaVersion: input.oaVersion ?? existing?.oaVersion ?? null,
      materialLineId: input.materialLineId ?? existing?.materialLineId ?? null,
      idempotencyKey: input.idempotencyKey ?? existing?.idempotencyKey ?? null,
      reverted: input.reverted ?? existing?.reverted ?? false,
      revertedAt: input.revertedAt ?? existing?.revertedAt ?? null,
      revertReason: input.revertReason ?? existing?.revertReason ?? null,
      createdBy: existing?.createdBy ?? actor.email,
      updatedBy: actor.email,
      createdAt: existing?.createdAt ?? now,
      updatedAt: now,
    };

    // Salidas MANUALES no descuentan inventario (solo OA).
    this.repo.upsertMeSalida(row);
    this.audit(
      actor,
      "me_salidas",
      row.id,
      existing ? "update" : "create",
      existing as unknown as Record<string, unknown> | null,
      row as unknown as Record<string, unknown>
    );
    return row;
  }

  deleteMeSalida(actor: InventoryActor, id: string, reason: string) {
    this.guard(actor, "me_salidas", true);
    if (!reason.trim()) throw new InventoryValidationError("Motivo obligatorio para eliminar salida.");
    const existing = this.repo.getMeSalida(id);
    if (!existing) throw new InventoryNotFoundError("Salida ME no encontrada.");
    // Solo revertir stock si era salida OA activa
    if (
      existing.origen === "OA" &&
      !existing.reverted &&
      existing.materialId &&
      (existing.total ?? existing.cantidad) != null
    ) {
      this.applyMeStockDelta(existing.materialId, existing.total ?? existing.cantidad ?? 0, {
        actor,
        reason,
      });
      this.syncMeAlerts(actor, existing.materialId);
    }
    this.repo.deleteMeSalida(id);
    this.audit(
      actor,
      "me_salidas",
      id,
      "delete",
      existing as unknown as Record<string, unknown>,
      null,
      reason
    );
  }

  private nextMeEgresoNro() {
    const n = this.repo.listMeSalidas().length + 1;
    return `ME-E-${String(n).padStart(5, "0")}`;
  }

  // ─── ME Stock / materiales ─────────────────────────────────

  listMeMaterials(actor: InventoryActor) {
    this.guard(actor, "me_stock", false);
    return this.repo.listMeMaterials();
  }

  updateMeThresholds(
    actor: InventoryActor,
    materialId: string,
    patch: Partial<Pick<MeMaterial, "stockMinimo" | "puntoReposicion" | "unidad" | "responsable" | "observacion">>
  ) {
    this.guard(actor, "me_avisos", true);
    const mat = this.repo.getMeMaterial(materialId);
    if (!mat) throw new InventoryNotFoundError("Material ME no encontrado.");
    const updated: MeMaterial = {
      ...mat,
      ...patch,
      updatedAt: nowIso(),
    };
    this.repo.upsertMeMaterial(updated);
    this.syncMeAlerts(actor, materialId);
    return updated;
  }

  adjustMeStock(
    actor: InventoryActor,
    materialId: string,
    cantidadNueva: number,
    motivo: string
  ) {
    this.guard(actor, "me_ajustes", true);
    if (!motivo.trim()) throw new InventoryValidationError("Motivo obligatorio para ajuste de stock.");
    const mat = this.repo.getMeMaterial(materialId);
    if (!mat) throw new InventoryNotFoundError("Material ME no encontrado.");
    const anterior = mat.stockActual;
    const diferencia = cantidadNueva - anterior;
    const updated: MeMaterial = { ...mat, stockActual: cantidadNueva, updatedAt: nowIso() };
    this.repo.upsertMeMaterial(updated);
    const ajuste: StockAjuste = {
      id: randomUUID(),
      module: "ME",
      entityId: materialId,
      cantidadAnterior: anterior,
      cantidadNueva,
      diferencia,
      motivo,
      actor: actor.email,
      actorSector: actor.sector,
      createdAt: nowIso(),
    };
    this.repo.addAjuste(ajuste);
    this.audit(
      actor,
      "me_ajustes",
      materialId,
      "adjust",
      { stockActual: anterior },
      { stockActual: cantidadNueva },
      motivo
    );
    this.syncMeAlerts(actor, materialId);
    return { material: updated, ajuste };
  }

  private resolveOrCreateMeMaterial(
    actor: InventoryActor,
    input: {
      materialId: string | null;
      codigo: string;
      descripcion: string;
      ubicacion: string;
      cliente?: string;
    }
  ): MeMaterial {
    if (input.materialId) {
      const existing = this.repo.getMeMaterial(input.materialId);
      if (existing) return existing;
    }
    if (input.codigo.trim()) {
      const byCode = this.repo.findMeMaterialByCodigo(input.codigo);
      if (byCode) {
        // Actualizar cliente/descripcion si venían vacíos
        const patched: MeMaterial = {
          ...byCode,
          descripcion: byCode.descripcion || input.descripcion.trim() || byCode.descripcion,
          cliente: byCode.cliente || input.cliente?.trim() || byCode.cliente,
          ubicacion: byCode.ubicacion || input.ubicacion,
          updatedAt: nowIso(),
        };
        this.repo.upsertMeMaterial(patched);
        return patched;
      }
    }
    const created: MeMaterial = {
      id: randomUUID(),
      codigo: input.codigo.trim(),
      descripcion: input.descripcion.trim() || "Sin descripción",
      cliente: input.cliente?.trim() ?? "",
      ubicacion: input.ubicacion,
      unidad: "u",
      cantidadPorBulto: null,
      stockActual: 0,
      stockMinimo: null,
      puntoReposicion: null,
      responsable: "",
      observacion: "",
      updatedAt: nowIso(),
    };
    this.repo.upsertMeMaterial(created);
    this.audit(actor, "me_stock", created.id, "create", null, created as unknown as Record<string, unknown>);
    return created;
  }

  /** STOCK = ingresos − salidas OA activas. */
  recalculateMeStock(materialId: string): MeMaterial {
    const mat = this.repo.getMeMaterial(materialId);
    if (!mat) throw new InventoryNotFoundError("Material ME no encontrado.");
    const ingresos = this.repo
      .listMeIngresos()
      .filter((r) => r.materialId === materialId)
      .reduce((acc, r) => acc + (r.total ?? 0), 0);
    const salidasOa = this.repo
      .listMeSalidas()
      .filter((r) => r.materialId === materialId && r.origen === "OA" && !r.reverted)
      .reduce((acc, r) => acc + (r.total ?? r.cantidad ?? 0), 0);
    const stockActual = Number((ingresos - salidasOa).toFixed(6));
    const updated: MeMaterial = { ...mat, stockActual, updatedAt: nowIso() };
    this.repo.upsertMeMaterial(updated);
    return updated;
  }

  listMeInventario(actor: InventoryActor): MeInventarioViewRow[] {
    this.guard(actor, "me_stock", false);
    return this.repo.listMeMaterials().map((m) => {
      const fresh = this.recalculateMeStock(m.id);
      return {
        materialId: fresh.id,
        codigo: fresh.codigo,
        cliente: fresh.cliente,
        insumo: fresh.descripcion,
        bultosDisplay: formatMeBultosDisplay(fresh.stockActual, fresh.cantidadPorBulto),
        cantidadTotal: fresh.stockActual,
        ubicacion: fresh.ubicacion,
        updatedAt: fresh.updatedAt,
      };
    });
  }

  getMeMaterialById(actor: InventoryActor, id: string) {
    this.guard(actor, "me_stock", false);
    return this.repo.getMeMaterial(id);
  }

  getMeMaterialByCodigo(actor: InventoryActor, codigo: string) {
    this.guard(actor, "me_stock", false);
    return this.repo.findMeMaterialByCodigo(codigo);
  }

  applyOaStockDelta(
    actor: InventoryActor,
    materialId: string,
    delta: number,
    opts?: { allowNegative?: boolean; reason?: string }
  ) {
    if (!canWriteOaMeSalida(actor.sector) && !canWriteInventory(actor.sector, "me_ajustes")) {
      throw new InventoryForbiddenError("Sector no puede ajustar stock ME por OA.");
    }
    this.applyMeStockDelta(materialId, delta, {
      allowNegative: opts?.allowNegative,
      reason: opts?.reason,
      actor,
    });
  }

  resolveMeMaterialByCodigo(
    actor: InventoryActor,
    input: { codigo: string; descripcion: string; cliente?: string; materialId?: string | null }
  ) {
    if (!canWriteOaMeSalida(actor.sector) && !canWriteInventory(actor.sector, "me_ingresos")) {
      throw new InventoryForbiddenError("Sector no puede resolver materiales ME.");
    }
    return this.resolveOrCreateMeMaterial(actor, {
      materialId: input.materialId ?? null,
      codigo: input.codigo,
      descripcion: input.descripcion,
      ubicacion: "",
      cliente: input.cliente,
    });
  }

  createOaMeSalida(
    actor: InventoryActor,
    input: {
      codigo: string;
      descripcion: string;
      cliente: string;
      unidad: string;
      cantidad: number;
      materialId: string;
      oaId: string;
      oaNumber: string;
      oaVersion: number;
      materialLineId: string;
      idempotencyKey: string;
    }
  ): MeSalidaRow {
    if (!canWriteOaMeSalida(actor.sector)) {
      throw new InventoryForbiddenError("Sector no puede generar salidas ME desde OA.");
    }
    // Bypass guard me_salidas (solo DEPOSITO CRUD manual); OA es automática.
    const existing = this.repo.listMeSalidas().find((s) => s.idempotencyKey === input.idempotencyKey);
    const now = nowIso();
    const row: MeSalidaRow = {
      id: existing?.id ?? randomUUID(),
      fecha: todayIso(),
      egresoNro: existing?.egresoNro ?? this.nextMeEgresoNro(),
      cliente: input.cliente,
      remitoNro: input.oaNumber,
      descripcion: input.descripcion,
      bultos: 1,
      cantidad: input.cantidad,
      total: input.cantidad,
      control: true,
      entregado: true,
      comentarios: `Origen automático · OA ${input.oaNumber} · id ${input.oaId}`,
      materialId: input.materialId,
      codigo: input.codigo,
      unidad: input.unidad,
      origen: "OA",
      oaId: input.oaId,
      oaNumber: input.oaNumber,
      oaVersion: input.oaVersion,
      materialLineId: input.materialLineId,
      idempotencyKey: input.idempotencyKey,
      reverted: false,
      revertedAt: null,
      revertReason: null,
      createdBy: existing?.createdBy ?? actor.email,
      updatedBy: actor.email,
      createdAt: existing?.createdAt ?? now,
      updatedAt: now,
    };
    this.repo.upsertMeSalida(row);
    this.audit(
      actor,
      "me_salidas_oa",
      row.id,
      existing ? "update" : "create",
      existing as unknown as Record<string, unknown> | null,
      row as unknown as Record<string, unknown>
    );
    return row;
  }

  findMeSalidaByIdempotencyKey(key: string) {
    return this.repo.listMeSalidas().find((s) => s.idempotencyKey === key) ?? null;
  }

  findActiveMeSalidaForOaLine(oaId: string, materialLineId: string) {
    return (
      this.repo
        .listMeSalidas()
        .filter(
          (s) =>
            s.oaId === oaId &&
            s.materialLineId === materialLineId &&
            s.origen === "OA" &&
            !s.reverted
        )
        .sort((a, b) => (b.oaVersion ?? 0) - (a.oaVersion ?? 0))[0] ?? null
    );
  }

  listMeSalidasByOaId(oaId: string) {
    return this.repo.listMeSalidas().filter((s) => s.oaId === oaId);
  }

  markMeSalidaReverted(actor: InventoryActor, id: string, reason: string) {
    if (!canWriteOaMeSalida(actor.sector) && !canWriteInventory(actor.sector, "me_salidas")) {
      throw new InventoryForbiddenError("Sector no puede revertir salidas OA.");
    }
    const existing = this.repo.getMeSalida(id);
    if (!existing) return;
    this.repo.upsertMeSalida({
      ...existing,
      reverted: true,
      revertedAt: nowIso(),
      revertReason: reason,
      updatedBy: actor.email,
      updatedAt: nowIso(),
    });
  }

  markMeSalidaReplaced(actor: InventoryActor, id: string, reason: string) {
    this.markMeSalidaReverted(actor, id, reason);
  }

  /** Expuesto para puente OA (avisos post-descuento). */
  syncMeAlertsPublic(actor: InventoryActor, materialId: string) {
    return this.syncMeAlerts(actor, materialId);
  }

  private applyMeStockDelta(
    materialId: string,
    delta: number,
    opts?: {
      allowNegative?: boolean;
      reason?: string;
      actor?: InventoryActor;
    }
  ) {
    const mat = this.repo.getMeMaterial(materialId);
    if (!mat) throw new InventoryNotFoundError("Material ME no encontrado.");
    const next = mat.stockActual + delta;
    if (next < 0 && !opts?.allowNegative) {
      throw new InventoryValidationError(
        `Stock negativo no permitido sin confirmación (quedaría ${next}).`
      );
    }
    if (next < 0 && opts?.allowNegative && !opts.reason?.trim()) {
      throw new InventoryValidationError("Motivo obligatorio para stock negativo.");
    }
    this.repo.upsertMeMaterial({ ...mat, stockActual: next, updatedAt: nowIso() });
    if (next < 0 && opts?.actor && opts.reason) {
      this.audit(
        opts.actor,
        "me_stock",
        materialId,
        "negative_stock",
        { stockActual: mat.stockActual },
        { stockActual: next },
        opts.reason
      );
    }
  }

  // ─── ME Avisos ─────────────────────────────────────────────

  listMeAlerts(actor: InventoryActor) {
    this.guard(actor, "me_avisos", false);
    return this.repo.listMeAlerts().filter((a) => a.status !== "ARCHIVADO");
  }

  createManualAlert(
    actor: InventoryActor,
    input: {
      materialId: string;
      observaciones?: string;
      cantidadSugerida?: number | null;
    }
  ) {
    this.guard(actor, "me_avisos", true);
    if (actor.sector !== "DEPOSITO") {
      throw new InventoryForbiddenError("Solo DEPOSITO puede crear avisos manuales.");
    }
    const mat = this.repo.getMeMaterial(input.materialId);
    if (!mat) throw new InventoryNotFoundError("Material ME no encontrado.");
    const open = this.repo.findOpenAlert(mat.id);
    if (open) {
      const updated: MeAlert = {
        ...open,
        stockActual: mat.stockActual,
        stockMinimo: mat.stockMinimo,
        cantidadSugerida: input.cantidadSugerida ?? open.cantidadSugerida,
        observaciones: input.observaciones ?? open.observaciones,
        updatedAt: nowIso(),
      };
      this.repo.upsertMeAlert(updated);
      return updated;
    }
    const alert = this.buildAlert(mat, "STOCK_BAJO", false, input.observaciones ?? "", input.cantidadSugerida);
    this.repo.upsertMeAlert(alert);
    void this.emitAlertNotification(alert);
    return alert;
  }

  patchMeAlert(
    actor: InventoryActor,
    id: string,
    patch: { status?: MeAlertStatus; observaciones?: string }
  ) {
    this.guard(actor, "me_avisos", true);
    const alerts = this.repo.listMeAlerts();
    const existing = alerts.find((a) => a.id === id);
    if (!existing) throw new InventoryNotFoundError("Aviso no encontrado.");

    if (actor.sector === "PRODUCCION") {
      const allowed = ["COMPRA_SOLICITADA", "RESUELTO"] as MeAlertStatus[];
      if (patch.status && !allowed.includes(patch.status)) {
        throw new InventoryForbiddenError("PRODUCCION solo puede marcar compra solicitada o resuelto.");
      }
    }

    const updated: MeAlert = {
      ...existing,
      status: patch.status ?? existing.status,
      observaciones:
        patch.observaciones != null
          ? [existing.observaciones, patch.observaciones].filter(Boolean).join("\n")
          : existing.observaciones,
      updatedAt: nowIso(),
      resolvedAt:
        patch.status === "RESUELTO" || patch.status === "ARCHIVADO" ? nowIso() : existing.resolvedAt,
    };
    this.repo.upsertMeAlert(updated);
    this.audit(
      actor,
      "me_avisos",
      id,
      "patch",
      existing as unknown as Record<string, unknown>,
      updated as unknown as Record<string, unknown>
    );
    return updated;
  }

  markAlertRead(actor: InventoryActor, alertId: string) {
    if (!actor?.sector || !ME_ALERT_NOTIFY_SECTORS.includes(actor.sector)) {
      throw new InventoryForbiddenError("Sector no autorizado para lecturas de aviso.");
    }
    this.repo.upsertAlertRead({
      alertId,
      actorEmail: actor.email,
      readAt: nowIso(),
      dismissedAt: this.repo.getAlertRead(alertId, actor.email)?.dismissedAt ?? null,
    });
  }

  dismissAlertForUser(actor: InventoryActor, alertId: string) {
    if (!actor?.sector || !ME_ALERT_NOTIFY_SECTORS.includes(actor.sector)) {
      throw new InventoryForbiddenError("Sector no autorizado para descartar aviso de bandeja.");
    }
    const prev = this.repo.getAlertRead(alertId, actor.email);
    this.repo.upsertAlertRead({
      alertId,
      actorEmail: actor.email,
      readAt: prev?.readAt ?? nowIso(),
      dismissedAt: nowIso(),
    });
    // No elimina el aviso global
  }

  private buildAlert(
    mat: MeMaterial,
    status: MeAlertStatus,
    auto: boolean,
    observaciones: string,
    cantidadSugerida?: number | null
  ): MeAlert {
    const sugerida =
      cantidadSugerida ??
      (mat.puntoReposicion != null
        ? Math.max(mat.puntoReposicion - mat.stockActual, 0)
        : mat.stockMinimo != null
          ? Math.max(mat.stockMinimo - mat.stockActual, 0)
          : null);
    return {
      id: randomUUID(),
      materialId: mat.id,
      materialDescripcion: mat.descripcion,
      codigo: mat.codigo,
      stockActual: mat.stockActual,
      stockMinimo: mat.stockMinimo,
      cantidadSugerida: sugerida,
      ubicacion: mat.ubicacion,
      status,
      autoGenerated: auto,
      observaciones,
      createdAt: nowIso(),
      updatedAt: nowIso(),
      resolvedAt: null,
    };
  }

  /** Crear/actualizar aviso al cruzar umbral; no duplicar. */
  syncMeAlerts(actor: InventoryActor, materialId: string) {
    const mat = this.repo.getMeMaterial(materialId);
    if (!mat) return null;
    const level = calcMeAlertLevel(mat.stockActual, mat.stockMinimo, mat.puntoReposicion);
    const open = this.repo.findOpenAlert(materialId);

    if (level === "OK") {
      if (open && open.autoGenerated) {
        const recovered: MeAlert = {
          ...open,
          stockActual: mat.stockActual,
          status: "STOCK_RECUPERADO",
          updatedAt: nowIso(),
          resolvedAt: nowIso(),
        };
        this.repo.upsertMeAlert(recovered);
        return recovered;
      }
      return open;
    }

    const status: MeAlertStatus =
      level === "SIN_STOCK" ? "SIN_STOCK" : level === "CRITICO" ? "STOCK_CRITICO" : "STOCK_BAJO";

    if (open) {
      const updated: MeAlert = {
        ...open,
        stockActual: mat.stockActual,
        stockMinimo: mat.stockMinimo,
        status: open.status === "COMPRA_SOLICITADA" ? open.status : status,
        cantidadSugerida:
          mat.puntoReposicion != null
            ? Math.max(mat.puntoReposicion - mat.stockActual, 0)
            : mat.stockMinimo != null
              ? Math.max(mat.stockMinimo - mat.stockActual, 0)
              : open.cantidadSugerida,
        updatedAt: nowIso(),
      };
      this.repo.upsertMeAlert(updated);
      return updated;
    }

    const alert = this.buildAlert(mat, status, true, "");
    this.repo.upsertMeAlert(alert);
    void this.emitAlertNotification(alert);
    return alert;
  }

  private async emitAlertNotification(alert: MeAlert) {
    const title =
      alert.status === "SIN_STOCK"
        ? `Sin stock: ${alert.materialDescripcion}`
        : `Stock bajo de ${alert.materialDescripcion}`;
    const message = `Quedan ${alert.stockActual} unidades.${
      alert.stockMinimo != null ? ` El stock mínimo configurado es ${alert.stockMinimo}.` : ""
    }${
      alert.cantidadSugerida != null
        ? ` Depósito recomienda comprar ${alert.cantidadSugerida}.`
        : ""
    }`;
    if (this.notifyFn) {
      await this.notifyFn({
        kind: "me_aviso",
        title,
        message,
        sectors: ME_ALERT_NOTIFY_SECTORS,
        href: "/avisos",
        alertId: alert.id,
      });
    }
  }

  // ─── MP Stock ──────────────────────────────────────────────

  listMpStock(actor: InventoryActor) {
    this.guard(actor, "mp_stock", false);
    return this.repo.listMpStock().map((r) => this.enrichMpStock(r));
  }

  upsertMpStock(actor: InventoryActor, input: Partial<MpStockRow> & { id?: string }) {
    this.guard(actor, "mp_stock", true);
    const existing = input.id ? this.repo.getMpStock(input.id) : null;
    const cantidadKg = parseOptionalNumber(input.cantidadKg);
    const now = nowIso();
    const base: MpStockRow = {
      id: existing?.id ?? input.id ?? randomUUID(),
      proveedor: input.proveedor ?? existing?.proveedor ?? "",
      cliente: input.cliente ?? existing?.cliente ?? "",
      descripcion: input.descripcion ?? existing?.descripcion ?? "",
      cantidadKg,
      ubicacion: input.ubicacion ?? existing?.ubicacion ?? "",
      lote: input.lote ?? existing?.lote ?? "",
      vencimiento: input.vencimiento ?? existing?.vencimiento ?? "",
      estadoStock: "",
      diasAlVence: null,
      estadoVencimiento: "",
      origen: input.origen ?? existing?.origen ?? "manual",
      codigo: input.codigo ?? existing?.codigo ?? "",
      createdBy: existing?.createdBy ?? actor.email,
      updatedBy: actor.email,
      createdAt: existing?.createdAt ?? now,
      updatedAt: now,
    };
    const row = this.enrichMpStock(base);
    this.repo.upsertMpStock(row);
    this.audit(
      actor,
      "mp_stock",
      row.id,
      existing ? "update" : "create",
      existing as unknown as Record<string, unknown> | null,
      row as unknown as Record<string, unknown>
    );
    return row;
  }

  deleteMpStock(actor: InventoryActor, id: string, reason: string) {
    this.guard(actor, "mp_stock", true);
    if (!reason.trim()) throw new InventoryValidationError("Motivo obligatorio.");
    const existing = this.repo.getMpStock(id);
    if (!existing) throw new InventoryNotFoundError("Stock MP no encontrado.");
    this.repo.deleteMpStock(id);
    this.audit(
      actor,
      "mp_stock",
      id,
      "delete",
      existing as unknown as Record<string, unknown>,
      null,
      reason
    );
  }

  adjustMpStock(actor: InventoryActor, id: string, cantidadNueva: number, motivo: string) {
    this.guard(actor, "mp_stock", true);
    if (!motivo.trim()) throw new InventoryValidationError("Motivo obligatorio para ajuste.");
    const existing = this.repo.getMpStock(id);
    if (!existing) throw new InventoryNotFoundError("Stock MP no encontrado.");
    const anterior = existing.cantidadKg ?? 0;
    const updated = this.enrichMpStock({
      ...existing,
      cantidadKg: cantidadNueva,
      updatedBy: actor.email,
      updatedAt: nowIso(),
    });
    this.repo.upsertMpStock(updated);
    this.repo.addAjuste({
      id: randomUUID(),
      module: "MP",
      entityId: id,
      cantidadAnterior: anterior,
      cantidadNueva,
      diferencia: cantidadNueva - anterior,
      motivo,
      actor: actor.email,
      actorSector: actor.sector,
      createdAt: nowIso(),
    });
    this.audit(
      actor,
      "mp_stock",
      id,
      "adjust",
      { cantidadKg: anterior },
      { cantidadKg: cantidadNueva },
      motivo
    );
    return updated;
  }

  private enrichMpStock(row: MpStockRow): MpStockRow {
    const dias = calcDiasAlVence(row.vencimiento || null);
    return {
      ...row,
      estadoStock: calcMpEstadoStock(row.cantidadKg),
      diasAlVence: dias,
      estadoVencimiento: calcMpEstadoVencimiento(dias),
    };
  }

  // ─── MP Ingresos ───────────────────────────────────────────

  listMpIngresos(actor: InventoryActor) {
    this.guard(actor, "mp_ingresos", false);
    return this.repo.listMpIngresos();
  }

  upsertMpIngreso(actor: InventoryActor, input: Partial<MpIngresoRow> & { id?: string }) {
    this.guard(actor, "mp_ingresos", true);
    const existing = input.id ? this.repo.getMpIngreso(input.id) : null;
    const bultos = parseOptionalNumber(input.bultos);
    const cantidad = parseOptionalNumber(input.cantidad);
    const total = multiplyTotal(bultos, cantidad);
    const now = nowIso();

    // Revert previous stock impact
    if (existing?.stockLotId && existing.total != null) {
      this.applyMpIngresoDelta(existing.stockLotId, -existing.total);
    }

    const row: MpIngresoRow = {
      id: existing?.id ?? input.id ?? randomUUID(),
      fecha: input.fecha ?? existing?.fecha ?? todayIso(),
      ingresoNro: input.ingresoNro ?? existing?.ingresoNro ?? this.nextMpIngresoNro(),
      proveedor: input.proveedor ?? existing?.proveedor ?? "",
      cliente: input.cliente ?? existing?.cliente ?? "",
      remitoNro: input.remitoNro ?? existing?.remitoNro ?? "",
      codigo: input.codigo ?? existing?.codigo ?? "",
      descripcion: input.descripcion ?? existing?.descripcion ?? "",
      bultos,
      cantidad,
      total,
      ubicacion: input.ubicacion ?? existing?.ubicacion ?? "",
      lote: input.lote ?? existing?.lote ?? "",
      vencimiento: input.vencimiento ?? existing?.vencimiento ?? "",
      stockLotId: existing?.stockLotId ?? null,
      createdBy: existing?.createdBy ?? actor.email,
      updatedBy: actor.email,
      createdAt: existing?.createdAt ?? now,
      updatedAt: now,
    };

    if (total != null && row.descripcion.trim()) {
      const lot = this.resolveMpLot(actor, row);
      row.stockLotId = lot.id;
      this.applyMpIngresoDelta(lot.id, total);
    }

    this.repo.upsertMpIngreso(row);
    this.audit(
      actor,
      "mp_ingresos",
      row.id,
      existing ? "update" : "create",
      existing as unknown as Record<string, unknown> | null,
      row as unknown as Record<string, unknown>
    );
    return row;
  }

  deleteMpIngreso(actor: InventoryActor, id: string, reason: string) {
    this.guard(actor, "mp_ingresos", true);
    if (!reason.trim()) throw new InventoryValidationError("Motivo obligatorio.");
    const existing = this.repo.getMpIngreso(id);
    if (!existing) throw new InventoryNotFoundError("Ingreso MP no encontrado.");
    if (existing.stockLotId && existing.total != null) {
      this.applyMpIngresoDelta(existing.stockLotId, -existing.total);
    }
    this.repo.deleteMpIngreso(id);
    this.audit(
      actor,
      "mp_ingresos",
      id,
      "delete",
      existing as unknown as Record<string, unknown>,
      null,
      reason
    );
  }

  private nextMpIngresoNro() {
    return `MP-I-${String(this.repo.listMpIngresos().length + 1).padStart(5, "0")}`;
  }

  private resolveMpLot(actor: InventoryActor, ingreso: MpIngresoRow): MpStockRow {
    if (ingreso.stockLotId) {
      const existing = this.repo.getMpStock(ingreso.stockLotId);
      if (existing) return existing;
    }
    if (ingreso.lote.trim()) {
      const byLot = this.repo.findMpStockByDescLote(ingreso.descripcion, ingreso.lote);
      if (byLot) return byLot;
    }
    const created = this.enrichMpStock({
      id: randomUUID(),
      proveedor: ingreso.proveedor,
      cliente: ingreso.cliente,
      descripcion: ingreso.descripcion,
      cantidadKg: 0,
      ubicacion: ingreso.ubicacion,
      lote: ingreso.lote,
      vencimiento: ingreso.vencimiento,
      estadoStock: "Sin stock",
      diasAlVence: null,
      estadoVencimiento: "",
      origen: "ingreso",
      codigo: ingreso.codigo,
      createdBy: actor.email,
      updatedBy: actor.email,
      createdAt: nowIso(),
      updatedAt: nowIso(),
    });
    this.repo.upsertMpStock(created);
    return created;
  }

  private applyMpIngresoDelta(stockLotId: string, delta: number) {
    const lot = this.repo.getMpStock(stockLotId);
    if (!lot) throw new InventoryNotFoundError("Lote MP no encontrado.");
    const next = (lot.cantidadKg ?? 0) + delta;
    this.repo.upsertMpStock(
      this.enrichMpStock({
        ...lot,
        cantidadKg: next,
        updatedAt: nowIso(),
      })
    );
  }

  // ─── MP Control ────────────────────────────────────────────

  listMpControl(actor: InventoryActor) {
    this.guard(actor, "mp_control", false);
    return this.repo.listMpControl().map((r) => this.enrichControl(r));
  }

  upsertMpControl(actor: InventoryActor, input: Partial<MpControlRow> & { id?: string }) {
    this.guard(actor, "mp_control", true);
    const existing = input.id
      ? this.repo.listMpControl().find((r) => r.id === input.id) ?? null
      : null;
    const now = nowIso();
    let enInventario = parseOptionalNumber(input.enInventario);
    let inventarioOrigen: MpControlRow["inventarioOrigen"] = input.inventarioOrigen ?? "MANUAL";
    let stockLotId = input.stockLotId ?? existing?.stockLotId ?? null;

    const materiaPrima = input.materiaPrima ?? existing?.materiaPrima ?? "";
    if (materiaPrima.trim()) {
      const match = stockLotId
        ? this.repo.getMpStock(stockLotId)
        : this.repo.findMpStockByDescripcion(materiaPrima);
      if (match) {
        enInventario = match.cantidadKg;
        inventarioOrigen = "STOCK";
        stockLotId = match.id;
      }
    }

    const cantNecesaria = parseOptionalNumber(input.cantNecesaria ?? existing?.cantNecesaria);
    const falta = calcFalta(cantNecesaria, enInventario);
    const estado = calcControlEstado(falta);

    const row: MpControlRow = {
      id: existing?.id ?? input.id ?? randomUUID(),
      semanaLabel: input.semanaLabel ?? existing?.semanaLabel ?? "",
      productoElaborar: input.productoElaborar ?? existing?.productoElaborar ?? "",
      materiaPrima,
      cantNecesaria,
      enInventario,
      falta,
      estado,
      observacion: input.observacion ?? existing?.observacion ?? "",
      inventarioOrigen,
      stockLotId,
      archived: input.archived ?? existing?.archived ?? false,
      createdBy: existing?.createdBy ?? actor.email,
      updatedBy: actor.email,
      createdAt: existing?.createdAt ?? now,
      updatedAt: now,
    };
    this.repo.upsertMpControl(row);
    return row;
  }

  deleteMpControl(actor: InventoryActor, id: string) {
    this.guard(actor, "mp_control", true);
    this.repo.deleteMpControl(id);
  }

  private enrichControl(row: MpControlRow): MpControlRow {
    let enInventario = row.enInventario;
    let inventarioOrigen = row.inventarioOrigen;
    if (row.stockLotId) {
      const lot = this.repo.getMpStock(row.stockLotId);
      if (lot) {
        enInventario = lot.cantidadKg;
        inventarioOrigen = "STOCK";
      }
    } else if (row.materiaPrima.trim()) {
      const match = this.repo.findMpStockByDescripcion(row.materiaPrima);
      if (match) {
        enInventario = match.cantidadKg;
        inventarioOrigen = "STOCK";
      }
    }
    const falta = calcFalta(row.cantNecesaria, enInventario);
    return {
      ...row,
      enInventario,
      inventarioOrigen,
      falta,
      estado: calcControlEstado(falta),
    };
  }

  // ─── MP Compras ────────────────────────────────────────────

  listMpCompras(actor: InventoryActor) {
    this.guard(actor, "mp_compras", false);
    return this.repo.listMpCompras();
  }

  upsertMpCompra(actor: InventoryActor, input: Partial<MpCompraRow> & { id?: string }) {
    this.guard(actor, "mp_compras", true);
    const existing = input.id ? this.repo.getMpCompra(input.id) : null;
    const now = nowIso();
    const row: MpCompraRow = {
      id: existing?.id ?? input.id ?? randomUUID(),
      fecha: input.fecha ?? existing?.fecha ?? todayIso(),
      materiaPrima: input.materiaPrima ?? existing?.materiaPrima ?? "",
      cantidad: parseOptionalNumber(input.cantidad ?? existing?.cantidad),
      unidad: input.unidad ?? existing?.unidad ?? "",
      proveedor: input.proveedor ?? existing?.proveedor ?? "",
      fechaEntrega: input.fechaEntrega ?? existing?.fechaEntrega ?? "",
      produccionesAfecta: input.produccionesAfecta ?? existing?.produccionesAfecta ?? "",
      estado: input.estado ?? existing?.estado ?? "",
      nota: input.nota ?? existing?.nota ?? "",
      linkedIngresoId: input.linkedIngresoId ?? existing?.linkedIngresoId ?? null,
      createdBy: existing?.createdBy ?? actor.email,
      updatedBy: actor.email,
      createdAt: existing?.createdAt ?? now,
      updatedAt: now,
    };
    this.repo.upsertMpCompra(row);
    this.audit(
      actor,
      "mp_compras",
      row.id,
      existing ? "update" : "create",
      existing as unknown as Record<string, unknown> | null,
      row as unknown as Record<string, unknown>
    );
    return {
      compra: row,
      offerCreateIngreso: row.estado === "En planta" && !row.linkedIngresoId,
      ingresoPrefill:
        row.estado === "En planta" && !row.linkedIngresoId
          ? {
              descripcion: row.materiaPrima,
              cantidad: row.cantidad,
              proveedor: row.proveedor,
              compraId: row.id,
            }
          : null,
    };
  }

  linkCompraToIngreso(actor: InventoryActor, compraId: string, ingresoId: string) {
    this.guard(actor, "mp_compras", true);
    const compra = this.repo.getMpCompra(compraId);
    if (!compra) throw new InventoryNotFoundError("Compra no encontrada.");
    if (compra.linkedIngresoId) {
      throw new InventoryValidationError("La compra ya tiene un ingreso vinculado.");
    }
    const updated: MpCompraRow = {
      ...compra,
      linkedIngresoId: ingresoId,
      updatedBy: actor.email,
      updatedAt: nowIso(),
    };
    this.repo.upsertMpCompra(updated);
    return updated;
  }

  deleteMpCompra(actor: InventoryActor, id: string) {
    this.guard(actor, "mp_compras", true);
    this.repo.deleteMpCompra(id);
  }

  /**
   * Semanas operativas: DEPOSITO puede leer; cualquier intento de escritura se rechaza.
   * PRODUCCION escribe vía planning API, no por este módulo.
   */
  assertCanMutateSemanas(actor: InventoryActor): never {
    this.guard(actor, "semanas_ro", false);
    throw new InventoryForbiddenError(
      "Semanas operativas en solo lectura para este acceso (sin crear/editar/eliminar)."
    );
  }

  canMutateSemanas(): boolean {
    return false;
  }

  getAudit() {
    return this.repo.listAudit();
  }
}

export function createInventoryService(repo: MemoryInventoryRepo) {
  return new InventoryService(repo);
}
