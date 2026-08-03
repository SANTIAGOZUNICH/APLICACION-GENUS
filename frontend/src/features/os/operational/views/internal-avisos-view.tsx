"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { TwinShell } from "@/features/os/shell/twin-shell";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/dialog";
import { SchemaPendingBanner } from "@/components/ui/schema-pending-banner";
import { usePreviewSession } from "@/features/os/session/preview-context";
import {
  createAvisoApi,
  fetchAvisosApi,
  patchAvisoApi,
} from "@/lib/avisos/avisos-client";
import {
  AVISO_PARTICIPANT_SECTORS,
  type AvisoPriority,
  type AvisoRecord,
  type AvisoTab,
} from "@/lib/avisos/types";
import { SECTOR_LABELS, type SectorId } from "@/types/operational/sector";

const TABS: { id: AvisoTab; label: string }[] = [
  { id: "recibidos", label: "Recibidos" },
  { id: "enviados", label: "Enviados" },
  { id: "archivados", label: "Archivados" },
];

export function InternalAvisosView() {
  const { email, sectorId } = usePreviewSession();
  const session = useMemo(
    () => ({ email: email ?? "", sector: sectorId }),
    [email, sectorId]
  );
  const [tab, setTab] = useState<AvisoTab>("recibidos");
  const [q, setQ] = useState("");
  const [items, setItems] = useState<AvisoRecord[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<AvisoRecord | null>(null);
  const [composeOpen, setComposeOpen] = useState(false);
  const [confirmSend, setConfirmSend] = useState(false);
  const [schemaPending, setSchemaPending] = useState(false);
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [priority, setPriority] = useState<AvisoPriority>("NORMAL");
  const [toAll, setToAll] = useState(false);
  const [toSectors, setToSectors] = useState<SectorId[]>([]);

  const reload = useCallback(async () => {
    try {
      const { messages, schemaPending: pending } = await fetchAvisosApi(session, tab, q);
      setItems(messages);
      setSchemaPending(pending);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Error al cargar avisos");
    }
  }, [session, tab, q]);

  useEffect(() => {
    void reload();
  }, [reload]);

  async function openMessage(m: AvisoRecord) {
    setSelected(m);
    if (tab === "recibidos") {
      try {
        const updated = await patchAvisoApi(session, m.id, "read");
        setSelected(updated);
        void reload();
      } catch {
        /* ignore */
      }
    }
  }

  async function archiveSelected() {
    if (!selected) return;
    await patchAvisoApi(session, selected.id, "archive");
    setSelected(null);
    void reload();
  }

  async function restoreSelected() {
    if (!selected) return;
    await patchAvisoApi(session, selected.id, "restore");
    setSelected(null);
    setTab("recibidos");
    void reload();
  }

  async function doSend() {
    try {
      await createAvisoApi(session, {
        title,
        body,
        priority,
        toAll,
        toSectors,
      });
      setComposeOpen(false);
      setConfirmSend(false);
      setTitle("");
      setBody("");
      setToAll(false);
      setToSectors([]);
      setTab("enviados");
      void reload();
    } catch (e) {
      setError(e instanceof Error ? e.message : "No se pudo enviar");
      setConfirmSend(false);
    }
  }

  function toggleSector(s: SectorId) {
    setToSectors((prev) =>
      prev.includes(s) ? prev.filter((x) => x !== s) : [...prev, s]
    );
  }

  return (
    <TwinShell title="Avisos">
      <div className="space-y-4 p-4" data-testid="internal-avisos-view">
        <SchemaPendingBanner show={schemaPending} />
        <div className="flex flex-wrap items-center gap-2">
          {TABS.map((t) => (
            <button
              key={t.id}
              type="button"
              data-testid={`avisos-tab-${t.id}`}
              className={`rounded border px-3 py-1.5 text-sm ${
                tab === t.id
                  ? "border-[var(--os-teal,#0d9488)] bg-[var(--os-bg-muted)] font-medium"
                  : "border-[var(--os-border)]"
              }`}
              onClick={() => setTab(t.id)}
            >
              {t.label}
            </button>
          ))}
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Buscar…"
            className="ml-auto rounded border border-[var(--os-border)] px-2 py-1.5 text-sm"
            data-testid="avisos-search"
          />
          <Button
            type="button"
            onClick={() => setComposeOpen(true)}
            data-testid="avisos-compose"
            disabled={schemaPending}
          >
            Crear aviso
          </Button>
        </div>

        {error ? (
          <p className="rounded border border-[var(--genus-warning)]/30 bg-[var(--genus-warning-soft)] px-3 py-2 text-sm text-[var(--genus-warning)]">
            {error}
          </p>
        ) : null}

        <div className="grid gap-3 lg:grid-cols-2">
          <ul className="divide-y rounded border border-[var(--os-border)] bg-[var(--os-surface)]">
            {items.length === 0 ? (
              <li className="px-3 py-6 text-sm text-[var(--os-text-muted)]">Sin avisos.</li>
            ) : (
              items.map((m) => {
                const mine = m.recipients.find((r) => r.sector === sectorId);
                const unread = tab === "recibidos" && mine && !mine.readAt;
                return (
                  <li key={m.id}>
                    <button
                      type="button"
                      className="flex w-full flex-col gap-0.5 px-3 py-2.5 text-left hover:bg-[var(--os-bg-muted)]"
                      onClick={() => void openMessage(m)}
                      data-testid={`aviso-row-${m.id}`}
                    >
                      <span className="flex items-center gap-2 text-sm font-medium">
                        {unread ? <span className="h-2 w-2 rounded-full bg-teal-600" /> : null}
                        {m.title}
                        <span className="ml-auto text-[10px] uppercase text-[var(--os-text-muted)]">
                          {m.priority}
                        </span>
                      </span>
                      <span className="text-[11px] text-[var(--os-text-muted)]">
                        De {SECTOR_LABELS[m.fromSector]} ·{" "}
                        {new Date(m.createdAt).toLocaleString("es-AR")}
                      </span>
                    </button>
                  </li>
                );
              })
            )}
          </ul>

          <div className="rounded border border-[var(--os-border)] bg-[var(--os-surface)] p-3">
            {selected ? (
              <div className="space-y-3" data-testid="aviso-detail">
                <h2 className="text-base font-semibold">{selected.title}</h2>
                <p className="text-xs text-[var(--os-text-muted)]">
                  {SECTOR_LABELS[selected.fromSector]} ({selected.fromEmail}) ·{" "}
                  {selected.priority} ·{" "}
                  {new Date(selected.createdAt).toLocaleString("es-AR")}
                </p>
                <p className="text-xs text-[var(--os-text-muted)]">
                  Para: {selected.toSectors.map((s) => SECTOR_LABELS[s]).join(", ")}
                </p>
                <pre className="whitespace-pre-wrap rounded bg-[var(--os-bg-muted)] p-3 text-sm font-sans">
                  {selected.body}
                </pre>
                {tab === "recibidos" ? (
                  <Button type="button" variant="secondary" onClick={() => void archiveSelected()}>
                    Archivar
                  </Button>
                ) : null}
                {tab === "archivados" ? (
                  <Button type="button" variant="secondary" onClick={() => void restoreSelected()}>
                    Restaurar
                  </Button>
                ) : null}
              </div>
            ) : (
              <p className="text-sm text-[var(--os-text-muted)]">Seleccioná un aviso.</p>
            )}
          </div>
        </div>
      </div>

      {composeOpen ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
          <div
            className="max-h-[90vh] w-full max-w-lg overflow-y-auto rounded-lg bg-[var(--os-surface,#fff)] p-4 shadow-xl"
            data-testid="avisos-compose-dialog"
          >
            <h3 className="mb-3 text-lg font-semibold">Nuevo aviso</h3>
            {schemaPending ? (
              <p className="mb-2 text-sm text-amber-800">
                Base de datos pendiente de actualización. Los cambios están deshabilitados.
              </p>
            ) : null}
            <label className="mb-2 block text-xs">
              Título
              <input
                className="mt-1 w-full rounded border px-2 py-1.5 text-sm"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                data-testid="aviso-title"
              />
            </label>
            <label className="mb-2 block text-xs">
              Mensaje
              <textarea
                className="mt-1 w-full rounded border px-2 py-1.5 text-sm"
                rows={5}
                value={body}
                onChange={(e) => setBody(e.target.value)}
                data-testid="aviso-body"
              />
            </label>
            <label className="mb-2 block text-xs">
              Prioridad
              <select
                className="mt-1 w-full rounded border px-2 py-1.5 text-sm"
                value={priority}
                onChange={(e) => setPriority(e.target.value as AvisoPriority)}
              >
                <option value="NORMAL">Normal</option>
                <option value="IMPORTANTE">Importante</option>
                <option value="URGENTE">Urgente</option>
              </select>
            </label>
            <label className="mb-2 flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={toAll}
                onChange={(e) => setToAll(e.target.checked)}
                data-testid="aviso-to-all"
              />
              Todos los sectores
            </label>
            {!toAll ? (
              <div className="mb-3 grid grid-cols-2 gap-1">
                {AVISO_PARTICIPANT_SECTORS.map((s) => (
                  <label key={s} className="flex items-center gap-1.5 text-xs">
                    <input
                      type="checkbox"
                      checked={toSectors.includes(s)}
                      onChange={() => toggleSector(s)}
                    />
                    {SECTOR_LABELS[s]}
                  </label>
                ))}
              </div>
            ) : null}
            <div className="flex justify-end gap-2">
              <Button type="button" variant="secondary" onClick={() => setComposeOpen(false)}>
                Cancelar
              </Button>
              <Button
                type="button"
                data-testid="aviso-send"
                onClick={() => setConfirmSend(true)}
                disabled={
                  schemaPending ||
                  !title.trim() ||
                  !body.trim() ||
                  (!toAll && toSectors.length === 0)
                }
              >
                Enviar
              </Button>
            </div>
          </div>
        </div>
      ) : null}

      <ConfirmDialog
        open={confirmSend}
        onOpenChange={setConfirmSend}
        title="¿Enviar aviso?"
        description="Se notificará a cada destinatario. No se puede suplantar otro sector."
        confirmLabel="Enviar"
        onConfirm={() => void doSend()}
      />
    </TwinShell>
  );
}
