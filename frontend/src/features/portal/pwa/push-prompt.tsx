"use client";

import { useEffect, useState } from "react";
import { InstallInstructions } from "./app-panel";
import { PROMPT_TEXT, PROMPT_TITLE, dismissKey, shouldOfferPrompt } from "./push-state";
import type { PushController } from "./use-push-state";

const read = (k: string): boolean => { try { return window.localStorage.getItem(k) != null; } catch { return false; } };
const write = (k: string) => { try { window.localStorage.setItem(k, new Date().toISOString()); } catch { /* sin almacenamiento: se vuelve a ofrecer */ } };

/**
 * Aviso de activación de notificaciones, visible al primer ingreso. «Ahora no» se recuerda en este dispositivo (no vuelve a aparecer
 * solo; se puede activar desde «Portal en tu celular»). El permiso nativo se pide ÚNICAMENTE al tocar «Activar notificaciones».
 * Usa role="alertdialog" para no confundirse con los diálogos de edición que pausan la sincronización.
 */
export function PushPrompt({ push, scope }: { push: PushController; scope: string }) {
  const [open, setOpen] = useState(false);
  const [dismissed, setDismissed] = useState<boolean | null>(null);
  const key = dismissKey(scope);
  useEffect(() => {
    // Lectura de almacenamiento del navegador tras el montaje.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setDismissed(read(key));
  }, [key]);
  const offer = dismissed === false && shouldOfferPrompt(push.state, false);
  useEffect(() => {
    // Se abre cuando corresponde ofrecerlo; se cierra solo si el estado deja de requerirlo (p. ej. quedó activado).
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (offer) setOpen(true);
    else if (push.state === "activadas" || push.state === "bloqueado") setOpen(false);
  }, [offer, push.state]);

  if (!open || !push.platform) return null;
  const install = push.state === "instalacion";
  function later() {
    write(key);
    setDismissed(true);
    setOpen(false);
  }
  async function activate() {
    const ok = await push.enable();
    if (ok) setOpen(false);
  }
  return (
    <div className="gp-overlay" data-testid="push-prompt-overlay">
      <div className="gp-dialog" role="alertdialog" aria-modal="true" aria-labelledby="gp-push-title" aria-describedby="gp-push-text" data-testid="push-prompt">
        <h2 id="gp-push-title">{PROMPT_TITLE}</h2>
        <p id="gp-push-text" style={{ marginTop: 0 }}>{PROMPT_TEXT}</p>
        {install ? (
          <>
            <p className="gp-note" data-testid="push-prompt-install-note">Para recibir notificaciones en tu iPhone primero tenés que instalar el portal como app:</p>
            <InstallInstructions platform={push.platform} />
          </>
        ) : null}
        {push.message && !install ? <p className="gp-note" role="status" data-testid="push-prompt-error">{push.message}</p> : null}
        <div className="gp-dialog-actions">
          {install ? null : (
            <button type="button" className="gp-btn gp-btn-primary" disabled={push.busy} onClick={() => void activate()} data-testid="push-prompt-activate">Activar notificaciones</button>
          )}
          <button type="button" className="gp-btn gp-btn-ghost" onClick={later} data-testid="push-prompt-later">{install ? "Entendido" : "Ahora no"}</button>
        </div>
      </div>
    </div>
  );
}
