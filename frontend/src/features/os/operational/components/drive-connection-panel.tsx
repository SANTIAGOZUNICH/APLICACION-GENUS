"use client";

/**
 * «Conexión con Google Drive» (módulo de fórmulas, solo sectores que administran fórmulas).
 * Muestra la cuenta de servicio (solo el email), la carpeta raíz con su enlace, la unidad, el estado de la conexión,
 * cuántas fórmulas ve el índice y cuándo se actualizó, y explica por qué hay archivos que no aparecen.
 * Todo es de SOLO LECTURA: no modifica Drive ni el banco de fórmulas. «Actualizar índice» solo rehace la lista en
 * memoria del servidor.
 */
import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import type { OrdersClientSession } from "@/lib/orders/orders-client";
import {
  fetchDriveConnectionCheckApi,
  fetchDriveConnectionReportApi,
  type DriveConnectionCheckDto,
  type DriveConnectionReportDto,
} from "@/lib/formulas/formulas-client";

const STATUS_LABEL: Record<string, { text: string; tone: "ok" | "warn" | "bad" }> = {
  OK: { text: "Conectado", tone: "ok" },
  SIN_CREDENCIALES: { text: "Sin credenciales", tone: "bad" },
  SIN_CARPETA: { text: "Sin carpeta configurada", tone: "bad" },
  SIN_PERMISO: { text: "Sin permiso", tone: "bad" },
  NO_ENCONTRADA: { text: "Carpeta no encontrada", tone: "bad" },
  ERROR: { text: "Error de conexión", tone: "warn" },
};
const TONE = {
  ok: "border-emerald-500/60 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300",
  warn: "border-amber-500/60 bg-amber-500/10 text-amber-800 dark:text-amber-300",
  bad: "border-rose-500/60 bg-rose-500/10 text-rose-700 dark:text-rose-300",
};
const OMIT_LABEL: Record<string, string> = {
  ROOT_FILE: "Sueltos en la raíz",
  NESTED: "En subcarpetas de un cliente",
  UNSUPPORTED_TYPE: "Formato no reconocido",
  SHORTCUT: "Accesos directos",
  SUPERSEDED: "Versión anterior del mismo producto",
};
const BANK_LABEL: Record<string, string> = {
  EN_AMBOS: "En el banco y en Drive",
  SOLO_DRIVE: "Solo en Drive",
  SOLO_BANCO: "Solo en el banco",
  CONFLICTO_BANCO: "Conflicto en el banco",
  AMBIGUA_BANCO: "Ambigua en el banco",
  REVISION_BANCO: "En revisión en el banco",
};
const fmtDate = (iso: string | null | undefined) => (iso ? new Date(iso).toLocaleString("es-AR") : "—");

export function DriveConnectionPanel({ session }: { session: OrdersClientSession }) {
  const [check, setCheck] = useState<DriveConnectionCheckDto | null>(null);
  const [report, setReport] = useState<DriveConnectionReportDto | null>(null);
  const [busy, setBusy] = useState<null | "report" | "refresh">(null);
  const [error, setError] = useState<string | null>(null);

  const runReport = async (refresh: boolean) => {
    setBusy(refresh ? "refresh" : "report");
    setError(null);
    try {
      const r = await fetchDriveConnectionReportApi(session, { refresh });
      setReport(r);
      setCheck(r);
    } catch (e) {
      setError(e instanceof Error ? e.message : "No se pudo completar el diagnóstico.");
    } finally {
      setBusy(null);
    }
  };

  // Estado rápido al abrir el panel (solo lectura).
  useEffect(() => {
    if (!session.email) return;
    let alive = true;
    fetchDriveConnectionCheckApi(session)
      .then((c) => alive && setCheck(c))
      .catch((e) => alive && setError(e instanceof Error ? e.message : "No se pudo verificar la conexión."));
    return () => {
      alive = false;
    };
  }, [session]);

  const st = check ? STATUS_LABEL[check.status] ?? STATUS_LABEL.ERROR : null;
  const scan = report?.scan;

  return (
    <section className="rounded border border-[var(--os-border)] p-3 text-sm" data-testid="drive-connection-panel" aria-label="Conexión con Google Drive">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h4 className="font-semibold">Conexión con Google Drive</h4>
        <div className="flex flex-wrap gap-2">
          <Button size="sm" variant="secondary" disabled={busy !== null} onClick={() => void runReport(false)} data-testid="drive-verify">
            {busy === "report" ? "Verificando…" : "Verificar conexión"}
          </Button>
          <Button size="sm" variant="secondary" disabled={busy !== null} onClick={() => void runReport(true)} data-testid="drive-refresh-index">
            {busy === "refresh" ? "Actualizando…" : "Actualizar índice"}
          </Button>
        </div>
      </div>
      <p className="mt-1 text-xs text-[var(--os-text-muted)]">
        Solo lectura: no modifica archivos de Drive ni el banco de fórmulas. Nunca se muestran claves.
      </p>

      {error ? <p className="mt-2 rounded border border-rose-300 bg-rose-500/10 px-2 py-1" role="alert">{error}</p> : null}
      {!check && !error ? <p className="mt-2 text-xs">Consultando…</p> : null}

      {check && st ? (
        <dl className="mt-3 grid gap-x-6 gap-y-2 sm:grid-cols-2" data-testid="drive-connection-summary">
          <div>
            <dt className="text-xs text-[var(--os-text-muted)]">Estado</dt>
            <dd>
              <span className={`inline-block rounded border px-2 py-0.5 text-xs font-semibold ${TONE[st.tone]}`} data-testid="drive-status">{st.text}</span>
              <span className="ml-2 text-xs">{check.message}</span>
            </dd>
          </div>
          <div>
            <dt className="text-xs text-[var(--os-text-muted)]">Cuenta conectada</dt>
            <dd className="break-all" data-testid="drive-account">{check.serviceAccountEmail ?? "— (no configurada)"}</dd>
          </div>
          <div>
            <dt className="text-xs text-[var(--os-text-muted)]">Carpeta raíz</dt>
            <dd data-testid="drive-root">
              {check.folder.id ? (
                <>
                  <span className="font-medium">{check.folder.name ?? "(nombre no disponible)"}</span>{" "}
                  {check.folder.url ? (
                    <a className="text-[var(--os-teal)] underline" href={check.folder.url} target="_blank" rel="noreferrer">
                      Abrir en Drive
                    </a>
                  ) : null}
                  <span className="block text-xs text-[var(--os-text-muted)]">
                    {check.folder.envKey} · ID {check.folder.id}
                  </span>
                </>
              ) : (
                "— (sin configurar)"
              )}
            </dd>
          </div>
          <div>
            <dt className="text-xs text-[var(--os-text-muted)]">Unidad de Drive</dt>
            <dd data-testid="drive-unit">{check.folder.driveLabel ?? "—"}</dd>
          </div>
          <div>
            <dt className="text-xs text-[var(--os-text-muted)]">Fórmulas encontradas (índice)</dt>
            <dd data-testid="drive-count">
              {check.index.entryCount != null ? `${check.index.entryCount} en ${check.index.clientCount} clientes` : "Índice todavía no armado en este servidor"}
              {scan ? <span className="block text-xs text-[var(--os-text-muted)]">Diagnóstico: {scan.indexedCount} archivos leídos por el índice</span> : null}
            </dd>
          </div>
          <div>
            <dt className="text-xs text-[var(--os-text-muted)]">Última actualización del índice</dt>
            <dd data-testid="drive-built-at">
              {fmtDate(check.index.builtAt)}
              <span className="block text-xs text-[var(--os-text-muted)]">{check.index.note}</span>
            </dd>
          </div>
        </dl>
      ) : null}

      {report && !scan && check?.status !== "OK" ? (
        <p className="mt-3 text-xs">No se puede explorar la carpeta hasta resolver el estado de la conexión.</p>
      ) : null}

      {scan ? (
        <div className="mt-4 space-y-3" data-testid="drive-diagnostic">
          <div>
            <p className="font-semibold">Clientes que la cuenta puede consultar ({scan.clients.length})</p>
            <p className="text-xs text-[var(--os-text-muted)]">
              {scan.clients.map((c) => `${c.name} (${c.indexedFiles})`).join(" · ") || "Ninguno"}
            </p>
          </div>

          <div>
            <p className="font-semibold">Archivos que no aparecen en GENUS OS ({Object.values(scan.omittedCounts).reduce((a, b) => a + b, 0)})</p>
            {Object.keys(scan.omittedCounts).length === 0 ? (
              <p className="text-xs text-emerald-700 dark:text-emerald-300">Dentro de la carpeta configurada no hay planillas omitidas.</p>
            ) : (
              <>
                <ul className="ml-4 list-disc text-xs" data-testid="drive-omitted-counts">
                  {Object.entries(scan.omittedCounts).map(([k, n]) => (
                    <li key={k}>
                      {OMIT_LABEL[k] ?? k}: {n}
                    </li>
                  ))}
                </ul>
                <details className="mt-1">
                  <summary className="cursor-pointer text-xs text-[var(--os-teal)]">Ver archivos y motivo</summary>
                  <div className="mt-1 max-h-72 overflow-auto">
                    <table className="w-full text-left text-xs" data-testid="drive-omitted-table">
                      <thead>
                        <tr>
                          <th className="p-1">Archivo</th>
                          <th className="p-1">Ubicación</th>
                          <th className="p-1">Motivo</th>
                        </tr>
                      </thead>
                      <tbody>
                        {scan.omitted.map((o, i) => (
                          <tr key={`${o.url}-${i}`} className="border-t border-[var(--os-border)]">
                            <td className="p-1">
                              <a className="underline" href={o.url} target="_blank" rel="noreferrer">
                                {o.name}
                              </a>
                            </td>
                            <td className="p-1">{o.path}</td>
                            <td className="p-1">
                              {o.reasonText}
                              {o.detail ? ` ${o.detail}.` : ""}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </details>
              </>
            )}
            <p className="mt-1 text-xs text-[var(--os-text-muted)]">
              Otros archivos que no son planillas (PDF, documentos…): {scan.otherFiles}. Carpetas recorridas: {scan.foldersVisited}
              {scan.truncated ? " (recorrido parcial: hay más)" : ""}.
            </p>
            {scan.folderErrors.length ? <p className="text-xs text-rose-700">{scan.folderErrors.join(" ")}</p> : null}
          </div>

          {report?.outside ? (
            <div data-testid="drive-outside">
              <p className="font-semibold">Fuera de la carpeta configurada</p>
              <p className="text-xs">
                Unidades compartidas visibles para la cuenta:{" "}
                {report.outside.sharedDrives.length
                  ? report.outside.sharedDrives.map((d) => `${d.name}${d.containsRoot ? " (contiene la carpeta raíz)" : ""}`).join(" · ")
                  : "ninguna"}
                .
              </p>
              <p className="text-xs">
                Planillas que la cuenta ve fuera de la carpeta raíz: {report.outside.sheetsOutsideRootCount}
                {report.outside.truncated ? " (búsqueda parcial)" : ""}. No se usan para las OE.
              </p>
              {report.outside.sheetsOutsideRoot.length ? (
                <details>
                  <summary className="cursor-pointer text-xs text-[var(--os-teal)]">Ver planillas fuera de la carpeta</summary>
                  <ul className="ml-4 mt-1 max-h-48 list-disc overflow-auto text-xs">
                    {report.outside.sheetsOutsideRoot.map((f, i) => (
                      <li key={`${f.url}-${i}`}>
                        <a className="underline" href={f.url} target="_blank" rel="noreferrer">
                          {f.name}
                        </a>
                      </li>
                    ))}
                  </ul>
                </details>
              ) : null}
              {report.outside.error ? <p className="text-xs text-rose-700">{report.outside.error}</p> : null}
            </div>
          ) : null}

          {report?.bank ? (
            <div data-testid="drive-bank">
              <p className="font-semibold">Comparación con el banco de fórmulas</p>
              {report.bank.error ? (
                <p className="text-xs text-rose-700">{report.bank.error}</p>
              ) : (
                <>
                  <ul className="ml-4 list-disc text-xs" data-testid="drive-bank-counts">
                    {Object.entries(report.bank.counts).map(([k, n]) => (
                      <li key={k}>
                        {BANK_LABEL[k] ?? k}: {n}
                      </li>
                    ))}
                  </ul>
                  {report.bank.rows.length ? (
                    <details>
                      <summary className="cursor-pointer text-xs text-[var(--os-teal)]">Ver las que tienen diferencias</summary>
                      <table className="mt-1 w-full text-left text-xs">
                        <thead>
                          <tr>
                            <th className="p-1">Cliente</th>
                            <th className="p-1">Producto</th>
                            <th className="p-1">Situación</th>
                          </tr>
                        </thead>
                        <tbody>
                          {report.bank.rows.map((r, i) => (
                            <tr key={`${r.client}-${r.product}-${i}`} className="border-t border-[var(--os-border)]">
                              <td className="p-1">{r.client}</td>
                              <td className="p-1">{r.product}</td>
                              <td className="p-1">{BANK_LABEL[r.status] ?? r.status}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </details>
                  ) : null}
                </>
              )}
            </div>
          ) : null}

          <ul className="ml-4 list-disc text-xs text-[var(--os-text-muted)]">
            {report?.limits.map((l) => <li key={l}>{l}</li>)}
          </ul>
        </div>
      ) : null}
    </section>
  );
}
