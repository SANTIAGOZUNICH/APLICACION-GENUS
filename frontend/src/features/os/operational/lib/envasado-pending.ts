import { isWorkTransferredStatus } from "./work-transfer-labels";

/**
 * "Pendiente" para Envasado Masivo/Premium — trabajo asignado, en curso,
 * bloqueado o devuelto por Rehacer (vuelve a "pendiente"/"en_curso").
 * Reutiliza isWorkTransferredStatus (cubre "revision"/"completo"/
 * "en_codificado"/"codificado_completo" — enviado fuera de Envasado) y
 * excluye además los dos estados terminales que ese helper no cubre:
 * "entregado" y "cancelado". No filtra por sector ni soft-delete — ambos
 * ya los resuelve el hook de datos (useOperationalPlan scopea por sector;
 * la API nunca devuelve filas borradas).
 */
export function isEnvasadoWorkPending(item: { status: string }): boolean {
  if (isWorkTransferredStatus(item.status)) return false;
  if (item.status === "entregado" || item.status === "cancelado") return false;
  return true;
}
