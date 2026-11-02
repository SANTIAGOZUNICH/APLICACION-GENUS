/**
 * Disparador del recálculo del Control de ME. Se llama (sin esperar) desde los puntos donde cambia lo que el control mira:
 * trabajos de Envasado (alta / cambio de cantidad, fecha o semana / baja), movimientos de ME (ingresos, salidas, ajustes) y
 * la configuración de materiales. Agrupa ráfagas (debounce) y nunca rompe ni demora a quien lo llama.
 *
 * Es un ACELERADOR: la red de seguridad es `syncMeControlIfStale()`, que corre en cada consulta de alertas y de la pantalla,
 * así que un cambio que no pasó por acá igual se detecta en la siguiente actualización automática de Depósito.
 */
const DEBOUNCE_MS = 1500;
const g = globalThis as unknown as { __genusMeTrigger?: ReturnType<typeof setTimeout> | null };

export function triggerMeControlSync(): void {
  try {
    if (process.env.GENUS_ME_CONTROL_AUTOSYNC === "0") return;
    if (g.__genusMeTrigger) return;
    const t = setTimeout(() => {
      g.__genusMeTrigger = null;
      void import("./service")
        .then((m) => m.syncMeControl({ ai: false }))
        .catch(() => undefined);
    }, DEBOUNCE_MS);
    (t as unknown as { unref?: () => void }).unref?.();
    g.__genusMeTrigger = t;
  } catch {
    /* nunca romper al llamador */
  }
}
