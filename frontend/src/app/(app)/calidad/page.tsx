import { redirect } from "next/navigation";

/**
 * Calidad salió del circuito operativo: ya no hay bandeja de aprobaciones. La ruta se conserva solo para no romper
 * enlaces viejos y lleva a la app principal (las cuentas de Calidad entran en modo consulta/historial).
 */
export default function CalidadPage() {
  redirect("/mi-trabajo");
}
