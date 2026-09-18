"use client";

import { useCallback, useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import type { OrdersClientSession } from "@/lib/orders/orders-client";
import {
  createAsignacionLoteSourceApi,
  fetchAsignacionLoteSourcesApi,
  previewAsignacionLoteImportApi,
  syncAsignacionLoteSourceNowApi,
  testAsignacionLoteSourceConnectionApi,
  updateAsignacionLoteSourceApi,
} from "@/lib/asignacion-lotes/asignacion-lote-sources-client";
import type {
  AsignacionLoteSource,
  ImportPreviewResult,
  TestConnectionResult,
} from "@/lib/asignacion-lotes/source-types";

const CONTROL_CLASS =
  "w-full rounded-[var(--os-radius-sm)] border border-[var(--os-border)] bg-[var(--ig-control-bg,var(--os-surface))] px-3 py-2 text-sm text-[var(--ig-control-fg,var(--os-text))]";

function relativeTime(iso: string | null): string {
  if (!iso) return "nunca";
  const diffMs = Date.now() - new Date(iso).getTime();
  const seconds = Math.round(diffMs / 1000);
  if (seconds < 5) return "recién";
  if (seconds < 60) return `hace ${seconds} seg`;
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `hace ${minutes} min`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `hace ${hours} h`;
  return new Date(iso).toLocaleDateString("es-AR");
}

function statusDot(source: AsignacionLoteSource): string {
  if (!source.enabled) return "⚪";
  if (source.syncStatus === "error") return "🔴";
  if (source.syncStatus === "ok") return "🟢";
  return "⚪";
}

interface ConnectFormState {
  name: string;
  period: string;
  spreadsheetUrlOrId: string;
  sheetTab: string;
}

function emptyConnectForm(): ConnectFormState {
  return { name: "", period: "", spreadsheetUrlOrId: "", sheetTab: "" };
}

export function AsignacionLoteSourcesPanel({ session }: { session: OrdersClientSession }) {
  const [expanded, setExpanded] = useState(false);
  const [sources, setSources] = useState<AsignacionLoteSource[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [syncingId, setSyncingId] = useState<string | null>(null);

  const [connectOpen, setConnectOpen] = useState(false);
  const [form, setForm] = useState<ConnectFormState>(() => emptyConnectForm());
  const [testResult, setTestResult] = useState<TestConnectionResult | null>(null);
  const [testing, setTesting] = useState(false);
  const [connecting, setConnecting] = useState(false);
  const [connectError, setConnectError] = useState<string | null>(null);
  const [previewResult, setPreviewResult] = useState<ImportPreviewResult | null>(null);
  const [previewing, setPreviewing] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const list = await fetchAsignacionLoteSourcesApi(session);
      setSources(list);
    } catch (err) {
      setError(err instanceof Error ? err.message : "No se pudieron cargar las fuentes.");
    } finally {
      setLoading(false);
    }
  }, [session]);

  useEffect(() => {
    if (!expanded) return;
    const timer = window.setTimeout(() => {
      void load();
    }, 0);
    return () => window.clearTimeout(timer);
  }, [expanded, load]);

  async function handleTestConnection() {
    setTesting(true);
    setConnectError(null);
    try {
      const result = await testAsignacionLoteSourceConnectionApi(
        session,
        form.spreadsheetUrlOrId,
        form.sheetTab || undefined
      );
      setTestResult(result);
    } catch (err) {
      setConnectError(err instanceof Error ? err.message : "No se pudo probar la conexión.");
    } finally {
      setTesting(false);
    }
  }

  async function handlePreviewImport() {
    setPreviewing(true);
    setConnectError(null);
    try {
      const result = await previewAsignacionLoteImportApi(session, form.spreadsheetUrlOrId, form.sheetTab);
      setPreviewResult(result);
    } catch (err) {
      setConnectError(err instanceof Error ? err.message : "No se pudo calcular la vista previa de importación.");
    } finally {
      setPreviewing(false);
    }
  }

  async function handleConnect() {
    setConnecting(true);
    setConnectError(null);
    try {
      await createAsignacionLoteSourceApi(session, {
        name: form.name,
        period: form.period,
        spreadsheetUrlOrId: form.spreadsheetUrlOrId,
        sheetTab: form.sheetTab,
      });
      setConnectOpen(false);
      setForm(emptyConnectForm());
      setTestResult(null);
      setPreviewResult(null);
      await load();
    } catch (err) {
      setConnectError(err instanceof Error ? err.message : "No se pudo conectar la planilla.");
    } finally {
      setConnecting(false);
    }
  }

  async function handleSyncNow(id: string) {
    setSyncingId(id);
    try {
      await syncAsignacionLoteSourceNowApi(session, id);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "No se pudo sincronizar.");
    } finally {
      setSyncingId(null);
    }
  }

  async function handleToggleEnabled(source: AsignacionLoteSource) {
    try {
      await updateAsignacionLoteSourceApi(session, source.id, { enabled: !source.enabled });
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "No se pudo actualizar la fuente.");
    }
  }

  return (
    <div className="rounded-[var(--os-radius-md)] border border-[var(--os-border)] bg-[var(--os-surface)]">
      <button
        type="button"
        data-testid="asignacion-lote-sources-toggle"
        onClick={() => setExpanded((v) => !v)}
        className="flex w-full items-center justify-between px-4 py-3 text-left text-sm font-medium text-[var(--os-text)]"
      >
        <span>Fuentes / Sincronización (Google Sheets)</span>
        <span className="text-xs text-[var(--os-text-muted)]">{expanded ? "▲" : "▼"}</span>
      </button>

      {expanded ? (
        <div className="space-y-3 border-t border-[var(--os-border)] px-4 py-3" data-testid="asignacion-lote-sources-body">
          {error ? <p className="text-sm text-[var(--genus-error,#e85d5d)]">{error}</p> : null}
          {loading ? <p className="text-xs text-[var(--os-text-muted)]">Cargando fuentes…</p> : null}

          <ul className="space-y-2">
            {sources.map((source) => (
              <li
                key={source.id}
                data-testid={`asignacion-lote-source-${source.id}`}
                className="rounded-[var(--os-radius-sm)] border border-[var(--os-border)] px-3 py-2 text-sm"
              >
                <div className="flex items-center justify-between gap-2">
                  <span className="font-medium">
                    {statusDot(source)} {source.period ? `${source.period} · ` : ""}
                    {source.name}
                  </span>
                  <div className="flex items-center gap-2">
                    <Button
                      type="button"
                      size="sm"
                      variant="secondary"
                      disabled={syncingId === source.id || !source.enabled}
                      onClick={() => handleSyncNow(source.id)}
                      data-testid={`asignacion-lote-source-sync-${source.id}`}
                    >
                      {syncingId === source.id ? "Sincronizando…" : "Sincronizar ahora"}
                    </Button>
                    <Button
                      type="button"
                      size="sm"
                      variant="tertiary"
                      onClick={() => handleToggleEnabled(source)}
                      data-testid={`asignacion-lote-source-toggle-${source.id}`}
                    >
                      {source.enabled ? "Desactivar sincronización" : "Activar"}
                    </Button>
                  </div>
                </div>
                <p className="mt-1 text-xs text-[var(--os-text-muted)]">
                  Google Sheets · Última sincronización: {relativeTime(source.lastSyncAt)}
                  {source.syncStatus === "error" && source.lastError ? (
                    <span className="text-[var(--genus-error,#e85d5d)]"> — {source.lastError}</span>
                  ) : null}
                </p>
              </li>
            ))}
            {!loading && sources.length === 0 ? (
              <li className="text-xs text-[var(--os-text-muted)]">Todavía no hay fuentes conectadas.</li>
            ) : null}
          </ul>

          <Button type="button" size="sm" onClick={() => setConnectOpen(true)} data-testid="asignacion-lote-source-connect-open">
            + Conectar planilla
          </Button>
        </div>
      ) : null}

      <Dialog open={connectOpen} onOpenChange={setConnectOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Conectar planilla de Asignación de Lotes</DialogTitle>
            <DialogDescription>
              Se lee vía Google Sheets y se sincroniza a Neon — GENUS OS nunca consulta Google en cada pantalla.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div>
              <label className="mb-1 block text-xs text-[var(--os-text-muted)]">Nombre</label>
              <input
                className={CONTROL_CLASS}
                value={form.name}
                onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
                placeholder="Asignación de Lotes 2027"
                data-testid="asignacion-lote-source-name-input"
              />
            </div>
            <div>
              <label className="mb-1 block text-xs text-[var(--os-text-muted)]">Año / período</label>
              <input
                className={CONTROL_CLASS}
                value={form.period}
                onChange={(e) => setForm((f) => ({ ...f, period: e.target.value }))}
                placeholder="2027"
              />
            </div>
            <div>
              <label className="mb-1 block text-xs text-[var(--os-text-muted)]">URL de Google Sheet</label>
              <input
                className={CONTROL_CLASS}
                value={form.spreadsheetUrlOrId}
                onChange={(e) => {
                  setForm((f) => ({ ...f, spreadsheetUrlOrId: e.target.value }));
                  setTestResult(null);
                  setPreviewResult(null);
                }}
                placeholder="https://docs.google.com/spreadsheets/d/..."
                data-testid="asignacion-lote-source-url-input"
              />
            </div>
            <div>
              <label className="mb-1 block text-xs text-[var(--os-text-muted)]">Hoja específica (opcional)</label>
              <input
                className={CONTROL_CLASS}
                value={form.sheetTab}
                onChange={(e) => {
                  setForm((f) => ({ ...f, sheetTab: e.target.value }));
                  setPreviewResult(null);
                }}
                placeholder="LOTES"
                data-testid="asignacion-lote-source-sheet-tab-input"
              />
              <p className="mt-1 text-xs text-[var(--os-text-muted)]">
                Dejalo vacío para importar todas las hojas.
              </p>
            </div>

            <Button
              type="button"
              variant="secondary"
              size="sm"
              disabled={testing || !form.spreadsheetUrlOrId}
              onClick={handleTestConnection}
              data-testid="asignacion-lote-source-test-connection"
            >
              {testing ? "Probando…" : "Probar conexión"}
            </Button>

            {testResult ? (
              <div
                className={`rounded-[var(--os-radius-sm)] border px-3 py-2 text-xs ${
                  testResult.ok
                    ? "border-[var(--genus-success)]/30 text-[var(--genus-success)]"
                    : "border-[var(--genus-error)]/30 text-[var(--genus-error,#e85d5d)]"
                }`}
                data-testid="asignacion-lote-source-test-result"
              >
                {testResult.ok ? (
                  <>
                    <p>✓ Planilla accesible</p>
                    <p>✓ Hoja encontrada</p>
                    <p>
                      ✓ Encabezados reconocidos: {testResult.headersRecognized.join(", ") || "ninguno"}
                    </p>
                    <p>✓ {testResult.rowCount} filas detectadas</p>
                    {testResult.headersUnrecognized.length > 0 ? (
                      <p className="text-[var(--os-text-muted)]">
                        Sin reconocer: {testResult.headersUnrecognized.join(", ")}
                      </p>
                    ) : null}
                  </>
                ) : (
                  <p>{testResult.error ?? "No se pudo conectar."}</p>
                )}
              </div>
            ) : null}

            {testResult?.ok ? (
              <Button
                type="button"
                variant="secondary"
                size="sm"
                disabled={previewing}
                onClick={handlePreviewImport}
                data-testid="asignacion-lote-source-preview-import"
              >
                {previewing ? "Calculando…" : "Vista previa de importación"}
              </Button>
            ) : null}

            {previewResult ? (
              <div
                className={`rounded-[var(--os-radius-sm)] border px-3 py-2 text-xs ${
                  previewResult.ok
                    ? "border-[var(--os-teal)]/40 text-[var(--os-text)]"
                    : "border-[var(--genus-error)]/30 text-[var(--genus-error,#e85d5d)]"
                }`}
                data-testid="asignacion-lote-source-preview-result"
              >
                {previewResult.ok ? (
                  <>
                    <p className="font-medium">Antes de importar definitivamente:</p>
                    {previewResult.sheets ? (
                      <>
                        <p>
                          {previewResult.sheets.length} hojas encontradas ·{" "}
                          {previewResult.sheets.filter((s) => s.compatible).length} compatibles ·{" "}
                          {previewResult.sheets.filter((s) => !s.compatible).length} ignoradas
                        </p>
                        <ul className="mt-1 list-disc pl-4">
                          {previewResult.sheets.map((s) => (
                            <li key={s.tab}>
                              {s.compatible ? (
                                <>
                                  {s.tab}: {s.rowsFound} filas
                                </>
                              ) : (
                                <>
                                  ⚠ Hoja &quot;{s.tab}&quot; ignorada / Motivo: {s.ignoredReason}
                                </>
                              )}
                            </li>
                          ))}
                        </ul>
                      </>
                    ) : null}
                    <p>Filas encontradas: {previewResult.rowsFound}</p>
                    <p>Nuevas: {previewResult.nuevas}</p>
                    <p>Ya existentes (sin cambios): {previewResult.existentes}</p>
                    <p className={previewResult.conflictos > 0 ? "text-[var(--genus-error,#e85d5d)]" : ""}>
                      Conflictos (requieren revisión, nunca se fusionan solos): {previewResult.conflictos}
                    </p>
                    <p>Inválidas: {previewResult.invalidas}</p>
                    {previewResult.conflictSamples.length > 0 ? (
                      <ul className="mt-1 list-disc pl-4">
                        {previewResult.conflictSamples.slice(0, 5).map((c, i) => (
                          <li key={`${c.lote}-${c.codigo}-${i}`}>
                            Lote {c.lote || "—"} · {c.producto} — {c.motivo}
                          </li>
                        ))}
                      </ul>
                    ) : null}
                  </>
                ) : (
                  <p>{previewResult.error ?? "No se pudo calcular la vista previa."}</p>
                )}
              </div>
            ) : null}

            {connectError ? <p className="text-xs text-[var(--genus-error,#e85d5d)]">{connectError}</p> : null}
          </div>
          <DialogFooter>
            <Button type="button" variant="tertiary" onClick={() => setConnectOpen(false)}>
              Cancelar
            </Button>
            <Button
              type="button"
              disabled={
                connecting ||
                !form.name.trim() ||
                !form.spreadsheetUrlOrId.trim() ||
                !previewResult?.ok
              }
              onClick={handleConnect}
              data-testid="asignacion-lote-source-connect-submit"
            >
              {connecting ? "Conectando…" : "Conectar"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
