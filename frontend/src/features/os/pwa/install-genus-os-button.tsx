"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import { Check, Download, Share, X } from "lucide-react";
import {
  INSTALL_LABEL,
  INSTALLED_LABEL,
  detectInstallPlatform,
  type InstallPlatformKind,
} from "./install-platform";

type BeforeInstallPromptEvent = Event & {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
};

interface InstallGenusOsButtonProps {
  variant?: "menu" | "login" | "inline";
  className?: string;
  onInteract?: () => void;
}

/**
 * Botón siempre visible: “Instalar Genus OS” / “Genus OS instalada”.
 * No se oculta si falta beforeinstallprompt — solo cambia el comportamiento.
 */
export function InstallGenusOsButton({
  variant = "menu",
  className = "",
  onInteract,
}: InstallGenusOsButtonProps) {
  const [platform, setPlatform] = useState<InstallPlatformKind>("other");
  const [deferred, setDeferred] = useState<BeforeInstallPromptEvent | null>(null);
  const [installedEvent, setInstalledEvent] = useState(false);
  const [open, setOpen] = useState(false);
  const [copied, setCopied] = useState(false);
  const [guideHint, setGuideHint] = useState<string | null>(null);

  useEffect(() => {
    if (typeof window === "undefined") return;

    const refreshPlatform = () => {
      setPlatform(detectInstallPlatform(window, navigator));
    };
    refreshPlatform();

    const onBip = (event: Event) => {
      event.preventDefault();
      setDeferred(event as BeforeInstallPromptEvent);
    };
    const onInstalled = () => {
      setDeferred(null);
      setInstalledEvent(true);
      setOpen(false);
      refreshPlatform();
    };
    const onDisplayChange = () => refreshPlatform();

    window.addEventListener("beforeinstallprompt", onBip);
    window.addEventListener("appinstalled", onInstalled);
    const mq = window.matchMedia("(display-mode: standalone)");
    mq.addEventListener?.("change", onDisplayChange);

    return () => {
      window.removeEventListener("beforeinstallprompt", onBip);
      window.removeEventListener("appinstalled", onInstalled);
      mq.removeEventListener?.("change", onDisplayChange);
    };
  }, []);

  const isInstalled = platform === "standalone" || installedEvent;
  const label = isInstalled ? INSTALLED_LABEL : INSTALL_LABEL;

  const runNativePrompt = useCallback(async () => {
    if (!deferred) return;
    await deferred.prompt();
    const choice = await deferred.userChoice;
    setDeferred(null);
    if (choice.outcome === "accepted") {
      setInstalledEvent(true);
    }
    setOpen(false);
    onInteract?.();
  }, [deferred, onInteract]);

  const copyLink = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(`${window.location.origin}/login`);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000);
    } catch {
      setCopied(false);
    }
  }, []);

  const recheckInstallability = useCallback(() => {
    setPlatform(detectInstallPlatform(window, navigator));
    if (deferred) {
      setGuideHint("Listo: este navegador ya puede mostrar el instalador nativo.");
    } else if (detectInstallPlatform(window, navigator) === "standalone") {
      setGuideHint("Genus OS ya está instalada en este dispositivo.");
    } else {
      setGuideHint(
        "Todavía no hay instalador nativo. Seguí la guía o probá Chrome/Edge con la Preview abierta unos segundos.",
      );
    }
  }, [deferred]);

  const buttonClass = useMemo(() => {
    if (variant === "login") {
      return `inline-flex min-h-11 w-full items-center justify-center gap-2 rounded-[var(--os-radius-sm)] border border-[var(--os-border)] bg-[var(--os-surface)] px-4 text-sm font-medium text-[var(--os-text)] ${className}`;
    }
    if (variant === "inline") {
      return `inline-flex min-h-11 items-center gap-2 rounded-[var(--os-radius-sm)] px-3 text-sm text-[var(--os-text)] hover:bg-[var(--os-bg)] ${className}`;
    }
    return `flex min-h-11 w-full items-center gap-2 px-3 py-2.5 text-left text-sm text-[var(--os-text)] transition-colors hover:bg-[var(--os-bg)] ${className}`;
  }, [variant, className]);

  const closeModal = useCallback(() => {
    setOpen(false);
    onInteract?.();
  }, [onInteract]);

  const openModal = () => {
    if (isInstalled) return;
    setGuideHint(null);
    setOpen(true);
    // No cerrar el menú padre aquí: si se desmonta el botón, el modal desaparece.
  };

  const modal =
    open && !isInstalled && typeof document !== "undefined"
      ? createPortal(
          <InstallGuideModal
            platform={platform}
            hasNativePrompt={Boolean(deferred)}
            copied={copied}
            guideHint={guideHint}
            onClose={closeModal}
            onNativeInstall={() => void runNativePrompt()}
            onCopyLink={() => void copyLink()}
            onRecheck={recheckInstallability}
          />,
          document.body,
        )
      : null;

  return (
    <>
      <button
        type="button"
        role={variant === "menu" ? "menuitem" : undefined}
        className={buttonClass}
        aria-label={label}
        disabled={isInstalled}
        onClick={openModal}
      >
        {isInstalled ? (
          <Check className="size-3.5 text-[var(--os-teal)]" aria-hidden="true" />
        ) : (
          <Download className="size-3.5 text-[var(--os-text-muted)]" aria-hidden="true" />
        )}
        {label}
      </button>
      {modal}
    </>
  );
}

function InstallGuideModal({
  platform,
  hasNativePrompt,
  copied,
  guideHint,
  onClose,
  onNativeInstall,
  onCopyLink,
  onRecheck,
}: {
  platform: InstallPlatformKind;
  hasNativePrompt: boolean;
  copied: boolean;
  guideHint: string | null;
  onClose: () => void;
  onNativeInstall: () => void;
  onCopyLink: () => void;
  onRecheck: () => void;
}) {
  return (
      <div
        className="fixed inset-0 z-[var(--os-z-modal,70)] flex items-end justify-center bg-[var(--os-navy)]/55 p-3 sm:items-center"
        role="dialog"
        aria-modal="true"
        aria-labelledby="install-genus-os-title"
        data-genus-install-modal="true"
      >
      <div className="max-h-[90dvh] w-full max-w-md overflow-y-auto rounded-[var(--os-radius)] border border-[var(--os-border)] bg-[#0b2130] p-4 shadow-[var(--os-shadow-card-hover)]">
        <div className="flex items-start justify-between gap-3">
          <div className="flex items-center gap-3">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src="/icons/icon-192.png"
              alt=""
              width={48}
              height={48}
              className="rounded-xl"
            />
            <div>
              <h2 id="install-genus-os-title" className="text-base font-semibold text-[var(--os-text)]">
                Instalar Genus OS
              </h2>
              <p className="text-xs text-[var(--os-text-muted)]">Acceso rápido como aplicación</p>
            </div>
          </div>
          <button
            type="button"
            aria-label="Cerrar"
            className="flex size-11 shrink-0 items-center justify-center rounded-[var(--os-radius-sm)] hover:bg-[var(--os-bg)]"
            onClick={onClose}
          >
            <X className="size-4" />
          </button>
        </div>

        <div className="mt-4 space-y-3">
          {platform === "ios-safari" && (
            <ol className="space-y-2 text-left text-sm text-[var(--os-text)]">
              <li className="flex items-center gap-1.5">
                1. Tocá Compartir <Share className="inline size-3.5" aria-hidden="true" />.
              </li>
              <li>2. Elegí “Agregar a pantalla de inicio”.</li>
              <li>3. Activá “Abrir como app”.</li>
              <li>4. Tocá Agregar.</li>
            </ol>
          )}

          {platform === "ios-other" && (
            <div className="space-y-3 text-sm text-[var(--os-text)]">
              <p>Para instalar Genus OS, abrilo en Safari.</p>
              <ol className="list-decimal space-y-1 pl-4 text-[var(--os-text-muted)]">
                <li>Copiá el enlace.</li>
                <li>Abrí Safari.</li>
                <li>Pegá el enlace y seguí “Agregar a pantalla de inicio”.</li>
              </ol>
              <button
                type="button"
                onClick={onCopyLink}
                className="min-h-11 w-full rounded-[var(--os-radius-sm)] bg-[var(--os-teal)] text-sm font-medium text-[var(--os-navy)]"
              >
                {copied ? "Enlace copiado" : "Copiar enlace"}
              </button>
            </div>
          )}

          {platform === "mac-safari" && (
            <div className="space-y-3 text-sm text-[var(--os-text)]">
              <p>En Safari de Mac:</p>
              <ol className="list-decimal space-y-1 pl-4">
                <li>Menú Archivo → Agregar al Dock.</li>
                <li>Confirmá para abrir Genus OS como app.</li>
              </ol>
            </div>
          )}

          {(platform === "chromium" || platform === "other") && (
            <div className="space-y-3 text-sm text-[var(--os-text)]">
              {hasNativePrompt ? (
                <>
                  <p className="text-[var(--os-text-muted)]">
                    Instalá Genus OS en este equipo para abrirlo en ventana propia, con la misma sesión
                    empresarial.
                  </p>
                  <button
                    type="button"
                    onClick={onNativeInstall}
                    className="min-h-11 w-full rounded-[var(--os-radius-sm)] bg-[var(--os-teal)] text-sm font-medium text-[var(--os-navy)]"
                  >
                    Instalar ahora
                  </button>
                </>
              ) : (
                <>
                  <p className="text-[var(--os-text-muted)]">
                    El instalador nativo todavía no está disponible en este navegador. Podés seguir esta
                    guía:
                  </p>
                  <ol className="list-decimal space-y-1 pl-4">
                    <li>Usá Chrome o Edge actualizado.</li>
                    <li>Abrí Genus OS desde la barra de direcciones (no en modo invitado).</li>
                    <li>
                      Menú ⋮ → “Instalar Genus OS” / “Aplicaciones” → “Instalar esta página como app”.
                    </li>
                  </ol>
                  <button
                    type="button"
                    onClick={onRecheck}
                    className="min-h-11 w-full rounded-[var(--os-radius-sm)] bg-[var(--os-teal)] text-sm font-medium text-[var(--os-navy)]"
                  >
                    Revisar nuevamente
                  </button>
                </>
              )}
            </div>
          )}

          {guideHint && (
            <p className="rounded-[var(--os-radius-sm)] bg-[var(--os-bg)] px-3 py-2 text-xs text-[var(--os-text-muted)]">
              {guideHint}
            </p>
          )}

          <button
            type="button"
            onClick={onClose}
            className="min-h-11 w-full rounded-[var(--os-radius-sm)] border border-[var(--os-border)] text-sm text-[var(--os-text)]"
          >
            Cancelar
          </button>
        </div>
      </div>
    </div>
  );
}

export function StandaloneBuildBadge() {
  const [standalone, setStandalone] = useState(false);
  useEffect(() => {
    setStandalone(detectInstallPlatform(window, navigator) === "standalone");
  }, []);
  if (!standalone) return null;
  const sha = (process.env.NEXT_PUBLIC_VERCEL_GIT_COMMIT_SHA || "dev").slice(0, 7);
  return (
    <span className="text-[10px] text-[var(--os-text-muted)]" title="Build instalado">
      PWA · {sha}
    </span>
  );
}
