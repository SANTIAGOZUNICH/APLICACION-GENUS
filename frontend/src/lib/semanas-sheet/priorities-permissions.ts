/** Permiso de prioridades (compartido cliente/servidor): solo Producción las cambia; el resto las ve. */
export function canEditPriorities(sector: string | null | undefined): boolean {
  return sector === "PRODUCCION";
}
