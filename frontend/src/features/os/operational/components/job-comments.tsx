"use client";

import { useCallback, useEffect, useRef, useState } from "react";

const POLL_MS = 15_000;
const MAX_LEN = 2000;

export interface JobCommentDto {
  id: string;
  workItemId: string;
  body: string;
  authorName: string;
  authorSector: string;
  authorSectorLabel: string;
  createdAt: string;
}

const newRequestId = () => (typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID() : `r-${Date.now()}-${Math.random().toString(36).slice(2)}`);

/** «02/11/2026 · 10:15» en hora de Buenos Aires. */
export function formatCommentWhen(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  const parts = new Intl.DateTimeFormat("es-AR", { timeZone: "America/Argentina/Buenos_Aires", day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit", hour12: false }).formatToParts(d);
  const p = (t: string) => parts.find((x) => x.type === t)?.value ?? "";
  return `${p("day")}/${p("month")}/${p("year")} · ${p("hour")}:${p("minute")}`;
}

/**
 * Comentarios del equipo de UN trabajo (por su id estable). Solo se monta mientras la tarjeta está abierta: consulta al abrir, cada 15 s
 * y al volver a la pestaña. Todo texto se muestra como texto (React lo escapa; nunca HTML). Autor y sector los fija el servidor con la sesión.
 */
export function JobComments({ workItemId }: { workItemId: string }) {
  const [comments, setComments] = useState<JobCommentDto[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [formError, setFormError] = useState<string | null>(null);
  const requestIdRef = useRef(newRequestId());
  const sendingRef = useRef(false);
  const listRef = useRef<HTMLUListElement | null>(null);
  const lastCountRef = useRef(0);

  const load = useCallback(async () => {
    try {
      const res = await fetch(`/api/v1/work-item-comments?workItemId=${encodeURIComponent(workItemId)}`, { cache: "no-store", credentials: "same-origin" });
      const json = (await res.json().catch(() => ({}))) as { comments?: JobCommentDto[]; error?: string };
      if (!res.ok) throw new Error(json.error || "No pudimos cargar los comentarios.");
      setComments(json.comments ?? []);
      setLoadError(null);
    } catch (e) {
      setLoadError(e instanceof Error ? e.message : "No pudimos cargar los comentarios.");
    }
  }, [workItemId]);

  useEffect(() => {
    const first = setTimeout(() => void load(), 0);
    const timer = setInterval(() => { if (typeof document === "undefined" || document.visibilityState === "visible") void load(); }, POLL_MS);
    const onVisible = () => { if (document.visibilityState === "visible") void load(); };
    document.addEventListener("visibilitychange", onVisible);
    return () => { clearTimeout(first); clearInterval(timer); document.removeEventListener("visibilitychange", onVisible); };
  }, [load]);

  // Los comentarios nuevos van al final: si cambió la cantidad, mostrar el último.
  useEffect(() => {
    const n = comments?.length ?? 0;
    if (n > lastCountRef.current && listRef.current) listRef.current.scrollTop = listRef.current.scrollHeight;
    lastCountRef.current = n;
  }, [comments]);

  async function publish() {
    if (sendingRef.current) return;
    const body = text.trim();
    if (!body) { setFormError("Escribí un comentario antes de publicar."); return; }
    sendingRef.current = true;
    setBusy(true);
    setFormError(null);
    try {
      const res = await fetch("/api/v1/work-item-comments", {
        method: "POST",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ workItemId, body, clientRequestId: requestIdRef.current }),
      });
      const json = (await res.json().catch(() => ({}))) as { comment?: JobCommentDto; error?: string };
      if (!res.ok || !json.comment) throw new Error(json.error || "No pudimos publicar el comentario. Probá de nuevo.");
      const saved = json.comment;
      setComments((prev) => (prev?.some((c) => c.id === saved.id) ? prev : [...(prev ?? []), saved]));
      setText("");
      requestIdRef.current = newRequestId(); // el próximo comentario es otra publicación
      setNotice("Comentario publicado");
      setTimeout(() => setNotice(null), 3000);
    } catch (e) {
      setFormError(e instanceof Error ? e.message : "No pudimos publicar el comentario. Probá de nuevo.");
    } finally {
      sendingRef.current = false;
      setBusy(false);
    }
  }

  return (
    <section className="mt-3 border-t border-white/15 pt-3" aria-label="Comentarios del equipo" data-testid="job-comments">
      <h4 className="text-[13px] font-semibold uppercase tracking-wide text-[#9fb4c0]">Comentarios del equipo</h4>
      {loadError && comments === null ? <p role="alert" className="mt-2 text-[13px] text-amber-300" data-testid="job-comments-error">{loadError}</p> : null}
      {comments === null && !loadError ? <p className="mt-2 text-[13px] text-[#9fb4c0]">Cargando…</p> : null}
      {comments && comments.length === 0 ? <p className="mt-2 text-[13px] text-[#9fb4c0]" data-testid="job-comments-empty">Todavía no hay comentarios.</p> : null}
      {comments && comments.length > 0 ? (
        <ul ref={listRef} className="mt-2 max-h-44 space-y-2 overflow-y-auto pr-1" data-testid="job-comments-list">
          {comments.map((c) => (
            <li key={c.id} className="rounded-lg bg-white/[0.06] px-2.5 py-2" data-testid="job-comment" data-comment-id={c.id}>
              <p className="text-[12px] text-[#9fb4c0]">
                <span className="font-semibold text-[#eaf3f6]" data-testid="job-comment-author">{c.authorName}</span>
                {" · "}<span data-testid="job-comment-sector">{c.authorSectorLabel}</span>
                {" · "}<time dateTime={c.createdAt} data-testid="job-comment-when">{formatCommentWhen(c.createdAt)}</time>
              </p>
              <p className="mt-0.5 whitespace-pre-wrap text-[14px] text-[#eaf3f6]" data-testid="job-comment-body">{c.body}</p>
            </li>
          ))}
        </ul>
      ) : null}
      <form
        className="sticky bottom-0 -mx-1 mt-3 bg-[#0f2634] px-1 pb-0.5 pt-1"
        onSubmit={(e) => { e.preventDefault(); void publish(); }}
        data-testid="job-comment-form"
      >
        <label className="sr-only" htmlFor={`job-comment-${workItemId}`}>Escribí un comentario</label>
        <textarea
          id={`job-comment-${workItemId}`}
          value={text}
          onChange={(e) => { setText(e.target.value.slice(0, MAX_LEN)); if (formError) setFormError(null); }}
          rows={2}
          placeholder="Escribí un comentario..."
          className="block w-full resize-none rounded-lg border border-white/20 bg-[#0a1c27] px-2.5 py-2 text-[14px] text-[#eaf3f6] placeholder:text-[#7d93a0] focus:outline focus:outline-2 focus:outline-[#12bfb7]"
          data-testid="job-comment-input"
        />
        <div className="mt-1.5 flex items-center gap-2">
          <button type="submit" disabled={busy} className="min-h-9 rounded-lg bg-[#12bfb7] px-4 text-[14px] font-semibold text-[#06202b] disabled:opacity-60" data-testid="job-comment-submit">
            {busy ? "Publicando…" : "Publicar"}
          </button>
          {notice ? <span role="status" className="text-[13px] font-medium text-[#6fe3d9]" data-testid="job-comment-notice">{notice}</span> : null}
          {formError ? <span role="alert" className="text-[13px] text-amber-300" data-testid="job-comment-form-error">{formError}</span> : null}
        </div>
      </form>
    </section>
  );
}
