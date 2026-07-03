/** Pasos de inicialización premium — simulación UI Access Preview. */

export interface SessionBootstrapStep {
  id: string;
  label: string;
  durationMs: number;
}

export const SESSION_BOOTSTRAP_STEPS: SessionBootstrapStep[] = [
  { id: "init", label: "Inicializando Genus OS…", durationMs: 720 },
  { id: "env", label: "Verificando entorno…", durationMs: 680 },
  { id: "workspaces", label: "Cargando Workspaces…", durationMs: 760 },
  { id: "config", label: "Sincronizando configuración…", durationMs: 700 },
  { id: "engine", label: "Preparando Manufacturing Engine…", durationMs: 780 },
  { id: "services", label: "Conectando servicios…", durationMs: 720 },
  { id: "ready", label: "Sistema listo.", durationMs: 640 },
];

export const SESSION_BOOTSTRAP_TOTAL_MS = SESSION_BOOTSTRAP_STEPS.reduce(
  (total, step) => total + step.durationMs,
  0
);
