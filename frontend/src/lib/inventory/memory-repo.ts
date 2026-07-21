/**
 * Repositorio en memoria para inventario ME/MP (tests y demo sin Neon).
 */

import type {
  InventoryAudit,
  MeAlert,
  MeAlertRead,
  MeIngresoRow,
  MeMaterial,
  MeSalidaRow,
  MpCompraRow,
  MpControlRow,
  MpIngresoRow,
  MpStockRow,
} from "./types";

function clone<T>(v: T): T {
  return structuredClone(v);
}

export type StockAjuste = {
  id: string;
  module: "ME" | "MP";
  entityId: string;
  cantidadAnterior: number;
  cantidadNueva: number;
  diferencia: number;
  motivo: string;
  actor: string;
  actorSector: string;
  createdAt: string;
};

export class MemoryInventoryRepo {
  meIngresos: MeIngresoRow[] = [];
  meSalidas: MeSalidaRow[] = [];
  meMaterials: MeMaterial[] = [];
  meAlerts: MeAlert[] = [];
  meAlertReads: MeAlertRead[] = [];
  mpStock: MpStockRow[] = [];
  mpIngresos: MpIngresoRow[] = [];
  mpControl: MpControlRow[] = [];
  mpCompras: MpCompraRow[] = [];
  ajustes: StockAjuste[] = [];
  audit: InventoryAudit[] = [];

  reset() {
    this.meIngresos = [];
    this.meSalidas = [];
    this.meMaterials = [];
    this.meAlerts = [];
    this.meAlertReads = [];
    this.mpStock = [];
    this.mpIngresos = [];
    this.mpControl = [];
    this.mpCompras = [];
    this.ajustes = [];
    this.audit = [];
  }

  listMeIngresos() {
    return clone(this.meIngresos);
  }
  listMeSalidas() {
    return clone(this.meSalidas);
  }
  listMeMaterials() {
    return clone(this.meMaterials);
  }
  listMeAlerts() {
    return clone(this.meAlerts);
  }
  listMpStock() {
    return clone(this.mpStock);
  }
  listMpIngresos() {
    return clone(this.mpIngresos);
  }
  listMpControl() {
    return clone(this.mpControl);
  }
  listMpCompras() {
    return clone(this.mpCompras);
  }
  listAjustes() {
    return clone(this.ajustes);
  }
  listAudit() {
    return clone(this.audit);
  }

  upsertMeIngreso(row: MeIngresoRow) {
    const i = this.meIngresos.findIndex((r) => r.id === row.id);
    if (i >= 0) this.meIngresos[i] = clone(row);
    else this.meIngresos.push(clone(row));
  }
  deleteMeIngreso(id: string) {
    this.meIngresos = this.meIngresos.filter((r) => r.id !== id);
  }
  getMeIngreso(id: string) {
    return this.meIngresos.find((r) => r.id === id) ?? null;
  }

  upsertMeSalida(row: MeSalidaRow) {
    const i = this.meSalidas.findIndex((r) => r.id === row.id);
    if (i >= 0) this.meSalidas[i] = clone(row);
    else this.meSalidas.push(clone(row));
  }
  deleteMeSalida(id: string) {
    this.meSalidas = this.meSalidas.filter((r) => r.id !== id);
  }
  getMeSalida(id: string) {
    return this.meSalidas.find((r) => r.id === id) ?? null;
  }

  upsertMeMaterial(row: MeMaterial) {
    const i = this.meMaterials.findIndex((r) => r.id === row.id);
    if (i >= 0) this.meMaterials[i] = clone(row);
    else this.meMaterials.push(clone(row));
  }
  getMeMaterial(id: string) {
    return this.meMaterials.find((r) => r.id === id) ?? null;
  }
  findMeMaterialByCodigo(codigo: string) {
    const c = codigo.trim().toLowerCase();
    if (!c) return null;
    return this.meMaterials.find((m) => m.codigo.trim().toLowerCase() === c) ?? null;
  }

  upsertMeAlert(row: MeAlert) {
    const i = this.meAlerts.findIndex((r) => r.id === row.id);
    if (i >= 0) this.meAlerts[i] = clone(row);
    else this.meAlerts.push(clone(row));
  }
  findOpenAlert(materialId: string) {
    return (
      this.meAlerts.find(
        (a) =>
          a.materialId === materialId &&
          a.status !== "RESUELTO" &&
          a.status !== "STOCK_RECUPERADO" &&
          a.status !== "ARCHIVADO"
      ) ?? null
    );
  }

  upsertAlertRead(row: MeAlertRead) {
    const i = this.meAlertReads.findIndex(
      (r) => r.alertId === row.alertId && r.actorEmail === row.actorEmail
    );
    if (i >= 0) this.meAlertReads[i] = clone(row);
    else this.meAlertReads.push(clone(row));
  }
  getAlertRead(alertId: string, actorEmail: string) {
    return (
      this.meAlertReads.find((r) => r.alertId === alertId && r.actorEmail === actorEmail) ?? null
    );
  }

  upsertMpStock(row: MpStockRow) {
    const i = this.mpStock.findIndex((r) => r.id === row.id);
    if (i >= 0) this.mpStock[i] = clone(row);
    else this.mpStock.push(clone(row));
  }
  deleteMpStock(id: string) {
    this.mpStock = this.mpStock.filter((r) => r.id !== id);
  }
  getMpStock(id: string) {
    return this.mpStock.find((r) => r.id === id) ?? null;
  }
  findMpStockByDescLote(descripcion: string, lote: string) {
    const d = descripcion.trim().toLowerCase();
    const l = lote.trim().toLowerCase();
    return (
      this.mpStock.find(
        (r) => r.descripcion.trim().toLowerCase() === d && r.lote.trim().toLowerCase() === l
      ) ?? null
    );
  }
  findMpStockByDescripcion(descripcion: string) {
    const d = descripcion.trim().toLowerCase();
    if (!d) return null;
    const matches = this.mpStock.filter((r) => r.descripcion.trim().toLowerCase() === d);
    if (matches.length === 1) return matches[0];
    return null;
  }

  upsertMpIngreso(row: MpIngresoRow) {
    const i = this.mpIngresos.findIndex((r) => r.id === row.id);
    if (i >= 0) this.mpIngresos[i] = clone(row);
    else this.mpIngresos.push(clone(row));
  }
  deleteMpIngreso(id: string) {
    this.mpIngresos = this.mpIngresos.filter((r) => r.id !== id);
  }
  getMpIngreso(id: string) {
    return this.mpIngresos.find((r) => r.id === id) ?? null;
  }

  upsertMpControl(row: MpControlRow) {
    const i = this.mpControl.findIndex((r) => r.id === row.id);
    if (i >= 0) this.mpControl[i] = clone(row);
    else this.mpControl.push(clone(row));
  }
  deleteMpControl(id: string) {
    this.mpControl = this.mpControl.filter((r) => r.id !== id);
  }

  upsertMpCompra(row: MpCompraRow) {
    const i = this.mpCompras.findIndex((r) => r.id === row.id);
    if (i >= 0) this.mpCompras[i] = clone(row);
    else this.mpCompras.push(clone(row));
  }
  deleteMpCompra(id: string) {
    this.mpCompras = this.mpCompras.filter((r) => r.id !== id);
  }
  getMpCompra(id: string) {
    return this.mpCompras.find((r) => r.id === id) ?? null;
  }

  addAjuste(row: StockAjuste) {
    this.ajustes.push(clone(row));
  }
  addAudit(row: InventoryAudit) {
    this.audit.push(clone(row));
  }
}

export const memoryInventoryRepo = new MemoryInventoryRepo();
