"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type KeyboardEvent } from "react";
import { AlertCircle, ExternalLink, RefreshCcw, Send, Sparkles, Square } from "lucide-react";
import type { SectorId } from "@/types/operational/sector";
import type { WorkItem } from "@/types/operational/work-item";
import { buildCreamyLocalSnapshot } from "./build-local-snapshot";
import type {
  AssistantChatResponse,
  CreamyChatMessage,
  SourceCitation,
} from "./types";

const STORAGE_KEY = "genus_os_creamy_chat";

const DEFAULT_SUGGESTIONS = [
  "¿Qué trabajos tengo vencidos?",
  "Buscá el lote Creamy",
  "¿Qué OE/OA aparecen en mi snapshot?",
  "¿Hay materias primas por vencer?",
  "¿Qué decisiones de Calidad faltan?",
  "¿Cómo cargo una OE u OA?",
];

interface CreamyChatProps {
  sectorId: SectorId;
  workItems?: WorkItem[];
  suggestions?: string[];
  lotesSearchEnabled?: boolean;
  onOpenAsignacionLotes?: () => void;
}

function makeId(prefix = "msg"): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return `${prefix}-${crypto.randomUUID()}`;
  }
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function welcomeMessage(): CreamyChatMessage {
  return {
    id: "creamy-welcome",
    role: "assistant",
    content:
      "Hola, soy Creamy. Puedo consultar tu snapshot local de trabajos, lotes, materias primas, OE/OA y Calidad según permisos. No ejecuto acciones ni apruebo decisiones.",
    createdAt: new Date().toISOString(),
  };
}

function safeStoredMessages(value: string | null): CreamyChatMessage[] | null {
  if (!value) return null;
  try {
    const parsed = JSON.parse(value) as unknown;
    if (!Array.isArray(parsed)) return null;
    const messages = parsed.filter((item): item is CreamyChatMessage => {
      if (!item || typeof item !== "object") return false;
      const record = item as Record<string, unknown>;
      return (
        typeof record.id === "string" &&
        (record.role === "user" || record.role === "assistant") &&
        typeof record.content === "string" &&
        typeof record.createdAt === "string"
      );
    });
    return messages.length ? messages : null;
  } catch {
    return null;
  }
}

function formatSource(source: SourceCitation): string {
  return source.label || `${source.type}:${source.id}`;
}

export function CreamyChat({
  sectorId,
  workItems = [],
  suggestions,
  lotesSearchEnabled = false,
  onOpenAsignacionLotes,
}: CreamyChatProps) {
  const [messages, setMessages] = useState<CreamyChatMessage[]>(() => [welcomeMessage()]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const messagesEndRef = useRef<HTMLDivElement | null>(null);
  const chips = useMemo(() => suggestions?.length ? suggestions : DEFAULT_SUGGESTIONS, [suggestions]);

  useEffect(() => {
    const stored = safeStoredMessages(window.sessionStorage.getItem(STORAGE_KEY));
    if (!stored) return;
    const timer = window.setTimeout(() => setMessages(stored), 0);
    return () => window.clearTimeout(timer);
  }, []);

  useEffect(() => {
    window.sessionStorage.setItem(STORAGE_KEY, JSON.stringify(messages.slice(-30)));
    messagesEndRef.current?.scrollIntoView({ block: "end" });
  }, [messages, loading]);

  const stop = useCallback(() => {
    abortRef.current?.abort();
    abortRef.current = null;
    setLoading(false);
  }, []);

  const sendMessage = useCallback(
    async (text: string) => {
      const content = text.trim();
      if (!content || loading) return;

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
      abortRef.current = controller;

      try {
        const snapshot = buildCreamyLocalSnapshot({ actorSectorId: sectorId, workItems });
        const response = await fetch("/api/v1/assistant/chat", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          signal: controller.signal,
          body: JSON.stringify({
            actorSectorId: sectorId,
            messages: nextMessages.map((message) => ({
              role: message.role,
              content: message.content,
            })),
            snapshot,
          }),
        });
        const payload = (await response.json()) as Partial<AssistantChatResponse> & {
          message?: string;
          error?: string;
        };
        if (!response.ok) {
          throw new Error(payload.message || payload.error || "Creamy no pudo responder.");
        }
        setMessages((current) => [
          ...current,
          {
            id: makeId("assistant"),
            role: "assistant",
            content: payload.reply || "No pude generar una respuesta.",
            createdAt: new Date().toISOString(),
            sources: payload.sources ?? [],
            usedTools: payload.usedTools ?? [],
          },
        ]);
      } catch (err) {
        if (err instanceof DOMException && err.name === "AbortError") {
          setError("Respuesta cancelada.");
          return;
        }
        setError(err instanceof Error ? err.message : "Creamy no pudo responder.");
      } finally {
        if (abortRef.current === controller) abortRef.current = null;
        setLoading(false);
      }
    },
    [loading, messages, sectorId, workItems]
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
    stop();
    setMessages([welcomeMessage()]);
    setInput("");
    setError(null);
  }, [stop]);

  return (
    <section className="flex h-full min-h-0 flex-col bg-[var(--os-surface)]">
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

      <div className="flex flex-wrap gap-2 border-b border-[var(--os-border)] px-5 py-3">
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

      <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">
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
                      ? "border border-[var(--os-border)] bg-white text-[var(--os-text)]"
                      : "bg-slate-950 text-white"
                  }`}
                >
                  <p className="whitespace-pre-wrap leading-relaxed">{message.content}</p>
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
              <div className="rounded-[var(--os-radius)] border border-[var(--os-border)] bg-white px-4 py-3 text-sm text-[var(--os-text-muted)] shadow-[var(--os-shadow-sm)]">
                Creamy está pensando…
              </div>
            </div>
          )}
          <div ref={messagesEndRef} />
        </div>
      </div>

      {error && (
        <div className="mx-5 mb-3 flex items-start gap-2 rounded-[var(--os-radius-sm)] border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-900">
          <AlertCircle className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
          <p>{error}</p>
        </div>
      )}

      <div className="border-t border-[var(--os-border)] px-5 py-4">
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
          className="max-h-32 min-h-20 w-full resize-none rounded-[var(--os-radius-sm)] border border-[var(--os-border)] bg-white px-3 py-2 text-sm text-[var(--os-text)] outline-none transition focus:border-[var(--os-teal)] focus:ring-2 focus:ring-[var(--os-teal-muted)] disabled:bg-slate-50"
        />
        <div className="mt-3 flex items-center justify-between gap-2">
          <button
            type="button"
            onClick={resetConversation}
            className="inline-flex items-center gap-1.5 rounded-full px-3 py-2 text-xs font-medium text-[var(--os-text-muted)] hover:bg-[var(--os-bg)]"
          >
            <RefreshCcw className="size-3.5" aria-hidden="true" />
            Nueva conversación
          </button>
          <div className="flex items-center gap-2">
            {loading && (
              <button
                type="button"
                onClick={stop}
                className="inline-flex items-center gap-1.5 rounded-full border border-rose-200 bg-rose-50 px-3 py-2 text-xs font-semibold text-rose-700"
              >
                <Square className="size-3" aria-hidden="true" />
                Detener
              </button>
            )}
            <button
              type="button"
              onClick={handleSubmit}
              disabled={loading || !input.trim()}
              className="inline-flex items-center gap-2 rounded-full bg-[var(--os-teal)] px-4 py-2 text-sm font-semibold text-white shadow-[var(--os-shadow-sm)] transition hover:brightness-95 disabled:cursor-not-allowed disabled:opacity-50"
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
