"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { TwinShell } from "@/features/os/shell/twin-shell";
import { Button } from "@/components/ui/button";
import { SchemaPendingBanner } from "@/components/ui/schema-pending-banner";
import { usePreviewSession } from "@/features/os/session/preview-context";
import {
  fetchRemitosApi,
  remitoActionApi,
  remitoDownloadUrl,
} from "@/lib/remitos/remitos-client";
import { canAccessRemitos, type RemitoRecord, type RemitoTab } from "@/lib/remitos/types";

const TABS: { id: RemitoTab; label: string }[] = [
  { id: "borradores", label: "Borradores" },
  { id: "generados", label: "Generados" },
  { id: "anulados", label: "Anulados" },
];

export function RemitosView() {
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
    } catch (e) {
      setError(e instanceof Error ? e.message : "Error al cargar remitos");
    }
  }, [allowed, session, tab, q]);

  useEffect(() => {
    void reload();
  }, [reload]);

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
            placeholder="Buscar cliente o producto…"
            className="ml-auto rounded border border-[var(--os-border)] px-2 py-1.5 text-sm"
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
                  <th className="px-3 py-2">Cliente</th>
                  <th className="px-3 py-2">Entrega</th>
                  <th className="px-3 py-2">Ver.</th>
                  <th className="px-3 py-2">Líneas</th>
                  <th className="px-3 py-2">Estado</th>
                </tr>
              </thead>
              <tbody>
                {items.length === 0 ? (
                  <tr>
                    <td colSpan={5} className="px-3 py-6 text-[var(--os-text-muted)]">
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
                      <td className="px-3 py-2 font-medium">{r.clientDisplay}</td>
                      <td className="px-3 py-2">{r.deliveryDate}</td>
                      <td className="px-3 py-2">v{r.version}</td>
                      <td className="px-3 py-2">{r.lines.length}</td>
                      <td className="px-3 py-2 text-xs uppercase">{r.status}</td>
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
                  {selected.remitoNumber ?? "Borrador"} · {selected.clientDisplay}
                </h2>
                <p className="text-xs text-[var(--os-text-muted)]">
                  Entrega {selected.deliveryDate} · v{selected.version} ·{" "}
                  {selected.status} · {selected.totalUnits} u · {selected.totalCajas} cajas
                </p>
                {selected.offersNewVersion ? (
                  <p className="rounded border border-amber-200 bg-amber-50 px-2 py-1 text-xs">
                    Remito generado inmutable — hay aprobaciones nuevas. Creá una nueva versión.
                  </p>
                ) : null}
                <ul className="max-h-48 space-y-1 overflow-y-auto text-xs">
                  {selected.lines.map((l) => (
                    <li key={l.id} className="rounded border border-[var(--os-border)] px-2 py-1">
                      {l.totalUnits} · {l.product} · L:{l.lote || "—"} VTO:{l.vto || "—"} ·{" "}
                      {l.cajas1}x{l.unidades1} / {l.cajas2}x{l.unidades2}
                    </li>
                  ))}
                </ul>
                <div className="flex flex-wrap gap-2">
                  {selected.status === "BORRADOR" ? (
                    <Button
                      type="button"
                      disabled={busy || schemaPending}
                      onClick={() => void runAction("generate", selected.id)}
                      data-testid="remito-generate"
                    >
                      Generar
                    </Button>
                  ) : null}
                  {selected.status === "GENERADO" ? (
                    <>
                      <Button
                        type="button"
                        disabled={busy || schemaPending}
                        onClick={() => void runAction("new_version", selected.id)}
                        data-testid="remito-new-version"
                      >
                        Nueva versión
                      </Button>
                      <a
                        className="inline-flex items-center rounded border border-[var(--os-border)] px-3 py-1.5 text-sm"
                        href={remitoDownloadUrl(selected.id, "xlsx")}
                        data-testid="remito-dl-xlsx"
                      >
                        XLSX
                      </a>
                      <a
                        className="inline-flex items-center rounded border border-[var(--os-border)] px-3 py-1.5 text-sm"
                        href={remitoDownloadUrl(selected.id, "pdf")}
                        data-testid="remito-dl-pdf"
                      >
                        PDF
                      </a>
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
      </div>
    </TwinShell>
  );
}
