/** Estado compartido mínimo (evento de instalación diferido) entre el runtime y el panel «Instalar app». */
export type BeforeInstallPromptEvent = Event & { prompt: () => Promise<void>; userChoice: Promise<{ outcome: "accepted" | "dismissed" }> };

let installEvent: BeforeInstallPromptEvent | null = null;
const listeners = new Set<() => void>();

export const portalPwaStore = {
  getInstallEvent: () => installEvent,
  setInstallEvent(e: BeforeInstallPromptEvent | null) {
    installEvent = e;
    listeners.forEach((l) => l());
  },
  subscribe(l: () => void) {
    listeners.add(l);
    return () => void listeners.delete(l);
  },
};
