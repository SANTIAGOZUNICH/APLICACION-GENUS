/**
 * Permiso ÚNICO de administración del Portal de Clientes (usuarios/credenciales/reset, clientes habilitados, piloto, envío real por cliente,
 * notificación de prueba, historial/diagnóstico, salud, configuración del envío general, portal de prueba, vínculos).
 *
 * Roles (ids reales de sector en GENUS OS): ADMINISTRACION («Administración / Facturación»), PRODUCCION y DIRECCION.
 * Cualquier otro sector (Depósito, Envasado, Codificado, Elaboración, Calidad, Materia Prima, Comercial…) queda rechazado (403).
 *
 * Módulo sin dependencias de servidor: lo usan el backend (servicios y rutas) Y el frontend (menús y paneles).
 */
export const PORTAL_MANAGER_SECTORS = ["ADMINISTRACION", "PRODUCCION", "DIRECCION"] as const;

export function canManagePortal(sector: string | null | undefined): boolean {
  const s = String(sector ?? "").trim().toUpperCase();
  return (PORTAL_MANAGER_SECTORS as readonly string[]).includes(s);
}

export const PORTAL_FORBIDDEN_MESSAGE = "Solo Administración, Producción y Dirección administran el Portal de Clientes.";
