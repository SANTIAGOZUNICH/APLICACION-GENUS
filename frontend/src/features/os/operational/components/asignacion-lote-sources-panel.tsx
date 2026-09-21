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
  SyncRunSummary,
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

/**
 * Resumen REAL post-sincronización (hotfix sección 6/7) — nunca "sincronización
 * exitosa" a secas: siempre muestra qué pasó con cada fila leída, y si la
 * reconciliación no cerró, lo dice explícitamente en vez de afirmar éxito.
 */
function SyncResultSummary({
  run,
  detailOpen,
  onToggleDetail,
}: {
  run: SyncRunSummary;
  detailOpen: boolean;
  onToggleDetail: () => void;
}) {
  const hasProblems = run.invalidCount > 0 || run.conflictCount > 0;
  const headline =
    run.status === "inconsistente"
      ? "🔴 SINCRONIZACIÓN INCONSISTENTE"
      : run.status === "error"
        ? "🔴 SINCRONIZACIÓN FALLIDA"
        : hasProblems
          ? "⚠ SINCRONIZACIÓN COMPLETADA CON AVISOS"
          : "✓ SINCRONIZACIÓN COMPLETADA";

  return (
    <div
      className={`mt-2 rounded-[var(--os-radius-sm)] border px-3 py-2 text-xs ${
        run.status === "inconsistente" || run.status === "error"
          ? "border-[var(--genus-error)]/40 text-[var(--genus-error,#e85d5d)]"
          : hasProblems
            ? "border-[var(--os-teal)]/40 text-[var(--os-text)]"
            : "border-[var(--genus-success,#2f9e6e)]/40 text-[var(--os-text)]"
      }`}
      data-testid={`asignacion-lote-source-sync-result-${run.sourceId}`}
    >
      <p className="font-semibold">{headline}</p>
      <p>{run.rowsRead} fila(s) de datos leídas</p>
      <p>+ {run.createdCount} nuevas</p>
      <p>↻ {run.updatedCount} actualizadas</p>
      <p>= {run.unchangedCount} sin cambios</p>
      {run.conflictCount > 0 ? <p>⚠ {run.conflictCount} requieren revisión (conflicto)</p> : null}
      {run.invalidCount > 0 ? <p>✕ {run.invalidCount} inválidas</p> : null}
      {run.auxiliaryCount > 0 ? <p>{run.auxiliaryCount} fila(s) auxiliar(es) ignorada(s) (sin N° lote, no son asignaciones)</p> : null}
      {run.duplicateCount > 0 ? <p>{run.duplicateCount} fila(s) repetida(s) idénticas — no se re-escriben</p> : null}
      {run.archivedCount > 0 ? <p>{run.archivedCount} archivada(s) (ya no están en la fuente)</p> : null}
      {!run.reconciled ? (
        <p className="font-semibold">{run.errorMessage}</p>
      ) : null}

      {(run.conflictSamples.length > 0 || run.invalidSamples.length > 0) ? (
        <>
          <button
            type="button"
            onClick={onToggleDetail}
            className="mt-1 font-medium underline"
            data-testid={`asignacion-lote-source-sync-detail-toggle-${run.sourceId}`}
          >
            {detailOpen ? "Ocultar detalle" : "[ VER DETALLE ]"}
          </button>
          {detailOpen ? (
            <div className="mt-1 space-y-2" data-testid={`asignacion-lote-source-sync-detail-${run.sourceId}`}>
              {run.conflictSamples.length > 0 ? (
                <div>
                  <p className="font-medium">Conflictos:</p>
                  <ul className="list-disc pl-4">
                    {run.conflictSamples.map((c, i) => (
                      <li key={`${c.lote}-${c.codigo}-${i}`}>
                        Lote {c.lote || "—"} · {c.producto} — {c.motivo}
                      </li>
                    ))}
                  </ul>
                </div>
              ) : null}
              {run.invalidSamples.length > 0 ? (
                <div>
                  <p className="font-medium">Inválidas:</p>
                  <ul className="list-disc pl-4">
                    {run.invalidSamples.map((s, i) => (
                      <li key={`${s.tab}-${s.rowIndex}-${i}`}>
                        {s.tab} · fila {s.rowIndex} · Lote {s.lote || "—"} — {s.motivo}
                      </li>
                    ))}
                  </ul>
                </div>
              ) : null}
            </div>
          ) : null}
        </>
      ) : null}
    </div>
  );
}

export function AsignacionLoteSourcesPanel({ session }: { session: OrdersClientSession }) {
  const [expanded, setExpanded] = useState(false);
  const [sources, setSources] = useState<AsignacionLoteSource[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [syncingId, setSyncingId] = useState<string | null>(null);
  const [syncResults, setSyncResults] = useState<Record<string, SyncRunSummary>>({});
  const [syncDetailOpenFor, setSyncDetailOpenFor] = useState<string | null>(null);

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
      const run = await syncAsignacionLoteSourceNowApi(session, id);
      setSyncResults((prev) => ({ ...prev, [id]: run }));
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
                {syncResults[source.id] ? (
                  <SyncResultSummary
                    run={syncResults[source.id]!}
                    detailOpen={syncDetailOpenFor === source.id}
                    onToggleDetail={() =>
                      setSyncDetailOpenFor((cur) => (cur === source.id ? null : source.id))
                    }
                  />
                ) : null}
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
              <label className="mb-1 block text-xs text-[var(--os-text-muted)]">Hoja (tab)</label>
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
                Una fuente = una hoja específica del spreadsheet.
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
                disabled={previewing || !form.sheetTab.trim()}
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
                    <p>Filas encontradas: {previewResult.rowsFound}</p>
                    <p>Nuevas: {previewResult.nuevas}</p>
                    <p>Ya existentes (sin cambios): {previewResult.existentes}</p>
                    <p className={previewResult.conflictos > 0 ? "text-[var(--genus-error,#e85d5d)]" : ""}>
                      Conflictos (requieren revisión, nunca se fusionan solos): {previewResult.conflictos}
                    </p>
                    <p>Inválidas: {previewResult.invalidas}</p>
                    {previewResult.auxiliares > 0 ? (
                      <p>Auxiliares ignoradas (sin N° lote, no son asignaciones): {previewResult.auxiliares}</p>
                    ) : null}
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
                !form.sheetTab.trim() ||
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
