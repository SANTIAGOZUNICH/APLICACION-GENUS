/** RBAC — Cajas Genus. Depósito registra ingresos; Administración y Dirección consultan reportes, ajustan y administran. */
import type { SectorId } from "@/types/operational/sector";

const ADMIN_SECTORS = new Set<SectorId>(["ADMINISTRACION", "DIRECCION"]);

export const canRegisterIngreso = (s: SectorId | null | undefined) => s === "DEPOSITO";
export const canViewIngresos = (s: SectorId | null | undefined) => s === "DEPOSITO" || Boolean(s && ADMIN_SECTORS.has(s));
export const canViewCajasReports = (s: SectorId | null | undefined) => Boolean(s && ADMIN_SECTORS.has(s));
export const canAdministerCajas = canViewCajasReports;
