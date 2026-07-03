/** Pasos visuales del bootstrap de sesión — simulación UI (PR 4.5 wiring real). */

export interface SessionBootstrapStep {
  id: string;
  label: string;
  durationMs: number;
}

export const SESSION_BOOTSTRAP_STEPS: SessionBootstrapStep[] = [
  { id: "verify", label: "Verificando usuario…", durationMs: 900 },
  { id: "context", label: "Resolviendo contexto…", durationMs: 850 },
  { id: "sector", label: "Identificando sector…", durationMs: 900 },
  { id: "workspace", label: "Preparando espacio de trabajo…", durationMs: 950 },
  { id: "enter", label: "Ingresando a Genus OS…", durationMs: 800 },
];

export const SESSION_BOOTSTRAP_TOTAL_MS = SESSION_BOOTSTRAP_STEPS.reduce(
  (total, step) => total + step.durationMs,
  0
);
