"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import { Check, Download, Share, X } from "lucide-react";
import { useDesignPreviewPortalContainer } from "@/lib/utils/use-design-preview-portal-container";
import {
  ensureDeferredInstallPromptCapture,
  hasDeferredInstallPrompt,
  promptNativeInstall,
  subscribeDeferredInstallPrompt,
  wasAppInstalledEventSeen,
} from "./deferred-install-prompt";
import {
  INSTALL_LABEL,
  INSTALLED_LABEL,
  detectInstallPlatform,
  statusMessageForInstall,
  type InstallPlatformKind,
  type InstallUiStatus,
} from "./install-platform";

interface InstallGenusOsButtonProps {
  variant?: "menu" | "login" | "inline";
  className?: string;
  onInteract?: () => void;
}

/**
 * Un clic en Chromium/Android con BIP → prompt() nativo inmediato (sin modal).
 * iOS/Mac Safari: guía corta en el mismo gesto (Apple no expone beforeinstallprompt).
 */
export function InstallGenusOsButton({
  variant = "menu",
  className = "",
  onInteract,
}: InstallGenusOsButtonProps) {
  const portalContainer = useDesignPreviewPortalContainer();
  const [platform, setPlatform] = useState<InstallPlatformKind>("other");
  const [hasNative, setHasNative] = useState(false);
  const [installedEvent, setInstalledEvent] = useState(false);
  const [guideOpen, setGuideOpen] = useState(false);
  const [copied, setCopied] = useState(false);
  const [status, setStatus] = useState<InstallUiStatus>("install");
  const [promptOnceGuard, setPromptOnceGuard] = useState(false);

  useEffect(() => {
    if (typeof window === "undefined") return;
    ensureDeferredInstallPromptCapture();

    const refresh = () => {
      const nextPlatform = detectInstallPlatform(window, navigator);
      setPlatform(nextPlatform);
      setHasNative(hasDeferredInstallPrompt());
      const seen = wasAppInstalledEventSeen() || nextPlatform === "standalone";
      setInstalledEvent(seen);
      if (seen) setStatus("installed");
      else if (hasDeferredInstallPrompt()) setStatus("install");
      else if (nextPlatform === "chromium" || nextPlatform === "other") setStatus("preparing");
      else setStatus("install");
    };

    refresh();
    const unsub = subscribeDeferredInstallPrompt(refresh);
    const mq = window.matchMedia("(display-mode: standalone)");
    mq.addEventListener?.("change", refresh);

    return () => {
      unsub();
      mq.removeEventListener?.("change", refresh);
    };
  }, []);

  const isInstalled = platform === "standalone" || installedEvent;
  const label = isInstalled ? INSTALLED_LABEL : INSTALL_LABEL;
  const statusText = isInstalled ? null : statusMessageForInstall(status);

  const closeGuide = useCallback(() => {
    setGuideOpen(false);
    onInteract?.();
  }, [onInteract]);

  const copyLink = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(`${window.location.origin}/login`);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000);
    } catch {
      setCopied(false);
    }
  }, []);

  const runNativePromptOnce = useCallback(async () => {
    if (promptOnceGuard) return;
    setPromptOnceGuard(true);
    setStatus("prompting");
    try {
      const outcome = await promptNativeInstall();
      if (outcome === "accepted") {
        setInstalledEvent(true);
        setStatus("started");
        setStatus("installed");
      } else if (outcome === "dismissed") {
        setStatus("cancelled");
        setPromptOnceGuard(false);
      } else {
        setStatus(hasDeferredInstallPrompt() ? "install" : "unsupported");
        setPromptOnceGuard(false);
      }
    } catch {
      setStatus("unsupported");
      setPromptOnceGuard(false);
    } finally {
      onInteract?.();
    }
  }, [onInteract, promptOnceGuard]);

  const onInstallClick = useCallback(() => {
    if (isInstalled) return;

    const currentPlatform = detectInstallPlatform(window, navigator);
    setPlatform(currentPlatform);

    // Chromium/Android: same gesture → native prompt (no intermediate modal).
    if (hasDeferredInstallPrompt()) {
      void runNativePromptOnce();
      return;
    }

    if (currentPlatform === "ios-safari" || currentPlatform === "ios-other" || currentPlatform === "mac-safari") {
      setGuideOpen(true);
      return;
    }

    // BIP still missing — keep button visible; show clear status (no "Instalar ahora" modal).
    setStatus(currentPlatform === "chromium" ? "preparing" : "unsupported");
  }, [isInstalled, runNativePromptOnce]);

  const buttonClass = useMemo(() => {
    if (variant === "login") {
      return `inline-flex min-h-11 w-full items-center justify-center gap-2 rounded-[var(--os-radius-sm)] border border-[var(--os-border)] bg-[var(--os-surface)] px-4 text-sm font-medium text-[var(--os-text)] ${className}`;
    }
    if (variant === "inline") {
      return `inline-flex min-h-11 items-center gap-2 rounded-[var(--os-radius-sm)] px-3 text-sm text-[var(--os-text)] hover:bg-[var(--os-bg)] ${className}`;
    }
    return `flex min-h-11 w-full items-center gap-2 px-3 py-2.5 text-left text-sm text-[var(--os-text)] transition-colors hover:bg-[var(--os-bg)] ${className}`;
  }, [variant, className]);

  const guide =
    guideOpen && !isInstalled && typeof document !== "undefined"
      ? createPortal(
          <InstallGuideSheet
            platform={platform}
            copied={copied}
            onClose={closeGuide}
            onCopyLink={() => void copyLink()}
          />,
          portalContainer ?? document.body
        )
      : null;

  return (
    <div className={variant === "login" ? "w-full space-y-2" : "w-full"}>
      <button
        type="button"
        role={variant === "menu" ? "menuitem" : undefined}
        className={buttonClass}
        aria-label={label}
        aria-busy={status === "prompting" || status === "preparing"}
        disabled={isInstalled}
        data-genus-install-has-native={hasNative ? "true" : "false"}
        data-genus-install-status={status}
        onClick={onInstallClick}
      >
        {isInstalled ? (
          <Check className="size-3.5 text-[var(--os-teal)]" aria-hidden="true" />
        ) : (
          <Download className="size-3.5 text-[var(--os-text-muted)]" aria-hidden="true" />
        )}
        {label}
      </button>
      {statusText && !isInstalled && (
        <p className="px-1 text-xs text-[var(--os-text-muted)]" aria-live="polite" role="status">
          {statusText}
        </p>
      )}
      {guide}
    </div>
  );
}

/** Guías solo donde no hay prompt nativo (iOS / Safari Mac). Sin botón “Instalar ahora”. */
function InstallGuideSheet({
  platform,
  copied,
  onClose,
  onCopyLink,
}: {
  platform: InstallPlatformKind;
  copied: boolean;
  onClose: () => void;
  onCopyLink: () => void;
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

        <div className="mt-4 space-y-3 text-sm text-[var(--os-text)]">
          {platform === "ios-safari" && (
            <>
              <p className="text-[var(--os-text-muted)]">
                En iPhone/iPad Safari no hay instalación automática. Seguí estos pasos:
              </p>
              <ol className="space-y-2 text-left">
                <li className="flex items-center gap-1.5">
                  1. Tocá <Share className="inline size-3.5" aria-hidden="true" /> Compartir.
                </li>
                <li>2. Elegí “Agregar a inicio” / “Agregar a pantalla de inicio”.</li>
                <li>3. Tocá Agregar.</li>
              </ol>
            </>
          )}

          {platform === "ios-other" && (
            <>
              <p>Para instalar Genus OS, abrilo en Safari (este navegador no permite agregarlo al inicio).</p>
              <ol className="list-decimal space-y-1 pl-4 text-[var(--os-text-muted)]">
                <li>Copiá el enlace.</li>
                <li>Abrí Safari.</li>
                <li>Compartir → Agregar a inicio → Agregar.</li>
              </ol>
              <button
                type="button"
                onClick={onCopyLink}
                className="min-h-11 w-full rounded-[var(--os-radius-sm)] bg-[var(--os-teal)] text-sm font-medium text-[var(--os-navy)]"
              >
                {copied ? "Enlace copiado" : "Copiar enlace"}
              </button>
            </>
          )}

          {platform === "mac-safari" && (
            <>
              <p>En Safari de Mac:</p>
              <ol className="list-decimal space-y-1 pl-4">
                <li>Menú Archivo → Agregar al Dock.</li>
                <li>Confirmá para abrir Genus OS como app.</li>
              </ol>
            </>
          )}

          <button
            type="button"
            onClick={onClose}
            className="min-h-11 w-full rounded-[var(--os-radius-sm)] border border-[var(--os-border)] text-sm text-[var(--os-text)]"
          >
            Cerrar
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
