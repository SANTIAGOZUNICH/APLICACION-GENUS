"use client";

import { SharedWeeklyPlanViewForDeposito } from "@/features/os/operational/views/shared-weekly-plan-view";

/**
 * Ruta histórica `semanas-produccion` de Depósito.
 * Renombrada en UI a «Plan semanal»; conserva el id de navegación.
 */
export function SemanasProduccionView() {
  return <SharedWeeklyPlanViewForDeposito />;
}
