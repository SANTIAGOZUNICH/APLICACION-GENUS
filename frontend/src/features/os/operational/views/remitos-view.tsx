"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { TwinShell } from "@/features/os/shell/twin-shell";
import { Button } from "@/components/ui/button";
import { SchemaPendingBanner } from "@/components/ui/schema-pending-banner";
import { usePreviewSession } from "@/features/os/session/preview-context";
import {
  editGeneratedRemitoApi,
  fetchRemitoPreviewHtmlApi,
  fetchRemitosApi,
  generateRemitoApi,
  remitoActionApi,
  renameRemitoApi,
  triggerRemitoDownload,
  updateRemitoDraftApi,
} from "@/lib/remitos/remitos-client";
import { formatLoteVtoCell, lineTotalUnitsFromCajas } from "@/lib/remitos/line-qty";
import {
  canAccessRemitos,
  type RemitoCajaCombo,
  type RemitoLine,
  type RemitoRecord,
  type RemitoTab,
} from "@/lib/remitos/types";

const TABS: { id: RemitoTab; label: string }[] = [
  { id: "borradores", label: "Borradores" },
  { id: "generados", label: "Generados" },
  { id: "anulados", label: "Anulados" },
];

function normalizeDraftLine(l: RemitoLine): RemitoLine {
  return {
    ...l,
    cajas3: l.cajas3 ?? 0,
    unidades3: l.unidades3 ?? 0,
    extraCajas: [...(l.extraCajas ?? [])],
  };
}

function withAutoTotal(line: RemitoLine): RemitoLine {
  const total = lineTotalUnitsFromCajas(line);
  return { ...line, totalUnits: total > 0 ? total : line.totalUnits };
}

function formatCajasSummary(l: RemitoLine): string {
  const parts = [
    `${l.cajas1 || 0}×${l.unidades1 || 0}`,
    `${l.cajas2 || 0}×${l.unidades2 || 0}`,
    `${l.cajas3 || 0}×${l.unidades3 || 0}`,
  ];
  for (const e of l.extraCajas ?? []) {
    parts.push(`${e.cajas}×${e.unidades}`);
  }
  return parts.join(" / ");
}

type ModalKind =
  | null
  | "generate"
  | "edit-draft"
  | "edit-generated"
  | "rename"
  | "versions"
  | "preview";

export function RemitosView({ initialRemitoId }: { initialRemitoId?: string } = {}) {
  const { email, sectorId } = usePreviewSession();
  const session = useMemo(
    () => ({ email: email ?? "", sector: sectorId }),
    [email, sectorId]
  );
  const allowed = canAccessRemitos(sectorId);
  const [tab, setTab] = useState<RemitoTab>("borradores");
  const [q, setQ] = useState("");
  const [items, setItems] = useState<RemitoRecord[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [schemaPending, setSchemaPending] = useState(false);
  const [selected, setSelected] = useState<RemitoRecord | null>(null);
  const [busy, setBusy] = useState(false);
  const [modal, setModal] = useState<ModalKind>(null);
  const [displayNameInput, setDisplayNameInput] = useState("");
  const [motivoInput, setMotivoInput] = useState("");
  const [draftLines, setDraftLines] = useState<RemitoLine[]>([]);
  const [draftClient, setDraftClient] = useState("");
  const [draftDate, setDraftDate] = useState("");
  const [previewHtml, setPreviewHtml] = useState<string | null>(null);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [downloadBusy, setDownloadBusy] = useState<"pdf" | "xlsx" | null>(null);

  const reload = useCallback(async () => {
    if (!allowed) return;
    try {
      const { remitos, schemaPending: pending } = await fetchRemitosApi(session, {
        tab,
        q,
      });
      setItems(remitos);
      setSchemaPending(pending);
      setError(null);
      if (initialRemitoId) {
        const found = remitos.find((r) => r.id === initialRemitoId);
        if (found) setSelected(found);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Error al cargar remitos");
    }
  }, [allowed, session, tab, q, initialRemitoId]);

  useEffect(() => {
    void reload();
  }, [reload]);

  function closeModal() {
    setModal(null);
    setPreviewHtml(null);
    setPreviewLoading(false);
  }

  async function openPreview(r: RemitoRecord) {
    setSelected(r);
    setModal("preview");
    setError(null);
    setPreviewHtml(null);
    setPreviewLoading(true);
    try {
      const html = await fetchRemitoPreviewHtmlApi(session, r.id);
      setPreviewHtml(html);
    } catch (e) {
      setError(e instanceof Error ? e.message : "No se pudo previsualizar el remito");
    } finally {
      setPreviewLoading(false);
    }
  }

  async function downloadSelected(format: "pdf" | "xlsx", version?: number) {
    if (!selected) return;
    setDownloadBusy(format);
    setError(null);
    try {
      await triggerRemitoDownload(session, selected.id, format, {
        version,
        filename: selected.displayName
          ? `${selected.displayName}.${format}`
          : undefined,
      });
    } catch (e) {
      setError(e instanceof Error ? e.message : "Descarga falló");
    } finally {
      setDownloadBusy(null);
    }
  }

  function openEditDraft(r: RemitoRecord) {
    setSelected(r);
    setDraftLines(r.lines.map((l) => normalizeDraftLine(l)));
    setDraftClient(r.clientDisplay);
    setDraftDate(r.deliveryDate);
    setModal("edit-draft");
  }

  function openGenerate(r: RemitoRecord) {
    setSelected(r);
    setDisplayNameInput(r.displayName || r.clientDisplay || "");
    setModal("generate");
  }

  function openEditGenerated(r: RemitoRecord) {
    setSelected(r);
    setMotivoInput("");
    setDraftLines(r.lines.map((l) => normalizeDraftLine(l)));
    setDraftClient(r.clientDisplay);
    setDraftDate(r.deliveryDate);
    setModal("edit-generated");
  }

  function updateDraftLine(idx: number, patch: Partial<RemitoLine>) {
    setDraftLines((prev) => {
      const next = [...prev];
      const cur = next[idx];
      if (!cur) return prev;
      next[idx] = withAutoTotal({ ...cur, ...patch });
      return next;
    });
  }

  async function submitGenerate() {
    if (!selected) return;
    setBusy(true);
    try {
      const remito = await generateRemitoApi(session, selected.id, {
        displayName: displayNameInput,
      });
      setSelected(remito);
      setModal(null);
      void reload();
    } catch (e) {
      setError(e instanceof Error ? e.message : "No se pudo generar");
    } finally {
      setBusy(false);
    }
  }

  async function submitEditDraft() {
    if (!selected) return;
    setBusy(true);
    try {
      const remito = await updateRemitoDraftApi(session, selected.id, {
        clientDisplay: draftClient,
        deliveryDate: draftDate,
        lines: draftLines.map((l) => ({
          id: l.id,
          product: l.product,
          lote: l.lote,
          vto: l.vto,
          totalUnits: l.totalUnits,
          cajas1: l.cajas1,
          unidades1: l.unidades1,
          cajas2: l.cajas2,
          unidades2: l.unidades2,
          cajas3: l.cajas3 ?? 0,
          unidades3: l.unidades3 ?? 0,
          extraCajas: l.extraCajas ?? [],
        })),
      });
      setSelected(remito);
      setModal(null);
      void reload();
    } catch (e) {
      setError(e instanceof Error ? e.message : "No se pudo guardar borrador");
    } finally {
      setBusy(false);
    }
  }

  async function submitEditGenerated() {
    if (!selected) return;
    setBusy(true);
    try {
      const remito = await editGeneratedRemitoApi(session, selected.id, {
        motivo: motivoInput,
        clientDisplay: draftClient,
        deliveryDate: draftDate,
        lines: draftLines.map((l) => ({
          id: l.id,
          product: l.product,
          lote: l.lote,
          vto: l.vto,
          totalUnits: l.totalUnits,
          cajas1: l.cajas1,
          unidades1: l.unidades1,
          cajas2: l.cajas2,
          unidades2: l.unidades2,
          cajas3: l.cajas3 ?? 0,
          unidades3: l.unidades3 ?? 0,
          extraCajas: l.extraCajas ?? [],
        })),
      });
      setSelected(remito);
      setModal(null);
      void reload();
    } catch (e) {
      setError(e instanceof Error ? e.message : "No se pudo editar versión");
    } finally {
      setBusy(false);
    }
  }

  async function submitRename() {
    if (!selected) return;
    setBusy(true);
    try {
      const remito = await renameRemitoApi(session, selected.id, displayNameInput);
      setSelected(remito);
      setModal(null);
      void reload();
    } catch (e) {
      setError(e instanceof Error ? e.message : "No se pudo renombrar");
    } finally {
      setBusy(false);
    }
  }

  async function runAction(action: string, id: string) {
    setBusy(true);
    try {
      const remito = await remitoActionApi(session, action, id);
      setSelected(remito);
      void reload();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Acción falló");
    } finally {
      setBusy(false);
    }
  }

  if (!allowed) {
    return (
      <TwinShell title="Remitos">
        <div className="p-4 text-sm text-[var(--os-text-muted)]" data-testid="remitos-denied">
          Solo el sector Producción puede acceder a Remitos.
        </div>
      </TwinShell>
    );
  }

  return (
    <TwinShell title="Remitos">
      <div className="space-y-4 p-4" data-testid="remitos-view">
        <SchemaPendingBanner show={schemaPending} />
        <div className="flex flex-wrap items-center gap-2">
          {TABS.map((t) => (
            <button
              key={t.id}
              type="button"
              data-testid={`remitos-tab-${t.id}`}
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
            placeholder="Nombre, n°, cliente, producto, lote, vto, fecha…"
            className="ml-auto min-w-[220px] rounded border border-[var(--os-border)] px-2 py-1.5 text-sm"
            data-testid="remitos-search"
          />
        </div>

        {error ? (
          <p className="rounded border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-950">
            {error}
          </p>
        ) : null}

        <div className="grid gap-3 lg:grid-cols-2">
          <div className="overflow-x-auto rounded border border-[var(--os-border)] bg-[var(--os-surface)]">
            <table className="w-full text-left text-sm" data-testid="remitos-table">
              <thead className="border-b border-[var(--os-border)] text-xs text-[var(--os-text-muted)]">
                <tr>
                  <th className="px-3 py-2">Nombre</th>
                  <th className="px-3 py-2">N° int.</th>
                  <th className="px-3 py-2">Cliente</th>
                  <th className="px-3 py-2">Prod.</th>
                  <th className="px-3 py-2">Totales</th>
                  <th className="px-3 py-2">Ver.</th>
                  <th className="px-3 py-2">Estado</th>
                  <th className="px-3 py-2">Actor</th>
                </tr>
              </thead>
              <tbody>
                {items.length === 0 ? (
                  <tr>
                    <td colSpan={8} className="px-3 py-6 text-[var(--os-text-muted)]">
                      Sin remitos.
                    </td>
                  </tr>
                ) : (
                  items.map((r) => (
                    <tr
                      key={r.id}
                      className="cursor-pointer border-b border-[var(--os-border)] hover:bg-[var(--os-bg-muted)]"
                      onClick={() => setSelected(r)}
                      data-testid={`remito-row-${r.id}`}
                    >
                      <td className="px-3 py-2 font-medium">
                        {r.displayName || "—"}
                      </td>
                      <td className="px-3 py-2 font-mono text-xs">
                        {r.remitoNumber || "—"}
                      </td>
                      <td className="px-3 py-2">{r.clientDisplay}</td>
                      <td className="px-3 py-2">{r.lines.length}</td>
                      <td className="px-3 py-2 text-xs">
                        {r.totalUnits}u · {r.totalCajas}c
                      </td>
                      <td className="px-3 py-2">v{r.version}</td>
                      <td className="px-3 py-2 text-xs uppercase">{r.status}</td>
                      <td className="px-3 py-2 text-xs">
                        {r.generatedBy || r.updatedBy || r.createdBy || "—"}
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>

          <div className="rounded border border-[var(--os-border)] bg-[var(--os-surface)] p-3">
            {selected ? (
              <div className="space-y-3" data-testid="remito-detail">
                <h2 className="text-base font-semibold">
                  {selected.displayName || "Sin nombre"} ·{" "}
                  {selected.remitoNumber ?? "Borrador"}
                </h2>
                <p className="text-xs text-[var(--os-text-muted)]">
                  {selected.clientDisplay} · Entrega {selected.deliveryDate} · v
                  {selected.version} · {selected.status} · {selected.totalUnits} u ·{" "}
                  {selected.totalCajas} cajas ·{" "}
                  {selected.generatedBy || selected.updatedBy || selected.createdBy}
                </p>
                {selected.offersNewVersion ? (
                  <p className="rounded border border-amber-200 bg-amber-50 px-2 py-1 text-xs">
                    Remito generado inmutable — hay aprobaciones nuevas. Creá una nueva
                    versión.
                  </p>
                ) : null}
                <ul className="max-h-48 space-y-1 overflow-y-auto text-xs">
                  {selected.lines.map((l) => (
                    <li key={l.id} className="rounded border border-[var(--os-border)] px-2 py-1">
                      {l.totalUnits} · {l.product} · {formatLoteVtoCell(l.lote, l.vto)} ·{" "}
                      {formatCajasSummary(l)}
                    </li>
                  ))}
                </ul>
                <div className="flex flex-wrap gap-2">
                  <Button
                    type="button"
                    variant="secondary"
                    disabled={busy || previewLoading}
                    onClick={() => void openPreview(selected)}
                    data-testid="remito-preview"
                  >
                    Vista previa
                  </Button>
                  {selected.status === "BORRADOR" ? (
                    <>
                      <Button
                        type="button"
                        variant="secondary"
                        disabled={busy || schemaPending}
                        onClick={() => openEditDraft(selected)}
                        data-testid="remito-edit-draft"
                      >
                        Editar
                      </Button>
                      <Button
                        type="button"
                        disabled={busy || schemaPending}
                        onClick={() => openGenerate(selected)}
                        data-testid="remito-generate"
                      >
                        Generar
                      </Button>
                    </>
                  ) : null}
                  {selected.status === "GENERADO" ? (
                    <>
                      <Button
                        type="button"
                        variant="secondary"
                        disabled={busy || schemaPending}
                        onClick={() => openEditGenerated(selected)}
                        data-testid="remito-edit-generated"
                      >
                        Editar
                      </Button>
                      <Button
                        type="button"
                        variant="secondary"
                        disabled={busy || downloadBusy !== null}
                        onClick={() => void downloadSelected("xlsx")}
                        data-testid="remito-dl-xlsx"
                      >
                        {downloadBusy === "xlsx" ? "Descargando…" : "Descargar XLSX"}
                      </Button>
                      {(selected.versions ?? []).some((v) => v.driveFileIdPdf) ? (
                        <Button
                          type="button"
                          variant="secondary"
                          disabled={busy || downloadBusy !== null}
                          onClick={() => void downloadSelected("pdf")}
                          data-testid="remito-dl-pdf"
                        >
                          {downloadBusy === "pdf" ? "Descargando…" : "Descargar PDF (legacy)"}
                        </Button>
                      ) : null}
                      <Button
                        type="button"
                        variant="secondary"
                        onClick={() => setModal("versions")}
                        data-testid="remito-versions"
                      >
                        Ver versiones
                      </Button>
                      <Button
                        type="button"
                        variant="secondary"
                        disabled={busy}
                        onClick={() => {
                          setDisplayNameInput(selected.displayName || "");
                          setModal("rename");
                        }}
                        data-testid="remito-rename"
                      >
                        Renombrar
                      </Button>
                      <Button
                        type="button"
                        variant="secondary"
                        disabled={busy}
                        onClick={() => void runAction("annul", selected.id)}
                      >
                        Anular
                      </Button>
                      <Button
                        type="button"
                        variant="secondary"
                        disabled={busy}
                        onClick={() => void runAction("archive", selected.id)}
                      >
                        Archivar
                      </Button>
                    </>
                  ) : null}
                </div>
              </div>
            ) : (
              <p className="text-sm text-[var(--os-text-muted)]">
                Seleccioná un remito para ver detalle y acciones.
              </p>
            )}
          </div>
        </div>

        {modal && selected ? (
          <div
            className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
            data-testid="remito-modal"
          >
            <div className="max-h-[90vh] w-full max-w-lg overflow-y-auto rounded border border-[var(--os-border)] bg-[var(--os-surface)] p-4 shadow-lg data-[wide=true]:max-w-3xl" data-wide={modal === "preview" || modal === "edit-draft" || modal === "edit-generated" ? "true" : "false"}>
              {modal === "generate" ? (
                <div className="space-y-3">
                  <h3 className="font-semibold">Generar remito</h3>
                  <p className="text-sm text-[var(--os-text-muted)]">
                    Elegí el nombre que verá Producción. El n° interno se asigna al
                    generar.
                  </p>
                  <label className="block text-sm">
                    Nombre
                    <input
                      className="mt-1 w-full rounded border border-[var(--os-border)] px-2 py-1.5"
                      value={displayNameInput}
                      onChange={(e) => setDisplayNameInput(e.target.value)}
                      data-testid="remito-display-name-input"
                    />
                  </label>
                  <div className="flex justify-end gap-2">
                    <Button type="button" variant="secondary" onClick={closeModal}>
                      Cancelar
                    </Button>
                    <Button
                      type="button"
                      disabled={busy || !displayNameInput.trim()}
                      onClick={() => void submitGenerate()}
                      data-testid="remito-generate-confirm"
                    >
                      Generar
                    </Button>
                  </div>
                </div>
              ) : null}

              {modal === "rename" ? (
                <div className="space-y-3">
                  <h3 className="font-semibold">Renombrar</h3>
                  <input
                    className="w-full rounded border border-[var(--os-border)] px-2 py-1.5"
                    value={displayNameInput}
                    onChange={(e) => setDisplayNameInput(e.target.value)}
                    data-testid="remito-rename-input"
                  />
                  <div className="flex justify-end gap-2">
                    <Button type="button" variant="secondary" onClick={closeModal}>
                      Cancelar
                    </Button>
                    <Button
                      type="button"
                      disabled={busy || !displayNameInput.trim()}
                      onClick={() => void submitRename()}
                    >
                      Guardar
                    </Button>
                  </div>
                </div>
              ) : null}

              {modal === "edit-draft" || modal === "edit-generated" ? (
                <div className="space-y-3">
                  <h3 className="font-semibold">
                    {modal === "edit-draft" ? "Editar borrador" : "Editar generado (nueva versión)"}
                  </h3>
                  {modal === "edit-generated" ? (
                    <label className="block text-sm">
                      Motivo (obligatorio)
                      <input
                        className="mt-1 w-full rounded border border-[var(--os-border)] px-2 py-1.5"
                        value={motivoInput}
                        onChange={(e) => setMotivoInput(e.target.value)}
                        data-testid="remito-motivo-input"
                      />
                    </label>
                  ) : null}
                  <label className="block text-sm">
                    Cliente
                    <input
                      className="mt-1 w-full rounded border border-[var(--os-border)] px-2 py-1.5"
                      value={draftClient}
                      onChange={(e) => setDraftClient(e.target.value)}
                    />
                  </label>
                  <label className="block text-sm">
                    Fecha entrega
                    <input
                      type="date"
                      className="mt-1 w-full rounded border border-[var(--os-border)] px-2 py-1.5"
                      value={draftDate}
                      onChange={(e) => setDraftDate(e.target.value)}
                    />
                  </label>
                  <div className="space-y-3">
                    {draftLines.map((l, idx) => (
                      <div
                        key={l.id}
                        className="space-y-2 rounded border border-[var(--os-border)] p-3 text-xs"
                        data-testid={`remito-line-editor-${idx}`}
                      >
                        <div className="grid grid-cols-2 gap-2">
                          <label className="block">
                            Producto
                            <input
                              className="mt-0.5 w-full rounded border border-[var(--os-border)] px-2 py-1"
                              value={l.product}
                              onChange={(e) => updateDraftLine(idx, { product: e.target.value })}
                            />
                          </label>
                          <label className="block">
                            Total unidades (auto)
                            <input
                              className="mt-0.5 w-full rounded border border-[var(--os-border)] px-2 py-1"
                              value={l.totalUnits}
                              type="number"
                              readOnly
                              data-testid={`remito-line-total-${idx}`}
                            />
                          </label>
                          <label className="block">
                            Lote
                            <input
                              className="mt-0.5 w-full rounded border border-[var(--os-border)] px-2 py-1"
                              value={l.lote}
                              onChange={(e) => updateDraftLine(idx, { lote: e.target.value })}
                            />
                          </label>
                          <label className="block">
                            VTO
                            <input
                              className="mt-0.5 w-full rounded border border-[var(--os-border)] px-2 py-1"
                              value={l.vto}
                              onChange={(e) => updateDraftLine(idx, { vto: e.target.value })}
                            />
                          </label>
                        </div>
                        <p className="text-[var(--os-text-muted)]">
                          {formatLoteVtoCell(l.lote, l.vto)}
                        </p>
                        {(
                          [
                            { label: "Cajas 1", cajasKey: "cajas1", unidadesKey: "unidades1" },
                            { label: "Cajas 2", cajasKey: "cajas2", unidadesKey: "unidades2" },
                            { label: "Cajas 3", cajasKey: "cajas3", unidadesKey: "unidades3" },
                          ] as const
                        ).map((slot) => (
                          <div
                            key={slot.label}
                            className="flex flex-wrap items-center gap-2"
                          >
                            <span className="w-16 shrink-0 font-medium">{slot.label}:</span>
                            <input
                              type="number"
                              min={0}
                              className="w-20 rounded border border-[var(--os-border)] px-2 py-1"
                              value={l[slot.cajasKey] ?? 0}
                              onChange={(e) =>
                                updateDraftLine(idx, {
                                  [slot.cajasKey]: Math.max(0, Math.floor(Number(e.target.value) || 0)),
                                })
                              }
                              aria-label={`${slot.label} cantidad`}
                            />
                            <span>×</span>
                            <input
                              type="number"
                              min={0}
                              className="w-20 rounded border border-[var(--os-border)] px-2 py-1"
                              value={l[slot.unidadesKey] ?? 0}
                              onChange={(e) =>
                                updateDraftLine(idx, {
                                  [slot.unidadesKey]: Math.max(
                                    0,
                                    Math.floor(Number(e.target.value) || 0)
                                  ),
                                })
                              }
                              aria-label={`${slot.label} unidades por caja`}
                            />
                          </div>
                        ))}
                        {(l.extraCajas ?? []).map((extra, ei) => (
                          <div
                            key={`extra-${ei}`}
                            className="flex flex-wrap items-center gap-2 rounded border border-dashed border-[var(--os-border)] bg-[var(--os-bg)] px-2 py-1"
                            data-testid={`remito-line-extra-${idx}-${ei}`}
                          >
                            <span className="w-16 shrink-0 font-medium">Extra {ei + 1}:</span>
                            <input
                              type="number"
                              min={0}
                              className="w-20 rounded border border-[var(--os-border)] px-2 py-1"
                              value={extra.cajas}
                              onChange={(e) => {
                                const extras = [...(l.extraCajas ?? [])];
                                extras[ei] = {
                                  ...extra,
                                  cajas: Math.max(0, Math.floor(Number(e.target.value) || 0)),
                                };
                                updateDraftLine(idx, { extraCajas: extras });
                              }}
                            />
                            <span>×</span>
                            <input
                              type="number"
                              min={0}
                              className="w-20 rounded border border-[var(--os-border)] px-2 py-1"
                              value={extra.unidades}
                              onChange={(e) => {
                                const extras = [...(l.extraCajas ?? [])];
                                extras[ei] = {
                                  ...extra,
                                  unidades: Math.max(0, Math.floor(Number(e.target.value) || 0)),
                                };
                                updateDraftLine(idx, { extraCajas: extras });
                              }}
                            />
                            <button
                              type="button"
                              className="underline"
                              onClick={() => {
                                const extras = (l.extraCajas ?? []).filter((_, i) => i !== ei);
                                updateDraftLine(idx, { extraCajas: extras });
                              }}
                            >
                              Quitar
                            </button>
                          </div>
                        ))}
                        <button
                          type="button"
                          className="underline"
                          data-testid={`remito-add-caja-${idx}`}
                          onClick={() => {
                            const extras: RemitoCajaCombo[] = [
                              ...(l.extraCajas ?? []),
                              { cajas: 0, unidades: 0 },
                            ];
                            updateDraftLine(idx, { extraCajas: extras });
                          }}
                        >
                          Agregar otro tipo de caja
                        </button>
                      </div>
                    ))}
                  </div>
                  <div className="flex justify-end gap-2">
                    <Button type="button" variant="secondary" onClick={closeModal}>
                      Cancelar
                    </Button>
                    <Button
                      type="button"
                      disabled={
                        busy ||
                        (modal === "edit-generated" && !motivoInput.trim())
                      }
                      onClick={() =>
                        void (modal === "edit-draft"
                          ? submitEditDraft()
                          : submitEditGenerated())
                      }
                      data-testid="remito-edit-confirm"
                    >
                      Guardar
                    </Button>
                  </div>
                </div>
              ) : null}

              {modal === "versions" ? (
                <div className="space-y-3">
                  <h3 className="font-semibold">Versiones</h3>
                  <ul className="space-y-2 text-sm">
                    {(selected.versions ?? []).length === 0 ? (
                      <li className="text-[var(--os-text-muted)]">Sin versiones.</li>
                    ) : (
                      (selected.versions ?? []).map((v) => (
                        <li
                          key={v.version}
                          className="rounded border border-[var(--os-border)] px-2 py-2"
                        >
                          <div className="font-medium">
                            v{v.version}
                            {v.motivo ? ` · ${v.motivo}` : ""}
                          </div>
                          <div className="text-xs text-[var(--os-text-muted)]">
                            {v.createdBy} · {v.createdAt}
                          </div>
                          {v.downloadable ? (
                            <div className="mt-1 flex gap-2 text-xs">
                              {v.driveFileIdPdf ? (
                                <button
                                  type="button"
                                  className="underline disabled:opacity-50"
                                  disabled={downloadBusy !== null}
                                  data-testid={`remito-version-dl-pdf-${v.version}`}
                                  onClick={() => void downloadSelected("pdf", v.version)}
                                >
                                  PDF
                                </button>
                              ) : null}
                              <button
                                type="button"
                                className="underline disabled:opacity-50"
                                disabled={downloadBusy !== null}
                                data-testid={`remito-version-dl-xlsx-${v.version}`}
                                onClick={() => void downloadSelected("xlsx", v.version)}
                              >
                                XLSX
                              </button>
                            </div>
                          ) : null}
                        </li>
                      ))
                    )}
                  </ul>
                  <div className="flex justify-end">
                    <Button type="button" variant="secondary" onClick={closeModal}>
                      Cerrar
                    </Button>
                  </div>
                </div>
              ) : null}

              {modal === "preview" ? (
                <div className="space-y-3" data-testid="remito-preview-modal">
                  <h3 className="font-semibold">Vista previa (Excel)</h3>
                  <p className="text-sm">
                    {selected.displayName || "Sin nombre"} · {selected.clientDisplay} ·{" "}
                    {selected.deliveryDate}
                  </p>
                  {previewLoading ? (
                    <p className="text-sm text-[var(--os-text-muted)]">Cargando vista previa…</p>
                  ) : previewHtml ? (
                    <div
                      className="rounded border border-[var(--os-border)]"
                      dangerouslySetInnerHTML={{ __html: previewHtml }}
                      data-testid="remito-preview-xlsx"
                    />
                  ) : (
                    <p className="text-sm text-rose-700">
                      No se pudo cargar la vista previa. Revisá el mensaje de error arriba.
                    </p>
                  )}
                  <div className="flex flex-wrap justify-end gap-2">
                    {selected.status === "GENERADO" ? (
                      <Button
                        type="button"
                        variant="secondary"
                        disabled={downloadBusy !== null}
                        onClick={() => void downloadSelected("xlsx")}
                        data-testid="remito-preview-dl-xlsx"
                      >
                        Descargar XLSX
                      </Button>
                    ) : null}
                    <Button type="button" variant="secondary" onClick={closeModal}>
                      Cerrar
                    </Button>
                  </div>
                </div>
              ) : null}
            </div>
          </div>
        ) : null}
      </div>
    </TwinShell>
  );
}
