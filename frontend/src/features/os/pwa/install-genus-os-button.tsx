"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Download, Share, X } from "lucide-react";

type BeforeInstallPromptEvent = Event & {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
};

function isStandalone(): boolean {
  if (typeof window === "undefined") return false;
  const mq = window.matchMedia("(display-mode: standalone)").matches;
  const ios = "standalone" in navigator && Boolean((navigator as Navigator & { standalone?: boolean }).standalone);
  return mq || ios;
}

function isIos(): boolean {
  if (typeof navigator === "undefined") return false;
  return /iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
}

function isSafari(): boolean {
  if (typeof navigator === "undefined") return false;
  const ua = navigator.userAgent;
  return /Safari/i.test(ua) && !/CriOS|FxiOS|EdgiOS|Chrome|Android/i.test(ua);
}

type Mode = "hidden" | "installable" | "ios-help" | "ios-safari-needed" | "dialog";

interface InstallGenusOsButtonProps {
  variant?: "menu" | "login" | "inline";
  className?: string;
  onInteract?: () => void;
}

/** Opción discreta “Instalar Genus OS” — Chrome/Edge prompt o guía iPhone. */
export function InstallGenusOsButton({
  variant = "menu",
  className = "",
  onInteract,
}: InstallGenusOsButtonProps) {
  const [mode, setMode] = useState<Mode>("hidden");
  const [deferred, setDeferred] = useState<BeforeInstallPromptEvent | null>(null);
  const [open, setOpen] = useState(false);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (typeof window === "undefined") return;
    if (isStandalone()) {
      setMode("hidden");
      return;
    }

    const onBip = (event: Event) => {
      event.preventDefault();
      setDeferred(event as BeforeInstallPromptEvent);
      setMode("installable");
    };
    const onInstalled = () => {
      setDeferred(null);
      setMode("hidden");
      setOpen(false);
    };

    window.addEventListener("beforeinstallprompt", onBip);
    window.addEventListener("appinstalled", onInstalled);

    if (isIos()) {
      setMode(isSafari() ? "ios-help" : "ios-safari-needed");
    } else if (!deferred) {
      // Desktop Safari / others without BIP: keep hidden unless BIP fires.
      setMode((prev) => (prev === "installable" ? prev : "hidden"));
    }

    return () => {
      window.removeEventListener("beforeinstallprompt", onBip);
      window.removeEventListener("appinstalled", onInstalled);
    };
  }, [deferred]);

  const label = "Instalar Genus OS";

  const runNativePrompt = useCallback(async () => {
    if (!deferred) return;
    await deferred.prompt();
    const choice = await deferred.userChoice;
    setDeferred(null);
    if (choice.outcome === "accepted") setMode("hidden");
    setOpen(false);
    onInteract?.();
  }, [deferred, onInteract]);

  const copyLink = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(window.location.origin + "/login");
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000);
    } catch {
      setCopied(false);
    }
  }, []);

  const buttonClass = useMemo(() => {
    if (variant === "login") {
      return `inline-flex min-h-11 w-full items-center justify-center gap-2 rounded-[var(--os-radius-sm)] border border-[var(--os-border)] bg-[var(--os-surface)] px-4 text-sm text-[var(--os-text)] ${className}`;
    }
    if (variant === "inline") {
      return `inline-flex min-h-11 items-center gap-2 rounded-[var(--os-radius-sm)] px-3 text-sm text-[var(--os-text)] hover:bg-[var(--os-bg)] ${className}`;
    }
    return `flex w-full items-center gap-2 px-3 py-2.5 text-left text-sm text-[var(--os-text)] transition-colors hover:bg-[var(--os-bg)] ${className}`;
  }, [variant, className]);

  if (mode === "hidden") return null;

  return (
    <>
      <button
        type="button"
        className={buttonClass}
        onClick={() => {
          setOpen(true);
          onInteract?.();
        }}
      >
        <Download className="size-3.5 text-[var(--os-text-muted)]" aria-hidden="true" />
        {label}
      </button>

      {open && (
        <div className="fixed inset-0 z-[var(--os-z-modal,70)] flex items-end justify-center bg-[var(--os-navy)]/50 p-3 sm:items-center" role="dialog" aria-modal="true" aria-label={label}>
          <div className="w-full max-w-md rounded-[var(--os-radius)] border border-[var(--os-border)] bg-[var(--os-surface)] p-4 shadow-[var(--os-shadow-card-hover)]">
            <div className="flex items-start justify-between gap-3">
              <div className="flex items-center gap-3">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src="/icons/icon-192.png" alt="" width={48} height={48} className="rounded-xl" />
                <div>
                  <h2 className="text-base font-semibold text-[var(--os-text)]">Genus OS</h2>
                  <p className="text-xs text-[var(--os-text-muted)]">Acceso rápido como aplicación</p>
                </div>
              </div>
              <button type="button" aria-label="Cerrar" className="flex size-11 items-center justify-center rounded-[var(--os-radius-sm)] hover:bg-[var(--os-bg)]" onClick={() => setOpen(false)}>
                <X className="size-4" />
              </button>
            </div>

            {mode === "installable" && (
              <div className="mt-4 space-y-3">
                <p className="text-sm text-[var(--os-text-muted)]">
                  Instalá Genus OS en este equipo para abrirlo en ventana propia, con la misma sesión empresarial.
                </p>
                <button type="button" onClick={() => void runNativePrompt()} className="min-h-11 w-full rounded-[var(--os-radius-sm)] bg-[var(--os-teal)] text-sm font-medium text-[var(--os-navy)]">
                  Instalar
                </button>
                <button type="button" onClick={() => setOpen(false)} className="min-h-11 w-full rounded-[var(--os-radius-sm)] border border-[var(--os-border)] text-sm text-[var(--os-text)]">
                  Cancelar
                </button>
              </div>
            )}

            {mode === "ios-help" && (
              <ol className="mt-4 space-y-2 text-left text-sm text-[var(--os-text)]">
                <li>1. Abrí Genus OS en Safari.</li>
                <li className="flex items-center gap-1.5">2. Tocá Compartir <Share className="inline size-3.5" aria-hidden="true" />.</li>
                <li>3. Elegí “Agregar a pantalla de inicio”.</li>
                <li>4. Activá “Abrir como app”.</li>
                <li>5. Tocá Agregar.</li>
              </ol>
            )}

            {mode === "ios-safari-needed" && (
              <div className="mt-4 space-y-3 text-sm text-[var(--os-text)]">
                <p>En iPhone/iPad la instalación se hace desde Safari (no desde este navegador).</p>
                <button type="button" onClick={() => void copyLink()} className="min-h-11 w-full rounded-[var(--os-radius-sm)] bg-[var(--os-teal)] text-sm font-medium text-[var(--os-navy)]">
                  {copied ? "Enlace copiado" : "Copiar enlace"}
                </button>
              </div>
            )}
          </div>
        </div>
      )}
    </>
  );
}

export function StandaloneBuildBadge() {
  const [standalone, setStandalone] = useState(false);
  useEffect(() => setStandalone(isStandalone()), []);
  if (!standalone) return null;
  const sha = (process.env.NEXT_PUBLIC_VERCEL_GIT_COMMIT_SHA || "dev").slice(0, 7);
  return (
    <span className="text-[10px] text-[var(--os-text-muted)]" title="Build instalado">
      PWA · {sha}
    </span>
  );
}
