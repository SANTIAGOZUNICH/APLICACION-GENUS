"use client";

import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import { cn } from "@/lib/utils/cn";
import type { FeedbackTone } from "@/types/actions";

export interface ToastMessage {
  id: string;
  tone: FeedbackTone;
  title: string;
  description?: string;
}

interface ToastContextValue {
  showToast: (toast: Omit<ToastMessage, "id">) => void;
}

const ToastContext = createContext<ToastContextValue | null>(null);

const toneStyles: Record<FeedbackTone, string> = {
  ok: "border-[var(--color-ok)]/30 bg-[var(--badge-ok-bg)]",
  attention: "border-[var(--color-attention)]/30 bg-[var(--badge-attention-bg)]",
  problem: "border-[var(--color-problem)]/30 bg-[var(--badge-problem-bg)]",
  info: "border-[var(--border)] bg-[var(--surface)]",
};

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<ToastMessage[]>([]);

  const showToast = useCallback((toast: Omit<ToastMessage, "id">) => {
    const id = `toast-${Date.now()}`;
    setToasts((prev) => [...prev, { ...toast, id }]);
    window.setTimeout(() => {
      setToasts((prev) => prev.filter((t) => t.id !== id));
    }, 4500);
  }, []);

  const value = useMemo(() => ({ showToast }), [showToast]);

  return (
    <ToastContext.Provider value={value}>
      {children}
      <div
        className="pointer-events-none fixed bottom-4 right-4 z-[100] flex max-w-sm flex-col gap-2"
        aria-live="polite"
      >
        {toasts.map((toast) => (
          <div
            key={toast.id}
            className={cn(
              "pointer-events-auto rounded-lg border px-4 py-3 shadow-md",
              toneStyles[toast.tone]
            )}
          >
            <p
              className="font-medium text-[var(--foreground)]"
              style={{ fontSize: "var(--text-body)" }}
            >
              {toast.title}
            </p>
            {toast.description && (
              <p
                className="mt-1 text-[var(--muted-foreground)]"
                style={{ fontSize: "var(--text-meta)" }}
              >
                {toast.description}
              </p>
            )}
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}

export function useToast(): ToastContextValue {
  const ctx = useContext(ToastContext);
  if (!ctx) {
    throw new Error("useToast must be used within ToastProvider");
  }
  return ctx;
}

/** Maps ActionResult feedback to toast — UI layer only. */
export function showActionResultToast(
  showToast: ToastContextValue["showToast"],
  result: import("@/types/actions").ActionResult
) {
  if (result.ok) {
    showToast({
      tone: result.feedback.tone,
      title: result.feedback.title,
      description: result.postaSummary
        ? `${result.feedback.description ?? ""}${result.feedback.description ? " · " : ""}${result.postaSummary}`
        : result.feedback.description,
    });
  } else {
    showToast({
      tone: result.feedback.tone,
      title: result.feedback.title,
      description: result.feedback.description,
    });
  }
}
