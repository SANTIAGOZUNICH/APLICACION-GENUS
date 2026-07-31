"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type KeyboardEvent } from "react";
import { AlertCircle, ExternalLink, RefreshCcw, Send, Sparkles, Square } from "lucide-react";
import type { SectorId } from "@/types/operational/sector";
import type { SidebarItemId } from "@/lib/role-engine/types";
import type { WorkItem } from "@/types/operational/work-item";
import { buildCreamyLocalSnapshot } from "./build-local-snapshot";
import { useCreamyChat } from "./creamy-chat-context";
import type {
  AssistantChatResponse,
  CreamyChatMessage,
  CreamyNavAction,
  CreamyUiContext,
  SourceCitation,
} from "./types";

const DEFAULT_SUGGESTIONS = [
  "¿Qué trabajos vencen esta semana?",
  "¿Qué está haciendo Elaboración?",
  "Buscá el producto Creamy en asignación de lotes.",
  "¿Qué lotes vencen este mes?",
  "¿Qué trabajos esperan aprobación de Calidad?",
  "¿Qué se entregó hoy?",
  "¿Qué está aprobado pero todavía no fue entregado?",
];

const REQUEST_TIMEOUT_MS = 30_000;
const NAV_ACTIONS_RE = /NAV_ACTIONS:\s*(.+?)(?:\n|$)/i;

interface CreamyChatProps {
  sectorId: SectorId;
  workItems?: WorkItem[];
  suggestions?: string[];
  lotesSearchEnabled?: boolean;
  onOpenAsignacionLotes?: () => void;
  onNavigate?: (sidebarId: SidebarItemId) => void;
  uiContext?: CreamyUiContext;
  compact?: boolean;
  showHeaderActions?: boolean;
}

function makeId(prefix = "msg"): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return `${prefix}-${crypto.randomUUID()}`;
  }
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function formatSource(source: SourceCitation): string {
  return source.label || `${source.type}:${source.id}`;
}

export function parseNavActionsFromReply(content: string): CreamyNavAction[] {
  const match = NAV_ACTIONS_RE.exec(content);
  if (!match?.[1]) return [];
  const actions: CreamyNavAction[] = [];
  for (const segment of match[1].split(";")) {
    const [sidebarId, label] = segment.split("|").map((part) => part.trim());
    if (sidebarId && label) actions.push({ sidebarId, label });
  }
  return actions;
}

export function stripNavActionsLine(content: string): string {
  return content.replace(/\n?NAV_ACTIONS:\s*.+?(?:\n|$)/i, "").trimEnd();
}

function mergeNavActions(...groups: Array<CreamyNavAction[] | undefined>): CreamyNavAction[] {
  const merged: CreamyNavAction[] = [];
  const seen = new Set<string>();
  for (const group of groups) {
    if (!group) continue;
    for (const action of group) {
      const key = `${action.sidebarId}:${action.label}`;
      if (seen.has(key)) continue;
      seen.add(key);
      merged.push(action);
    }
  }
  return merged;
}

function friendlyError(
  err: unknown,
  payload?: { code?: string; error?: string; message?: string },
  options?: { timedOut?: boolean; status?: number }
): string {
  const code = payload?.code || payload?.error;
  if (code === "CREAMY_NOT_CONFIGURED") {
    return "Creamy no está configurado en este entorno.";
  }
  if (code === "CREAMY_AUTH_REJECTED") {
    return "El proveedor rechazó la credencial.";
  }
  if (code === "CREAMY_MODEL_UNAVAILABLE") {
    return "El modelo configurado no está disponible.";
  }
  if (code === "CREAMY_TIMEOUT" || options?.timedOut) {
    return "La respuesta tardó demasiado.";
  }
  if (code === "CREAMY_RATE_LIMIT" || options?.status === 429) {
    return "Se alcanzó el límite de uso del proveedor. Esperá un momento e intentá de nuevo.";
  }
  if (code === "CREAMY_PROVIDER_UNREACHABLE") {
    return "No pudimos contactar al proveedor. Reintentar.";
  }
  if (code === "CREAMY_ABORTED" || options?.status === 499) {
    return "La respuesta de Creamy fue interrumpida.";
  }
  if (options?.status === 502 || code === "CREAMY_AI_FAILED") {
    return "No pudimos contactar al proveedor. Reintentar.";
  }
  if (options?.status === 503) {
    return "Creamy no está configurado en este entorno.";
  }
  if (err instanceof TypeError) {
    return "No pudimos contactar al proveedor. Reintentar.";
  }
  // Validation / known client-safe messages only — never surface raw provider text.
  if (
    typeof payload?.message === "string" &&
    payload.message.trim() &&
    !/models\/|api key|AIza|sk-/i.test(payload.message)
  ) {
    return payload.message;
  }
  return "No pudimos contactar al proveedor. Reintentar.";
}

export function CreamyChat({
  sectorId,
  workItems = [],
  suggestions,
  lotesSearchEnabled = false,
  onOpenAsignacionLotes,
  onNavigate,
  uiContext,
  compact = false,
  showHeaderActions = true,
}: CreamyChatProps) {
  const { messages, setMessages, resetConversation: resetSharedConversation } = useCreamyChat();
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [lastUserMessage, setLastUserMessage] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const timeoutRef = useRef<number | null>(null);
  const messagesEndRef = useRef<HTMLDivElement | null>(null);
  const chips = useMemo(() => (suggestions?.length ? suggestions : DEFAULT_SUGGESTIONS), [suggestions]);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ block: "end" });
  }, [messages, loading]);

  const stop = useCallback(() => {
    abortRef.current?.abort();
    abortRef.current = null;
    if (timeoutRef.current != null) {
      window.clearTimeout(timeoutRef.current);
      timeoutRef.current = null;
    }
    setLoading(false);
  }, []);

  const sendMessage = useCallback(
    async (text: string) => {
      const content = text.trim();
      if (!content || loading) return;

      setLastUserMessage(content);

      const userMessage: CreamyChatMessage = {
        id: makeId("user"),
        role: "user",
        content,
        createdAt: new Date().toISOString(),
      };
      const nextMessages = [...messages, userMessage];
      setMessages(nextMessages);
      setInput("");
      setError(null);
      setLoading(true);

      const controller = new AbortController();
      let timedOut = false;
      abortRef.current = controller;
      timeoutRef.current = window.setTimeout(() => {
        timedOut = true;
        controller.abort();
      }, REQUEST_TIMEOUT_MS);

      try {
        const snapshot = buildCreamyLocalSnapshot({ actorSectorId: sectorId, workItems });
        const response = await fetch("/api/v1/assistant/chat", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "x-genus-actor-email": uiContext?.email?.trim() || "",
            "x-genus-actor-sector": sectorId,
          },
          signal: controller.signal,
          body: JSON.stringify({
            actorSectorId: sectorId,
            messages: nextMessages.map((message) => ({
              role: message.role,
              content: message.content,
            })),
            snapshot,
            uiContext: uiContext
              ? {
                  route: uiContext.route,
                  tab: uiContext.tab,
                  moduleName: uiContext.moduleName,
                  availableNav: uiContext.availableNav,
                  openItemSummary: uiContext.openItemSummary,
                }
              : undefined,
          }),
        });
        const payload = (await response.json().catch(() => ({}))) as Partial<AssistantChatResponse> & {
          message?: string;
          error?: string;
          code?: string;
        };
        if (!response.ok) {
          throw Object.assign(new Error(friendlyError(undefined, payload, { status: response.status })), {
            payload,
            status: response.status,
          });
        }
        const replyText = payload.reply || "No pude generar una respuesta.";
        const parsedNav = parseNavActionsFromReply(replyText);
        const navActions = mergeNavActions(payload.navActions, parsedNav);
        setMessages((current) => [
          ...current,
          {
            id: makeId("assistant"),
            role: "assistant",
            content: stripNavActionsLine(replyText),
            createdAt: new Date().toISOString(),
            sources: payload.sources ?? [],
            usedTools: payload.usedTools ?? [],
            navActions: navActions.length ? navActions : undefined,
          },
        ]);
      } catch (err) {
        if (err instanceof DOMException && err.name === "AbortError") {
          setError(timedOut ? friendlyError(err, undefined, { timedOut: true }) : "Respuesta cancelada.");
          return;
        }
        const maybe = err as { payload?: { code?: string; error?: string; message?: string }; status?: number };
        setError(friendlyError(err, maybe.payload, { status: maybe.status }));
      } finally {
        if (timeoutRef.current != null) {
          window.clearTimeout(timeoutRef.current);
          timeoutRef.current = null;
        }
        if (abortRef.current === controller) abortRef.current = null;
        setLoading(false);
      }
    },
    [loading, messages, sectorId, setMessages, uiContext, workItems]
  );

  const handleSubmit = useCallback(() => {
    void sendMessage(input);
  }, [input, sendMessage]);

  const handleKeyDown = useCallback(
    (event: KeyboardEvent<HTMLTextAreaElement>) => {
      if (event.key !== "Enter" || event.shiftKey) return;
      event.preventDefault();
      handleSubmit();
    },
    [handleSubmit]
  );

  const resetConversation = useCallback(() => {
    if (!window.confirm("¿Empezar una nueva conversación? Se borrará el historial actual.")) return;
    stop();
    resetSharedConversation();
    setInput("");
    setError(null);
    setLastUserMessage(null);
  }, [resetSharedConversation, stop]);

  const handleRetry = useCallback(() => {
    if (!lastUserMessage || loading) return;
    setError(null);
    void sendMessage(lastUserMessage);
  }, [lastUserMessage, loading, sendMessage]);

  return (
    <section className="flex h-full min-h-0 flex-col bg-[var(--os-surface)]">
      {!compact && (
      <div className="border-b border-[var(--os-border)] bg-gradient-to-r from-slate-950 via-slate-900 to-[var(--os-teal)] px-5 py-4 text-white">
        <div className="flex items-start gap-3">
          <div className="rounded-full bg-white/15 p-2">
            <Sparkles className="size-4" aria-hidden="true" />
          </div>
          <div>
            <p className="text-sm font-semibold">Creamy AI</p>
            <p className="mt-1 text-xs leading-relaxed text-white/80">
              Conversación real con datos locales filtrados. Solo lectura; las decisiones GMP van a Calidad/Producción/DT.
            </p>
          </div>
        </div>
      </div>
      )}

      <div className={`flex flex-wrap gap-2 border-b border-[var(--os-border)] ${compact ? "px-4 py-3" : "px-5 py-3"}`}>
        {chips.map((suggestion) => (
          <button
            key={suggestion}
            type="button"
            disabled={loading}
            onClick={() => void sendMessage(suggestion)}
            className="rounded-full border border-[var(--os-teal-muted)] bg-[var(--os-teal-soft)] px-3 py-1.5 text-xs font-medium text-[var(--os-text)] transition-colors hover:border-[var(--os-teal)] disabled:cursor-not-allowed disabled:opacity-50"
          >
            {suggestion}
          </button>
        ))}
        {lotesSearchEnabled && onOpenAsignacionLotes && (
          <button
            type="button"
            onClick={onOpenAsignacionLotes}
            className="inline-flex items-center gap-1 rounded-full px-2 py-1.5 text-xs font-medium text-[var(--os-teal)] hover:underline"
          >
            Abrir asignación de lotes
            <ExternalLink className="size-3" aria-hidden="true" />
          </button>
        )}
      </div>

      <div className={`min-h-0 flex-1 overflow-y-auto ${compact ? "px-4 py-3" : "px-5 py-4"}`}>
        <div className="space-y-4">
          {messages.map((message) => {
            const isAssistant = message.role === "assistant";
            return (
              <article
                key={message.id}
                className={`flex ${isAssistant ? "justify-start" : "justify-end"}`}
              >
                <div
                  className={`max-w-[88%] rounded-[var(--os-radius)] px-4 py-3 text-sm shadow-[var(--os-shadow-sm)] ${
                    isAssistant
                      ? "border border-[var(--os-border)] bg-[var(--os-surface)] text-[var(--os-text)]"
                      : "bg-[var(--os-navy)] text-[var(--os-sidebar-text)]"
                  }`}
                >
                  <p className="whitespace-pre-wrap leading-relaxed">{message.content}</p>
                  {isAssistant && message.navActions && message.navActions.length > 0 && onNavigate && (
                    <div className="mt-3 flex flex-wrap gap-2">
                      {message.navActions.map((action) => (
                        <button
                          key={`${action.sidebarId}-${action.label}`}
                          type="button"
                          onClick={() => onNavigate(action.sidebarId as SidebarItemId)}
                          className="rounded-full border border-[var(--os-teal-muted)] bg-[var(--os-teal-soft)] px-3 py-1 text-[11px] font-semibold uppercase tracking-wide text-[var(--os-teal)] hover:border-[var(--os-teal)]"
                        >
                          {action.label}
                        </button>
                      ))}
                    </div>
                  )}
                  {isAssistant && message.sources && message.sources.length > 0 && (
                    <div className="mt-3 rounded-[var(--os-radius-sm)] border border-[var(--os-teal-muted)] bg-[var(--os-teal-soft)] px-3 py-2">
                      <p className="text-[11px] font-semibold uppercase tracking-wide text-[var(--os-teal)]">
                        Información consultada
                      </p>
                      <ul className="mt-1 space-y-1 text-xs text-[var(--os-text-muted)]">
                        {message.sources.map((source) => (
                          <li key={`${source.type}-${source.id}`}>{formatSource(source)}</li>
                        ))}
                      </ul>
                    </div>
                  )}
                </div>
              </article>
            );
          })}

          {loading && (
            <div className="flex justify-start">
              <div className="rounded-[var(--os-radius)] border border-[var(--os-border)] bg-[var(--os-surface)] px-4 py-3 text-sm text-[var(--os-text-muted)] shadow-[var(--os-shadow-sm)]">
                Pensando…
              </div>
            </div>
          )}
          <div ref={messagesEndRef} />
        </div>
      </div>

      {error && (
        <div className={`${compact ? "mx-4" : "mx-5"} mb-3 flex items-start gap-2 rounded-[var(--os-radius-sm)] border border-[var(--genus-error)]/25 bg-[var(--genus-error-soft)] px-3 py-2 text-sm text-[var(--genus-error)]`}>
          <AlertCircle className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
          <div className="min-w-0 flex-1">
            <p>{error}</p>
            {lastUserMessage && (
              <button
                type="button"
                onClick={handleRetry}
                disabled={loading}
                className="mt-2 inline-flex items-center gap-1 rounded-full border border-[var(--genus-error)]/30 px-2.5 py-1 text-xs font-semibold hover:bg-[var(--genus-error)]/10 disabled:opacity-50"
              >
                <RefreshCcw className="size-3" aria-hidden="true" />
                Reintentar
              </button>
            )}
          </div>
        </div>
      )}

      <div className={`border-t border-[var(--os-border)] ${compact ? "px-4 py-3" : "px-5 py-4"}`}>
        <label htmlFor="creamy-chat-input" className="sr-only">
          Mensaje para Creamy
        </label>
        <textarea
          id="creamy-chat-input"
          value={input}
          onChange={(event) => setInput(event.target.value)}
          onKeyDown={handleKeyDown}
          rows={3}
          maxLength={4000}
          placeholder="Preguntale a Creamy por trabajos, lotes, OE/OA, MP o Calidad…"
          disabled={loading}
          className={`${compact ? "min-h-16" : "min-h-20"} max-h-32 w-full resize-none rounded-[var(--os-radius-sm)] border border-[var(--os-border)] bg-[var(--os-surface)] px-3 py-2 text-sm text-[var(--os-text)] outline-none transition focus:border-[var(--os-teal)] focus:ring-2 focus:ring-[var(--os-teal-muted)] disabled:bg-[var(--os-surface-muted)]`}
        />
        <div className="mt-3 flex items-center justify-between gap-2">
          {showHeaderActions ? (
            <button
              type="button"
              onClick={resetConversation}
              className="inline-flex items-center gap-1.5 rounded-full px-3 py-2 text-xs font-medium text-[var(--os-text-muted)] hover:bg-[var(--os-bg)]"
            >
              <RefreshCcw className="size-3.5" aria-hidden="true" />
              Nueva conversación
            </button>
          ) : (
            <span aria-hidden="true" />
          )}
          <div className="flex items-center gap-2">
            {loading && (
              <button
                type="button"
                onClick={stop}
                className="inline-flex items-center gap-1.5 rounded-full border border-[var(--genus-error)]/25 bg-[var(--genus-error-soft)] px-3 py-2 text-xs font-semibold text-[var(--genus-error)]"
              >
                <Square className="size-3" aria-hidden="true" />
                Detener
              </button>
            )}
            <button
              type="button"
              onClick={handleSubmit}
              disabled={loading || !input.trim()}
              className="inline-flex items-center gap-2 rounded-full bg-[var(--os-action)] px-4 py-2 text-sm font-semibold text-white shadow-[var(--os-shadow-sm)] transition hover:brightness-95 disabled:cursor-not-allowed disabled:opacity-50"
            >
              Enviar
              <Send className="size-4" aria-hidden="true" />
            </button>
          </div>
        </div>
      </div>
    </section>
  );
}
